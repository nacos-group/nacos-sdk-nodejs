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

// Public-client regressions for #167. The transport is controlled in-process, so the
// public client and the cache path are the code under test. Remote subscribe,
// unsubscribe, ACK and redo lifecycle stays in #171; ordinary-user identities and the
// wider server matrix stay in #168/#170.

import * as assert from 'assert';
import * as mm from 'mm';
import { NacosNamingClient } from '../../src/naming/client';
import { Host } from '../../src/interface';

const logger = console;

interface RecordedRequest {
  type: string;
  message: any;
}

interface FakeService {
  hosts: any[];
  alreadyGrouped?: boolean;
}

function host(ip: string, clusterName: string = 'DEFAULT'): Host {
  return { ip, port: 8848, weight: 1, healthy: true, enabled: true, clusterName };
}

function hasIp(hosts: Host[], ip: string): boolean {
  return (hosts || []).some(item => item.ip === ip);
}

async function waitUntil(check: () => boolean, timeout = 3000, interval = 10): Promise<void> {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (check()) return;
    await new Promise(resolve => setTimeout(resolve, interval));
  }
  throw new Error(`condition not met within ${timeout}ms`);
}

class ControlledServer {
  requests: RecordedRequest[] = [];
  private services = new Map<string, FakeService>();
  private lastRefTime = 1;

  set(serviceName: string, groupName: string, hosts: any[], alreadyGrouped = false): void {
    this.services.set(`${groupName}@@${serviceName}`, { hosts, alreadyGrouped });
  }

  update(serviceName: string, groupName: string, hosts: any[]): void {
    const service = this.services.get(`${groupName}@@${serviceName}`);
    if (service) {
      service.hosts = hosts;
    } else {
      this.set(serviceName, groupName, hosts);
    }
  }

  viewOf(serviceName: string, groupName: string, cluster: string): any {
    const key = `${groupName}@@${serviceName}`;
    const service = this.services.get(key);
    const hosts = (service ? service.hosts : []).filter(item => !cluster || item.clusterName === cluster);
    return {
      name: service && service.alreadyGrouped ? key : serviceName,
      groupName,
      clusters: cluster,
      cacheMillis: 60000,
      hosts,
      lastRefTime: this.lastRefTime++,
      checksum: '',
    };
  }

  respond(message: any, type: string): any {
    this.requests.push({ type, message });
    switch (type) {
      case 'ServiceQueryRequest':
      case 'SubscribeServiceRequest':
        return {
          serviceInfo: this.viewOf(
            message.serviceName,
            message.groupName || 'DEFAULT_GROUP',
            message.cluster || message.clusters || ''
          ),
        };
      case 'ServerCheckRequest':
        return { connectionId: 'controlled' };
      case 'ServiceListRequest':
        return { count: 0, serviceNames: [] };
      default:
        return { resultCode: 200 };
    }
  }
}

describe('test/naming/client_grpc_controlled.test.ts', () => {
  let server: ControlledServer;
  let client: NacosNamingClient;
  let connection: any;

  function push(serviceName: string, groupName: string, hosts: any[], alreadyGrouped = false): any {
    // Leave the query fixture at its previous value: a passing poll must not stand in for push delivery.
    const handler = connection.serverPushHandlers.get('NotifySubscriberRequest');
    assert(handler, 'the public client should register a push handler');
    return handler({
      serviceInfo: {
        name: alreadyGrouped ? `${groupName}@@${serviceName}` : serviceName,
        groupName,
        clusters: '',
        cacheMillis: 60000,
        hosts,
        lastRefTime: Date.now(),
        checksum: '',
      },
    });
  }

  beforeEach(async function() {
    this.timeout(10000);
    server = new ControlledServer();
    client = new NacosNamingClient({
      logger,
      serverList: '127.0.0.1:8848',
    });
    client.on('error', () => { /* background errors are asserted by their own tests */ });
    connection = (client as any)._connection;
    mm(connection, 'connect', async () => { /* no server in this suite */ });
    mm((client as any)._transportClient, 'request', async (message: any, type: string) => server.respond(message, type));
    await client.ready();
  });

  afterEach(async () => {
    mm.restore();
    await client.close();
  });

  it('[NAM-01] should discover, select and pick instances with default parameters', async function() {
    this.timeout(10000);
    server.set('unit.discover', 'DEFAULT_GROUP', [ host('10.0.0.1'), host('10.0.0.2', 'CLUSTER_B') ]);

    const all = await client.getAllInstances('unit.discover');
    assert(hasIp(all, '10.0.0.1') && hasIp(all, '10.0.0.2'), `unexpected instances: ${JSON.stringify(all)}`);

    const selected = await client.selectInstances('unit.discover');
    assert.deepStrictEqual(selected.map(item => item.ip).sort(), [ '10.0.0.1', '10.0.0.2' ]);

    const one = await client.selectOneHealthyInstance('unit.discover');
    assert(one && [ '10.0.0.1', '10.0.0.2' ].indexOf(one.ip) >= 0, `unexpected instance: ${JSON.stringify(one)}`);

    const queries = server.requests.filter(request => request.type === 'ServiceQueryRequest');
    assert(queries.length > 0, 'the cache miss should query the server');
    assert(queries.every(query => query.message.cluster === ''), 'gRPC discovery must not filter the cluster');
    assert.strictEqual(queries[0].message.serviceName, 'unit.discover');
    assert.strictEqual(queries[0].message.groupName, 'DEFAULT_GROUP');
  });

  it('[NAM-31] should include every cluster for omitted and explicit empty clusters', async function() {
    this.timeout(10000);
    server.set('unit.omitted', 'DEFAULT_GROUP', [ host('10.0.1.1'), host('10.0.1.2', 'CLUSTER_B') ]);
    server.set('unit.empty', 'DEFAULT_GROUP', [ host('10.0.2.1'), host('10.0.2.2', 'CLUSTER_B') ]);

    const omitted = await client.getAllInstances('unit.omitted');
    assert(hasIp(omitted, '10.0.1.1') && hasIp(omitted, '10.0.1.2'), `unexpected instances: ${JSON.stringify(omitted)}`);

    const explicit = await client.getAllInstances('unit.empty', 'DEFAULT_GROUP', '');
    assert(hasIp(explicit, '10.0.2.1') && hasIp(explicit, '10.0.2.2'), `unexpected instances: ${JSON.stringify(explicit)}`);

    const queries = server.requests.filter(request => request.type === 'ServiceQueryRequest');
    assert(queries.length === 2, `expected one query per service, got: ${JSON.stringify(queries)}`);
    assert(queries.every(query => query.message.cluster === ''), 'both forms must query without a cluster filter');
  });

  it('[NAM-02] should deliver to a subscription created before any discovery', async function() {
    this.timeout(10000);
    server.set('unit.cold', 'DEFAULT_GROUP', [ host('10.0.3.1') ]);

    const deliveries: Host[][] = [];
    client.subscribe('unit.cold', hosts => deliveries.push(hosts));
    await waitUntil(() => deliveries.some(hosts => hasIp(hosts, '10.0.3.1')));
  });

  it('[NAM-42] should deliver the current view to a listener added after the cache is warm', async function() {
    this.timeout(10000);
    server.set('unit.warm', 'DEFAULT_GROUP', [ host('10.0.4.1') ]);

    const discovered = await client.getAllInstances('unit.warm');
    assert(hasIp(discovered, '10.0.4.1'), `unexpected instances: ${JSON.stringify(discovered)}`);

    const deliveries: Host[][] = [];
    client.subscribe('unit.warm', hosts => deliveries.push(hosts));
    await waitUntil(() => deliveries.length > 0);
    assert(hasIp(deliveries[0], '10.0.4.1'), `unexpected delivery: ${JSON.stringify(deliveries[0])}`);
  });

  it('[NAM-45][NAM-66] should apply a push to the listener and the cache, then stop callbacks after unsubscribe', async function() {
    this.timeout(10000);
    server.set('unit.push', 'DEFAULT_GROUP', [ host('10.0.5.1') ]);

    const deliveries: Host[][] = [];
    client.subscribe('unit.push', hosts => deliveries.push(hosts));
    await waitUntil(() => deliveries.some(hosts => hasIp(hosts, '10.0.5.1')));

    push('unit.push', 'DEFAULT_GROUP', [ host('10.0.5.2') ]);
    await waitUntil(() => deliveries.some(hosts => hasIp(hosts, '10.0.5.2')));

    const cached = await client.getAllInstances('unit.push');
    assert(hasIp(cached, '10.0.5.2'), `the cached view should follow the push, got: ${JSON.stringify(cached)}`);
    assert(!hasIp(cached, '10.0.5.1'), `the cached view should replace the old hosts, got: ${JSON.stringify(cached)}`);

    client.unSubscribe('unit.push');
    const count = deliveries.length;
    push('unit.push', 'DEFAULT_GROUP', [ host('10.0.5.3') ]);
    assert.strictEqual(deliveries.length, count, 'a listener removed by unSubscribe must not be called again');
  });

  it('[NAM-01] should keep default and custom groups apart and not prefix an already-grouped name', async function() {
    this.timeout(10000);
    server.set('unit.grouped', 'DEFAULT_GROUP', [ host('10.0.6.1') ]);
    server.set('unit.grouped', 'GROUP_A', [ host('10.0.6.2') ]);
    server.set('unit.already', 'GROUP_B', [ host('10.0.6.3') ], true);

    const defaultHosts = await client.getAllInstances('unit.grouped');
    assert(hasIp(defaultHosts, '10.0.6.1') && !hasIp(defaultHosts, '10.0.6.2'),
      `the default group must not return the GROUP_A instance, got: ${JSON.stringify(defaultHosts)}`);

    const groupAHosts = await client.getAllInstances('unit.grouped', 'GROUP_A');
    assert(hasIp(groupAHosts, '10.0.6.2') && !hasIp(groupAHosts, '10.0.6.1'),
      `GROUP_A must not return the default instance, got: ${JSON.stringify(groupAHosts)}`);

    const alreadyGrouped = await client.getAllInstances('unit.already', 'GROUP_B');
    assert(hasIp(alreadyGrouped, '10.0.6.3'), `an already-grouped name must stay readable: ${JSON.stringify(alreadyGrouped)}`);

    const alreadyQuery = server.requests.find(request =>
      request.type === 'ServiceQueryRequest' && request.message.serviceName === 'unit.already');
    assert(alreadyQuery, 'the already-grouped service should still be queried');
    assert.strictEqual(alreadyQuery!.message.groupName, 'GROUP_B', 'the group must not be added twice');

    const groupedDeliveries: Host[][] = [];
    client.subscribe({ serviceName: 'unit.already', groupName: 'GROUP_B' }, hosts => groupedDeliveries.push(hosts));
    await waitUntil(() => groupedDeliveries.length > 0);
    push('unit.already', 'GROUP_B', [ host('10.0.6.5') ], true);
    await waitUntil(() => groupedDeliveries.some(hosts => hasIp(hosts, '10.0.6.5')));

    await client.registerInstance('unit.registered', { ip: '10.0.6.4', port: 8848 }, 'GROUP_A');
    const register = server.requests.find(request => request.type === 'InstanceRequest');
    assert(register, 'registerInstance should reach the transport');
    assert.strictEqual(register!.message.serviceName, 'unit.registered');
    assert.strictEqual(register!.message.groupName, 'GROUP_A');
  });

  it('[Naming 1] should notify only the listener of the pushed group', async function() {
    this.timeout(10000);
    server.set('unit.isolation', 'DEFAULT_GROUP', [ host('10.0.7.1') ]);
    server.set('unit.isolation', 'GROUP_A', [ host('10.0.7.2') ]);

    const defaultDeliveries: Host[][] = [];
    const groupADeliveries: Host[][] = [];
    client.subscribe('unit.isolation', hosts => defaultDeliveries.push(hosts));
    client.subscribe({ serviceName: 'unit.isolation', groupName: 'GROUP_A' }, hosts => groupADeliveries.push(hosts));
    await waitUntil(() => defaultDeliveries.length > 0 && groupADeliveries.length > 0);

    const defaultCount = defaultDeliveries.length;
    push('unit.isolation', 'GROUP_A', [ host('10.0.7.3') ]);
    await waitUntil(() => groupADeliveries.some(hosts => hasIp(hosts, '10.0.7.3')));
    assert.strictEqual(defaultDeliveries.length, defaultCount, 'a GROUP_A push must not reach the default-group listener');

    const defaultHosts = await client.getAllInstances('unit.isolation');
    assert(hasIp(defaultHosts, '10.0.7.1'), `the default-group cache must stay unchanged: ${JSON.stringify(defaultHosts)}`);
  });
});
