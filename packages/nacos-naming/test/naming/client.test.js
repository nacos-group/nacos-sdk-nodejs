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
  after(async () => {
    await client.close();
  });

  it('should registerInstance & deregisterInstance ok', async function() {
    client.subscribe({
      serviceName,
      clusters: 'NODEJS',
    }, hosts => {
      console.log(hosts);
      client.emit('update', hosts);
    });

    const instance_1 = {
      ip: '1.1.1.1',
      port: 8080,
      clusterName: 'NODEJS',
    };
    const instance_2 = {
      ip: '2.2.2.2',
      port: 8080,
      clusterName: 'NODEJS',
    };

    client.registerInstance(serviceName, instance_1);
    client.registerInstance(serviceName, instance_2);

    let hosts = [];

    while (hosts.length !== 2) {
      hosts = await client.await('update');
    }

    assert(hosts.find(host => host.ip === '1.1.1.1' && host.port === 8080));
    assert(hosts.find(host => host.ip === '2.2.2.2' && host.port === 8080));

    client.deregisterInstance(serviceName, instance_1);

    while (hosts.length !== 1) {
      hosts = await client.await('update');
    }

    assert(hosts.find(host => host.ip === '2.2.2.2' && host.port === 8080));

    client.deregisterInstance(serviceName, instance_2);

    while (hosts.length !== 0) {
      hosts = await client.await('update');
    }

    client.unSubscribe({
      serviceName,
      clusters: 'NODEJS',
    });
  });

  it('should registerInstance & deregisterInstance with default cluster ok', async function() {
    client.subscribe(serviceName, hosts => {
      console.log(hosts);
      client.emit('update', hosts);
    });

    const instance_1 = {
      ip: '1.1.1.1',
      port: 8080,
    };
    const instance_2 = {
      ip: '2.2.2.2',
      port: 8080,
    };

    client.registerInstance(serviceName, instance_1);
    client.registerInstance(serviceName, instance_2);

    let hosts = [];

    while (hosts.length !== 2) {
      hosts = await client.await('update');
    }

    assert(hosts.find(host => host.ip === '1.1.1.1' && host.port === 8080));
    assert(hosts.find(host => host.ip === '2.2.2.2' && host.port === 8080));

    client.deregisterInstance(serviceName, instance_1);

    while (hosts.length !== 1) {
      hosts = await client.await('update');
    }

    assert(hosts.find(host => host.ip === '2.2.2.2' && host.port === 8080));

    client.deregisterInstance(serviceName, instance_2);

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
    let hosts = await client.getAllInstances(serviceName);
    console.log(hosts);
    const host = hosts.find(host => {
      return host.ip === '1.1.1.1' && host.port === 8888;
    });
    assert.deepEqual(host.metadata, { foo: 'bar', xxx: 'yyy' });

    hosts = null;
    client.subscribe(serviceName, val => {
      hosts = val;
    });

    await sleep(10000);
    assert(hosts && hosts.length === 1);
    assert(hosts[0].ip === '1.1.1.1');
  });

  it('should getAllInstances ok', async function() {
    const serviceName = 'nodejs.test.getAllInstances' + process.versions.node;
    const instance_1 = {
      ip: '1.1.1.1',
      port: 8080,
      clusterName: 'NODEJS',
    };
    const instance_2 = {
      ip: '2.2.2.2',
      port: 8080,
      clusterName: 'OTHERS',
    };
    await client.registerInstance(serviceName, instance_1);
    await client.registerInstance(serviceName, instance_2);
    await sleep(2000);

    let hosts = await client.getAllInstances(serviceName);
    assert(hosts.length === 2);
    assert(hosts.find(host => host.ip === '1.1.1.1' && host.port === 8080));
    assert(hosts.find(host => host.ip === '2.2.2.2' && host.port === 8080));

    hosts = await client.getAllInstances(serviceName, 'DEFAULT_GROUP', 'NODEJS,OTHERS');
    assert(hosts.length === 2);
    assert(hosts.find(host => host.ip === '1.1.1.1' && host.port === 8080));
    assert(hosts.find(host => host.ip === '2.2.2.2' && host.port === 8080));

    hosts = await client.getAllInstances(serviceName, 'DEFAULT_GROUP', 'NODEJS,OTHERS', false);
    assert(hosts.length === 2);
    assert(hosts.find(host => host.ip === '1.1.1.1' && host.port === 8080));
    assert(hosts.find(host => host.ip === '2.2.2.2' && host.port === 8080));

    hosts = await client.getAllInstances(serviceName, 'DEFAULT_GROUP', 'NODEJS');
    assert(hosts.length === 1);
    assert(hosts.find(host => host.ip === '1.1.1.1' && host.port === 8080));

    await client.deregisterInstance(serviceName, instance_1);
    await client.deregisterInstance(serviceName, instance_2);

    await sleep(2000);

    hosts = await client.getAllInstances(serviceName);
    assert(hosts.length === 0);
  });

  it('should selectInstances ok', async function() {
    const serviceName = 'nodejs.test.selectInstance' + process.versions.node;
    const instance_1 = {
      ip: '11.11.11.11',
      port: 8080,
      healthy: true,
      clusterName: 'NODEJS',
      ephemeral: false,
    };
    const instance_2 = {
      ip: '22.22.22.22',
      port: 8080,
      healthy: false,
      clusterName: 'OTHERS',
      ephemeral: false,
    };
    const instance_3 = {
      ip: '33.33.33.33',
      port: 8080,
      healthy: true,
      clusterName: 'OTHERS',
      ephemeral: false,
    };
    await client.registerInstance(serviceName, instance_1);
    await client.registerInstance(serviceName, instance_2);
    await client.registerInstance(serviceName, instance_3);
    await sleep(2000);

    let hosts = await client.selectInstances(serviceName);
    assert(hosts.length === 2);
    assert(hosts.find(host => host.ip === '11.11.11.11' && host.port === 8080));
    assert(hosts.find(host => host.ip === '33.33.33.33' && host.port === 8080));

    hosts = await client.selectInstances(serviceName, 'DEFAULT_GROUP', 'NODEJS,OTHERS');
    assert(hosts.length === 2);
    assert(hosts.find(host => host.ip === '11.11.11.11' && host.port === 8080));
    assert(hosts.find(host => host.ip === '33.33.33.33' && host.port === 8080));

    hosts = await client.selectInstances(serviceName, 'DEFAULT_GROUP', 'NODEJS,OTHERS', false, false);
    assert(hosts.length === 1);
    // assert(hosts.find(host => host.ip === '1.1.1.1' && host.port === 8080));
    assert(hosts.find(host => host.ip === '22.22.22.22' && host.port === 8080));

    hosts = await client.selectInstances(serviceName, 'DEFAULT_GROUP', 'OTHERS');
    assert(hosts.length === 1);
    assert(hosts.find(host => host.ip === '33.33.33.33' && host.port === 8080));

    hosts = await client.selectInstances(serviceName, 'DEFAULT_GROUP', 'OTHERS', false);
    assert(hosts.length === 1);
    assert(hosts.find(host => host.ip === '22.22.22.22' && host.port === 8080));

    await client.deregisterInstance(serviceName, instance_1);
    await client.deregisterInstance(serviceName, instance_2);
    await client.deregisterInstance(serviceName, instance_3);

    await sleep(2000);

    hosts = await client.selectInstances(serviceName);
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
