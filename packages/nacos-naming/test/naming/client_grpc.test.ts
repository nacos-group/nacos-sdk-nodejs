/**
 * Licensed to the Apache Software Foundation (ASF) under one or more
 * contributor license agreements.  See the NOTICE file distributed with
 * this work for additional information regarding copyright ownership.
 * The ASF licenses this file to You under the Apache License, Version 2.0
 * (the "License"); you may not use this file except in compliance with
 * the License.  You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import * as assert from 'assert';
import { NacosNamingClient } from '../../src/naming/client';

const logger = console;
const serviceName = 'nodejs.client.grpc.' + process.versions.node;

async function waitUntil(check: () => Promise<boolean> | boolean, timeout = 20000, interval = 200): Promise<void> {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise(resolve => setTimeout(resolve, interval));
  }
  throw new Error(`condition not met within ${timeout}ms`);
}

function hasHost(hosts: any[], ip: string): boolean {
  return (hosts || []).some(host => host.ip === ip);
}

describe('test/naming/client_grpc.test.ts', () => {
  let client: NacosNamingClient;

  before(async () => {
    client = new NacosNamingClient({
      logger,
      serverList: '127.0.0.1:8848',
      username: 'nacos',
      password: 'nacos',
    });
    await client.ready();
  });

  after(async () => {
    await client.close();
  });

  it('should discover and subscribe with default parameters over gRPC', async function() {
    this.timeout(60000);
    const first = { ip: '10.0.0.1', port: 8848 };
    await client.registerInstance(serviceName, first);

    let hosts: any[] = [];
    await waitUntil(async () => {
      hosts = await client.getAllInstances(serviceName);
      return hasHost(hosts, first.ip);
    });
    assert(hasHost(hosts, first.ip), `getAllInstances should return the instance, got: ${JSON.stringify(hosts)}`);

    const selected = await client.selectInstances(serviceName);
    assert(hasHost(selected, first.ip), `selectInstances should return the instance, got: ${JSON.stringify(selected)}`);

    const one = await client.selectOneHealthyInstance(serviceName);
    assert(one && one.ip === first.ip, `selectOneHealthyInstance should return the instance, got: ${JSON.stringify(one)}`);

    const deliveries: any[][] = [];
    client.subscribe(serviceName, delivered => deliveries.push(delivered));
    await waitUntil(() => deliveries.some(delivered => hasHost(delivered, first.ip)));
    client.unSubscribe(serviceName);

    await client.deregisterInstance(serviceName, first);
  });

  it('should keep groups apart', async function() {
    this.timeout(60000);
    const groupedService = serviceName + '.grouped';
    const instance = { ip: '10.0.0.2', port: 8848 };
    await client.registerInstance(groupedService, instance, 'GROUP_A');

    await waitUntil(async () => hasHost(await client.getAllInstances(groupedService, 'GROUP_A'), '10.0.0.2'));

    const defaultGroupHosts = await client.getAllInstances(groupedService);
    assert(!hasHost(defaultGroupHosts, '10.0.0.2'),
      `the default group must not return the GROUP_A instance, got: ${JSON.stringify(defaultGroupHosts)}`);

    await client.deregisterInstance(groupedService, instance, 'GROUP_A');
  });
});
