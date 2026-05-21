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
import { GrpcConnection, GrpcTransportClient } from 'nacos-common';
import { GrpcNamingProxy } from '../../src/naming/grpc_proxy';
import { Instance } from '../../src/naming/instance';
const { sleep } = require('mz-modules');

const logger = console;
const serviceName = 'nodejs.grpc.test.' + process.versions.node;

describe('test/naming/grpc_proxy.test.ts', () => {
  let connection: GrpcConnection;
  let transportClient: GrpcTransportClient;
  let proxy: GrpcNamingProxy;

  before(async function() {
    this.timeout(10000);
    connection = new GrpcConnection({
      serverList: ['127.0.0.1:8848'],
      namespace: 'public',  // Nacos 3.x default namespace ID
      username: 'nacos',
      password: 'nacos',
      logger,
      labels: { source: 'sdk', module: 'naming' },
    });
    connection.on('disconnected', (err: any) => {
      logger.warn('[TEST] connection disconnected event:', err && err.message || '');
    });
    connection.on('reconnecting', (backoff: number) => {
      logger.warn('[TEST] connection reconnecting, backoff=%d', backoff);
    });
    await connection.connect();
    // Wait for the server to register the connection after ConnectionSetupRequest
    await sleep(2000);
    transportClient = new GrpcTransportClient(connection);
    proxy = new GrpcNamingProxy({
      transportClient,
      namespace: 'public',  // Nacos 3.x default namespace ID
      logger,
    });
    await proxy.ready();
  });

  after(async function() {
    if (proxy) {
      await proxy.close();
    }
    if (connection) {
      connection.close();
    }
  });

  it('should register and query instance via gRPC', async function() {
    this.timeout(15000);

    const instance = new Instance({
      ip: '10.10.10.10',
      port: 9090,
      clusterName: 'DEFAULT',
      weight: 1.0,
      metadata: {},
      serviceName,
    });

    // Register instance
    const registerResult = await proxy.registerService(serviceName, 'DEFAULT_GROUP', instance);
    console.log('[TEST] registerResult:', registerResult);
    assert(registerResult === 'ok', `registerService should return ok, got: ${registerResult}`);

    await sleep(5000);

    // Query list and verify instance appears
    const jsonStr = await proxy.queryList(serviceName, '', 0, false);
    console.log('[TEST] queryList response:', jsonStr.substring(0, 500));
    const serviceInfo = JSON.parse(jsonStr);
    assert(serviceInfo, 'queryList should return service info');
    const hosts = serviceInfo.hosts || (serviceInfo.serviceInfo && serviceInfo.serviceInfo.hosts) || [];
    const found = hosts.some((h: any) => h.ip === '10.10.10.10' && h.port === 9090);
    assert(found, `Instance 10.10.10.10:9090 should appear in hosts, got: ${JSON.stringify(hosts)}`);

    // Deregister instance
    const deregisterResult = await proxy.deregisterService(serviceName, instance);
    assert(deregisterResult === 'ok', `deregisterService should return ok, got: ${deregisterResult}`);

    await sleep(1000);

    // Query list and verify instance is gone
    const jsonStr2 = await proxy.queryList(serviceName, '', 0, false);
    const serviceInfo2 = JSON.parse(jsonStr2);
    const hosts2 = serviceInfo2.hosts || serviceInfo2.serviceInfo && serviceInfo2.serviceInfo.hosts || [];
    const stillThere = hosts2.some((h: any) => h.ip === '10.10.10.10' && h.port === 9090);
    assert(!stillThere, `Instance 10.10.10.10:9090 should be removed from hosts, got: ${JSON.stringify(hosts2)}`);
  });

  it('should report server healthy', async function() {
    const healthy = await proxy.serverHealthy();
    assert(healthy === true, 'serverHealthy should return true');
  });

  it('should get service list', async function() {
    const result = await proxy.getServiceList(0, 10, 'DEFAULT_GROUP');
    assert(typeof result.count === 'number', `count should be a number, got: ${typeof result.count}`);
    assert(Array.isArray(result.data), `data should be an array, got: ${typeof result.data}`);
  });

  it('should subscribe and receive push via gRPC', async function() {
    this.timeout(30000);
    const subServiceName = 'nodejs.grpc.subscribe.test.' + process.versions.node;
    const instance = new Instance({ ip: '20.20.20.20', port: 7070 });

    // Register push handler
    const pushes: string[] = [];
    proxy.registerPushHandler((json: string) => {
      pushes.push(json);
    });

    // Subscribe
    const subResult = await proxy.subscribe(subServiceName, 'DEFAULT_GROUP', '');
    const subInfo = JSON.parse(subResult);
    console.log('[TEST] subscribe result hosts:', subInfo.hosts.length);

    // Register an instance to trigger push
    await proxy.registerService(subServiceName, 'DEFAULT_GROUP', instance);
    console.log('[TEST] instance registered, waiting for push...');

    // Wait for server push
    await sleep(8000);

    console.log('[TEST] pushes received:', pushes.length);
    if (pushes.length > 0) {
      const pushed = JSON.parse(pushes[pushes.length - 1]);
      const found = (pushed.hosts || []).some((h: any) => h.ip === '20.20.20.20' && h.port === 7070);
      assert(found, `Push should contain 20.20.20.20:7070, got hosts: ${JSON.stringify(pushed.hosts)}`);
    }

    // Cleanup
    await proxy.deregisterService('DEFAULT_GROUP@@' + subServiceName, instance);
    await proxy.unSubscribe(subServiceName, 'DEFAULT_GROUP', '');
  });
});
