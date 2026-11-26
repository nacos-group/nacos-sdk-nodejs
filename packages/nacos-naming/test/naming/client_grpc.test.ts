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

// End-to-end coverage for #167 with the public client. These tests use the admin
// identity as a fixture; ordinary-user identities and the wider server matrix stay in
// #168/#170, and the remote subscribe/unsubscribe, ACK and redo lifecycle stays in #171.

import * as assert from 'assert';
import * as crypto from 'crypto';
import { NacosNamingClient } from '../../src/naming/client';

const logger = console;
const NACOS_HOST = process.env.NACOS_HOST || '127.0.0.1';
const NACOS_PORT = process.env.NACOS_PORT || '8848';
const NACOS_USERNAME = process.env.NACOS_USERNAME || 'nacos';
const NACOS_PASSWORD = process.env.NACOS_PASSWORD || 'nacos';

function uniqueServiceName(prefix: string): string {
  return `nodejs.${prefix}.${process.pid}.${crypto.randomBytes(4).toString('hex')}`;
}

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
      serverList: `${NACOS_HOST}:${NACOS_PORT}`,
      username: NACOS_USERNAME,
      password: NACOS_PASSWORD,
    });
    await client.ready();
  });

  after(async () => {
    if (client) {
      await client.close();
    }
  });

  it('[NAM-01][NAM-02][NAM-03] should discover, select and subscribe with default parameters over gRPC', async function() {
    this.timeout(60000);
    const serviceName = uniqueServiceName('grpc.discover');
    const first = { ip: '10.0.0.1', port: 8848 };
    await client.registerInstance(serviceName, first);
    try {
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
      try {
        client.subscribe(serviceName, delivered => deliveries.push(delivered));
        await waitUntil(() => deliveries.some(delivered => hasHost(delivered, first.ip)));
      } finally {
        client.unSubscribe(serviceName);
      }
    } finally {
      await client.deregisterInstance(serviceName, first);
    }
  });

  it('[NAM-01] should keep groups apart', async function() {
    this.timeout(60000);
    const serviceName = uniqueServiceName('grpc.grouped');
    const instance = { ip: '10.0.0.2', port: 8848 };
    await client.registerInstance(serviceName, instance, 'GROUP_A');
    try {
      await waitUntil(async () => hasHost(await client.getAllInstances(serviceName, 'GROUP_A'), instance.ip));

      const defaultGroupHosts = await client.getAllInstances(serviceName);
      assert(!hasHost(defaultGroupHosts, instance.ip),
        `the default group must not return the GROUP_A instance, got: ${JSON.stringify(defaultGroupHosts)}`);
    } finally {
      await client.deregisterInstance(serviceName, instance, 'GROUP_A');
    }
  });
});
