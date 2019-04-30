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
const Instance = require('../../lib/naming/instance');
const HostReactor = require('../../lib/naming/host_reactor');

const logger = console;
const serviceName = 'nodejs.test.' + process.versions.node;
const groupName = 'DEFAULT_GROUP';
const serviceNameWithGroup = groupName + '@@' + serviceName;

describe('test/naming/host_reactor.test.js', () => {
  let serverProxy;
  before(async () => {
    serverProxy = new NameProxy({
      logger,
      serverList: '127.0.0.1:8848',
    });
    await serverProxy.ready();
  });
  after(async () => {
    await serverProxy.close();
  });
  afterEach(mm.restore);

  it('should ok', async function() {
    const hostReactor = new HostReactor({
      logger,
      serverProxy,
    });
    await hostReactor.ready();

    hostReactor.subscribe({
      serviceName: serviceNameWithGroup,
      clusters: 'NODEJS',
    }, hosts => {
      hostReactor.emit('update', hosts);
    });

    const instance = new Instance({
      ip: '1.1.1.1',
      port: 8080,
      serviceName,
      clusterName: 'NODEJS',
      weight: 1.0,
      valid: true,
      enabled: true,
    });
    serverProxy.registerService(serviceNameWithGroup, groupName, instance);

    let hosts = [];

    while (hosts.length !== 1) {
      hosts = await hostReactor.await('update');
    }
    assert(hosts.some(host => host.ip === '1.1.1.1' && host.port === 8080));

    const key = serviceNameWithGroup + '@@NODEJS';
    console.log(hostReactor.getServiceInfoMap);
    assert(hostReactor.getServiceInfoMap && hostReactor.getServiceInfoMap[key]);

    hostReactor.processServiceJSON(JSON.stringify({
      metadata: {},
      dom: serviceNameWithGroup,
      cacheMillis: 10000,
      useSpecifiedURL: false,
      hosts: null,
      name: serviceNameWithGroup,
      checksum: 'cc4e0ff13773c6d443d9ba0532b32810',
      lastRefTime: 1556603044852,
      env: '',
      clusters: 'NODEJS',
    }));
    assert(hostReactor.getServiceInfoMap[key].hosts.length === 1);

    hostReactor.processServiceJSON(JSON.stringify({
      metadata: {},
      dom: serviceNameWithGroup,
      cacheMillis: 10000,
      useSpecifiedURL: false,
      hosts: hostReactor.getServiceInfoMap[key].hosts,
      name: serviceNameWithGroup,
      checksum: 'cc4e0ff13773c6d443d9ba0532b32811',
      lastRefTime: 1556603044852,
      env: '',
      clusters: 'NODEJS',
    }));
    assert(hostReactor.getServiceInfoMap[key].hosts.length === 1);

    hostReactor.processServiceJSON(JSON.stringify({
      metadata: {},
      dom: serviceNameWithGroup,
      cacheMillis: 10000,
      useSpecifiedURL: false,
      hosts: hostReactor.getServiceInfoMap[key].hosts.map(host => {
        return Object.assign({}, host, { enabled: false });
      }),
      name: serviceNameWithGroup,
      checksum: 'cc4e0ff13773c6d443d9ba0532b32812',
      lastRefTime: 1556603044852,
      env: '',
      clusters: 'NODEJS',
    }));
    assert(hostReactor.getServiceInfoMap[key].hosts.length === 1);
    assert(!hostReactor.getServiceInfoMap[key].hosts[0].enabled);

    hostReactor.processServiceJSON(JSON.stringify({
      metadata: {},
      dom: 'mock_dom',
      cacheMillis: 10000,
      useSpecifiedURL: false,
      hosts: hostReactor.getServiceInfoMap[key].hosts,
      name: 'mock_dom',
      checksum: 'cc4e0ff13773c6d443d9ba0532b32813',
      lastRefTime: 1556603044852,
      env: '',
      clusters: 'NODEJS',
    }));
    assert(hostReactor.getServiceInfoMap['mock_dom@@NODEJS']);

    serverProxy.deregisterService(serviceName, instance);

    while (hosts.length !== 0) {
      hosts = await hostReactor.await('update');
    }

    const listener = hosts => {
      assert(hosts.length === 0);
    };
    hostReactor.subscribe({
      serviceName: serviceNameWithGroup,
      clusters: 'NODEJS',
    }, listener);
    hostReactor.unSubscribe({
      serviceName: serviceNameWithGroup,
      clusters: 'NODEJS',
    }, listener);

    await hostReactor.close();
  });

  it('should updateServiceNow ok', async () => {
    const hostReactor = new HostReactor({
      logger,
      serverProxy,
    });
    await hostReactor.ready();

    const arr = await Promise.all([
      hostReactor.getServiceInfo(serviceNameWithGroup, 'NODEJS'),
      hostReactor.getServiceInfo(serviceNameWithGroup, 'NODEJS'),
    ]);
    assert(arr && arr.length === 2);
    assert(arr.every(item => !!item));

    await hostReactor.close();
  });

  it('should emit error if serverProxy.queryList failed', async () => {
    mm.error(serverProxy, 'queryList', 'mock error');

    const hostReactor = new HostReactor({
      logger,
      serverProxy,
    });
    await hostReactor.ready();

    hostReactor.updateServiceNow(serviceNameWithGroup, 'NODEJS');

    await assert.rejects(async () => {
      await hostReactor.await('error');
    }, /failed to update serviceName/);

    hostReactor.refreshOnly(serviceNameWithGroup, 'NODEJS');

    await assert.rejects(async () => {
      await hostReactor.await('error');
    }, /failed to update serviceName/);

    await hostReactor.close();
  });
});
