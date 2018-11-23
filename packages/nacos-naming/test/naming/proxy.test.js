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
const assert = require('assert');
const NameProxy = require('../../lib/naming/proxy');

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
    let result = await proxy.registerService(serviceName, {
      ip: '1.1.1.1',
      port: 8080,
      clusterName: 'NODEJS',
      weight: 1.0,
      metadata: {},
    });
    assert(result === 'ok');

    let jsonStr = await proxy.reqAPI('/nacos/v1/ns/instances', {
      serviceName,
    }, 'GET');
    let serviceInfo = JSON.parse(jsonStr);

    assert(serviceInfo && serviceInfo.dom === serviceName);
    assert(serviceInfo.hosts && serviceInfo.hosts.length === 1);
    assert(serviceInfo.hosts[0].ip === '1.1.1.1');
    assert(serviceInfo.hosts[0].port === 8080);

    result = await proxy.deregisterService(serviceName, '1.1.1.1', 8080, 'NODEJS');
    assert(result === 'ok');

    jsonStr = await proxy.reqAPI('/nacos/v1/ns/instances', {
      serviceName,
    }, 'GET');
    serviceInfo = JSON.parse(jsonStr);

    assert(serviceInfo && serviceInfo.dom === serviceName);
    assert(serviceInfo.hosts && serviceInfo.hosts.length === 0);
  });

  it('should serverHealthy ok', async function() {
    const proxy = new NameProxy({
      logger,
      serverList: '127.0.0.1:8848',
    });
    await proxy.ready();

    let isHealthy = await proxy.serverHealthy();
    assert(isHealthy);

    mm.http.request(/\/nacos\/v1\/ns\/api\/hello/, '', {
      statusCode: 304,
    });

    isHealthy = await proxy.serverHealthy();
    assert(isHealthy);

    mm.http.request(/\/nacos\/v1\/ns\/api\/hello/, '', {
      statusCode: 500,
    });

    isHealthy = await proxy.serverHealthy();
    assert(!isHealthy);
  });

  it('should failed if no server available', async function() {
    const proxy = new NameProxy({
      logger,
      serverList: '',
    });
    await proxy.ready();

    const isHealthy = await proxy.serverHealthy();
    assert(!isHealthy);
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

    mm.http.request(/\/nacos\/v1\/ns\/api\/hello/, '', {
      statusCode: 500,
    });

    isHealthy = await proxy.serverHealthy();
    assert(!isHealthy);
  });
});
