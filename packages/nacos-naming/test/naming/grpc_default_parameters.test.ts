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
import { GrpcNamingProxy } from '../../src/naming/grpc_proxy';
import { HostReactor } from '../../src/naming/host_reactor';

const logger = console;

class FakeTransportClient {
  requests: Array<{ message: any; type: string }> = [];
  pushHandler: ((request: any) => any) | null = null;

  onReconnect(): void {
    // noop
  }

  async request(message: any, type: string): Promise<any> {
    this.requests.push({ message, type });
    switch (type) {
      case 'ServiceQueryRequest':
      case 'SubscribeServiceRequest':
        return {
          serviceInfo: {
            name: message.serviceName,
            groupName: message.groupName,
            clusters: message.cluster || message.clusters || '',
            cacheMillis: 10000,
            hosts: [{ ip: '10.0.0.1', port: 8848, healthy: true, enabled: true, weight: 1 }],
            lastRefTime: 1,
          },
        };
      case 'ServiceListRequest':
        return { count: 0, serviceNames: [] };
      default:
        return { resultCode: 200 };
    }
  }

  registerServerPushHandler(_type: string, handler: (request: any) => any): void {
    this.pushHandler = handler;
  }

  removeServerPushHandler(_type: string): void {
    this.pushHandler = null;
  }
}

describe('test/naming/grpc_default_parameters.test.ts', () => {
  let transportClient: FakeTransportClient;
  let proxy: GrpcNamingProxy;

  beforeEach(() => {
    transportClient = new FakeTransportClient();
    proxy = new GrpcNamingProxy({ transportClient: transportClient as any, logger });
  });

  afterEach(async () => {
    await proxy.close();
  });

  it('should cache a default-group query under the grouped name', async () => {
    const json = JSON.parse(await proxy.queryList('nodejs.test.svc', '', 0, false));
    assert(json.name === 'DEFAULT_GROUP@@nodejs.test.svc', `unexpected name: ${json.name}`);
    assert(json.dom === 'DEFAULT_GROUP@@nodejs.test.svc', `unexpected dom: ${json.dom}`);
    assert(json.groupName === 'DEFAULT_GROUP', `unexpected groupName: ${json.groupName}`);
    assert(json.clusters === '', `unexpected clusters: ${json.clusters}`);
  });

  it('should keep a custom group and an explicit cluster', async () => {
    const json = JSON.parse(await proxy.queryList('GROUP_A@@nodejs.test.svc', 'NODEJS', 0, false));
    assert(json.name === 'GROUP_A@@nodejs.test.svc', `unexpected name: ${json.name}`);
    assert(json.groupName === 'GROUP_A', `unexpected groupName: ${json.groupName}`);
    assert(json.clusters === 'NODEJS', `unexpected clusters: ${json.clusters}`);

    const request = transportClient.requests[0].message;
    assert(request.serviceName === 'nodejs.test.svc', `unexpected request serviceName: ${request.serviceName}`);
    assert(request.groupName === 'GROUP_A', `unexpected request groupName: ${request.groupName}`);
  });

  it('should return the grouped name from subscribe', async () => {
    const json = JSON.parse(await proxy.subscribe('GROUP_A@@nodejs.test.svc', 'GROUP_A', ''));
    assert(json.name === 'GROUP_A@@nodejs.test.svc', `unexpected name: ${json.name}`);
  });

  it('should normalize a push to the grouped name',  () => {
    let received: any = null;
    proxy.registerPushHandler(json => {
      received = JSON.parse(json);
    });

    transportClient.pushHandler!({
      serviceInfo: {
        name: 'nodejs.test.svc',
        groupName: 'DEFAULT_GROUP',
        clusters: '',
        hosts: [{ ip: '10.0.0.1', port: 8848 }],
        lastRefTime: 1,
      },
    });

    assert(received, 'the push handler should receive a view');
    assert(received.name === 'DEFAULT_GROUP@@nodejs.test.svc', `unexpected name: ${received.name}`);
    assert(received.dom === 'DEFAULT_GROUP@@nodejs.test.svc', `unexpected dom: ${received.dom}`);
  });

  it('should use one cache key for default gRPC parameters', async () => {
    const serverProxy = { ready: async () => { /* noop */ } };
    const grpc = new HostReactor({ logger, serverProxy, transport: 'grpc' });
    // No UDP receiver here: the cache-key case stays free of network handles.
    const http = new HostReactor({ logger, serverProxy, transport: 'http', pushReceiver: false });
    try {
      assert.strictEqual(grpc._getKey({ serviceName: 'DEFAULT_GROUP@@svc', clusters: '' }), 'DEFAULT_GROUP@@svc');
      assert.strictEqual(http._getKey({ serviceName: 'DEFAULT_GROUP@@svc', clusters: '' }), 'DEFAULT_GROUP@@svc@@DEFAULT');
    } finally {
      await Promise.all([grpc.close(), http.close()]);
    }
  });
});
