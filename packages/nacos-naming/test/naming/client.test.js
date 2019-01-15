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
const sleep = require('mz-modules/sleep');
const NacosNamingClient = require('../../lib/naming/client');

const logger = console;

const serviceName = 'nodejs.test.' + process.versions.node;

describe('test/naming/client.test.js', () => {
  let client;
  before(async function() {
    client = new NacosNamingClient({
      logger,
      serverList: '127.0.0.1:8848',
    });
    await client.ready();
  });
  afterEach(mm.restore);
  after(() => {
    client.close();
  });

  it('should registerInstance & deregisterInstance ok', async function() {
    client.subscribe(serviceName, hosts => {
      console.log(hosts);
      client.emit('update', hosts);
    });

    client.registerInstance(serviceName, '1.1.1.1', 8080, 'NODEJS');
    client.registerInstance(serviceName, '2.2.2.2', 8080, 'NODEJS');

    let hosts = [];

    while (hosts.length !== 2) {
      hosts = await client.await('update');
    }

    assert(hosts.find(host => host.ip === '1.1.1.1' && host.port === 8080));
    assert(hosts.find(host => host.ip === '2.2.2.2' && host.port === 8080));

    client.deregisterInstance(serviceName, '1.1.1.1', 8080, 'NODEJS');

    while (hosts.length !== 1) {
      hosts = await client.await('update');
    }

    assert(hosts.find(host => host.ip === '2.2.2.2' && host.port === 8080));

    client.deregisterInstance(serviceName, '2.2.2.2', 8080, 'NODEJS');

    while (hosts.length !== 0) {
      hosts = await client.await('update');
    }

    client.unSubscribe(serviceName);
  });

  it('should support registerInstance(serviceName, instance)', async function() {
    const serviceName = 'nodejs.test.xxx.' + process.versions.node;
    await client.registerInstance(serviceName, {
      ip: '1.1.1.1',
      port: 8888,
      metadata: {
        xxx: 'yyy',
        foo: 'bar',
      },
    });
    await sleep(2000);
    const hosts = await client.getAllInstances(serviceName);
    console.log(hosts);
    const host = hosts.find(host => {
      return host.ip === '1.1.1.1' && host.port === 8888;
    });
    assert.deepEqual(host.metadata, { foo: 'bar', xxx: 'yyy' });
  });

  it('should getAllInstances ok', async function() {
    await client.registerInstance(serviceName, '1.1.1.1', 8080, 'NODEJS');
    await client.registerInstance(serviceName, '2.2.2.2', 8080, 'OTHERS');

    await sleep(2000);

    let hosts = await client.getAllInstances(serviceName);
    assert(hosts.length === 2);
    assert(hosts.find(host => host.ip === '1.1.1.1' && host.port === 8080));
    assert(hosts.find(host => host.ip === '2.2.2.2' && host.port === 8080));

    hosts = await client.getAllInstances(serviceName, [ 'NODEJS' ]);
    assert(hosts.length === 1);
    assert(hosts.find(host => host.ip === '1.1.1.1' && host.port === 8080));

    await client.deregisterInstance(serviceName, '1.1.1.1', 8080, 'NODEJS');
    await client.deregisterInstance(serviceName, '2.2.2.2', 8080, 'OTHERS');

    await sleep(2000);

    hosts = await client.getAllInstances(serviceName);
    assert(hosts.length === 0);
  });

  it('should getServerStatus ok', async function() {
    let status = await client.getServerStatus();
    assert(status === 'UP');
    mm(client._serverProxy, 'serverHealthy', () => false);
    status = await client.getServerStatus();
    assert(status === 'DOWN');
  });
});
