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

'use strict';

const mm = require('mm');
const http = require('http');
const assert = require('assert');
const sleep = require('mz-modules/sleep');
const NameProxy = require('../../lib/naming/proxy');
const Instance = require('../../lib/naming/instance');

const logger = console;
const serviceName = 'nodejs.test.' + process.versions.node;

describe('test/naming/proxy.test.js', () => {
  afterEach(mm.restore);

  it('should ok', async function() {
    const proxy = new NameProxy({
      logger,
      serverList: '127.0.0.1',
    });
    await proxy.ready();
    const groupName = 'DEFAULT_GROUP';
    const instance = new Instance({
      ip: '1.1.1.1',
      port: 8080,
      clusterName: 'NODEJS',
      weight: 1.0,
      metadata: {},
      serviceName,
    });
    let result = await proxy.registerService(serviceName, groupName, instance);
    assert(result === 'ok');
    await sleep(1000);

    let jsonStr = await proxy.queryList(serviceName, 'NODEJS', '', 'false');
    let serviceInfo = JSON.parse(jsonStr);

    assert(serviceInfo && serviceInfo.dom === 'DEFAULT_GROUP@@' + serviceName);
    assert(serviceInfo.hosts && serviceInfo.hosts.length === 1);
    assert(serviceInfo.hosts[0].ip === '1.1.1.1');
    assert(serviceInfo.hosts[0].port === 8080);

    result = await proxy.deregisterService(serviceName, instance);
    assert(result === 'ok');

    jsonStr = await proxy.queryList(serviceName, 'NODEJS', '', 'false');
    serviceInfo = JSON.parse(jsonStr);

    assert(serviceInfo && serviceInfo.dom === 'DEFAULT_GROUP@@' + serviceName);
    assert(serviceInfo.hosts && serviceInfo.hosts.length === 0);

    await proxy.close();
  });

  it('should serverHealthy ok', async function() {
    const proxy = new NameProxy({
      logger,
      endpoint: '127.0.0.1:8849',
      serverList: '127.0.0.1:8848',
    });
    await proxy.ready();

    let isHealthy = await proxy.serverHealthy();
    assert(isHealthy);

    mm.http.request(/\/nacos\/v1\/ns\/operator\/metrics/, '{"status": "DOWN"}', {
      statusCode: 200,
    });

    isHealthy = await proxy.serverHealthy();
    assert(!isHealthy);

    mm.http.request(/\/nacos\/v1\/ns\/operator\/metrics/, '', {
      statusCode: 304,
    });

    isHealthy = await proxy.serverHealthy();
    assert(!isHealthy);

    mm.http.request(/\/nacos\/v1\/ns\/operator\/metrics/, '', {
      statusCode: 500,
    });

    isHealthy = await proxy.serverHealthy();
    assert(!isHealthy);

    await proxy.close();
  });

  it('should failed if no server available', async function() {
    const proxy = new NameProxy({
      logger,
      serverList: '',
    });
    await proxy.ready();

    const isHealthy = await proxy.serverHealthy();
    assert(!isHealthy);

    await proxy.close();
  });

  it('should support naocsDomain', async function() {
    const proxy = new NameProxy({
      logger,
      serverList: '',
    });
    await proxy.ready();
    proxy.nacosDomain = '127.0.0.1:8848';

    let isHealthy = await proxy.serverHealthy();
    assert(isHealthy);

    mm.http.request(/\/nacos\/v1\/ns\/operator\/metrics/, '', {
      statusCode: 500,
    });

    isHealthy = await proxy.serverHealthy();
    assert(!isHealthy);

    await proxy.close();
  });

  it('should sendBeat ok', async () => {
    const proxy = new NameProxy({
      logger,
      serverList: '127.0.0.1:8848',
    });
    await proxy.ready();

    const beatInfo = {
      serviceName: 'DEFAULT_GROUP@@' + serviceName,
      ip: '1.1.1.1',
      port: 8080,
      cluster: 'NODEJS',
      weight: 1,
      metadata: {},
      scheduled: false,
    };
    let result = await proxy.sendBeat(beatInfo);
    console.log(result);
    assert(typeof result === 'number' && result > 0);

    mm.error(proxy, '_reqAPI', 'mock error');

    result = await proxy.sendBeat(beatInfo);
    assert(result === 0);

    await proxy.close();
  });

  it('should getServiceList ok', async () => {
    const proxy = new NameProxy({
      logger,
      serverList: '127.0.0.1:8848',
    });
    await proxy.ready();

    let data = await proxy.getServiceList(0, 10, 'DEFAULT_GROUP');
    console.log(data);

    const groupName = 'DEFAULT_GROUP';
    const instance = new Instance({
      ip: '1.1.1.1',
      port: 8080,
      clusterName: 'NODEJS',
      weight: 1.0,
      metadata: {},
      serviceName,
    });
    let result = await proxy.registerService(serviceName, groupName, instance);
    assert(result === 'ok');
    await sleep(1000);

    data = await proxy.getServiceList(0, 10, 'DEFAULT_GROUP');
    console.log(data);

    result = await proxy.deregisterService(serviceName, instance);
    assert(result === 'ok');

    await proxy.close();
  });

  describe('endpoint', () => {
    let server;
    before(done => {
      server = http.createServer((req, res) => {
        res.writeHead(200, { 'Content-Type': 'application/text' });
        res.end('127.0.0.1:8848');
      });
      server.listen(8849, done);
    });
    after(done => {
      server.once('close', done);
      server.close();
    });

    it('should get serverList from endpoint', async () => {
      const proxy = new NameProxy({
        logger,
        endpoint: '127.0.0.1:8849',
        vipSrvRefInterMillis: 5000,
      });
      await proxy.ready();

      assert(proxy.serverList && proxy.serverList.length === 0);
      assert(proxy.serversFromEndpoint && proxy.serversFromEndpoint.length === 1);

      assert(proxy.lastSrvRefTime > 0);

      const isHealthy = await proxy.serverHealthy();
      assert(isHealthy);

      await sleep(6000);

      const lastSrvRefTime = proxy.lastSrvRefTime;
      assert(Date.now() - lastSrvRefTime < 5000);
      await proxy._refreshSrvIfNeed();
      assert(proxy.lastSrvRefTime === lastSrvRefTime);

      await proxy.close();
    });

    it('should not healthy', async () => {
      const proxy = new NameProxy({
        logger,
        endpoint: 'unknown.com',
      });
      await proxy.ready();

      const isHealthy = await proxy.serverHealthy();
      assert(!isHealthy);

      await proxy.close();
    });
  });
});
