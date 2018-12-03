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

const assert = require('assert');
const NameProxy = require('../../lib/naming/proxy');
const Instance = require('../../lib/naming/instance');
const HostReactor = require('../../lib/naming/host_reactor');

const logger = console;
const serviceName = 'nodejs.test.' + process.versions.node;

describe('test/naming/host_reactor.test.js', () => {
  it('should ok', async function() {
    const serverProxy = new NameProxy({
      logger,
      serverList: '127.0.0.1:8848',
    });
    const hostReactor = new HostReactor({
      logger,
      serverProxy,
    });
    await hostReactor.ready();

    hostReactor.subscribe({
      serviceName,
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
    serverProxy.registerService(serviceName, instance);

    let hosts = [];

    while (hosts.length !== 1) {
      hosts = await hostReactor.await('update');
    }
    assert(hosts.find(host => host.ip === '1.1.1.1' && host.port === 8080));

    console.log(hostReactor.getServiceInfoMap);
    assert(hostReactor.getServiceInfoMap && hostReactor.getServiceInfoMap[serviceName]);

    hostReactor.processServiceJSON(JSON.stringify({
      dom: serviceName,
      clusters: '',
      isAllIPs: false,
      cacheMillis: 10000,
      hosts: null,
      lastRefTime: 1542806333263,
      checksum: 'c1762ddd16f512ae13bcf2c5a07e2e221542806333263',
      env: '',
    }));
    assert(hostReactor.getServiceInfoMap[serviceName].hosts.length === 1);

    hostReactor.processServiceJSON(JSON.stringify({
      dom: serviceName,
      clusters: '',
      isAllIPs: false,
      cacheMillis: 10000,
      hosts: hostReactor.getServiceInfoMap[serviceName].hosts,
      lastRefTime: 1542806333262,
      checksum: 'c1762ddd16f512ae13bcf2c5a07e2e221542806333263',
      env: '',
    }));
    assert(hostReactor.getServiceInfoMap[serviceName].hosts.length === 1);

    hostReactor.processServiceJSON(JSON.stringify({
      dom: serviceName,
      clusters: '',
      isAllIPs: false,
      cacheMillis: 10000,
      hosts: hostReactor.getServiceInfoMap[serviceName].hosts.map(host => {
        return Object.assign({}, host, { enabled: false });
      }),
      lastRefTime: 1542806333262,
      checksum: 'c1762ddd16f512ae13bcf2c5a07e2e221542806333263',
      env: '',
    }));
    assert(hostReactor.getServiceInfoMap[serviceName].hosts.length === 1);
    assert(!hostReactor.getServiceInfoMap[serviceName].hosts[0].enabled);

    hostReactor.processServiceJSON(JSON.stringify({
      dom: serviceName + '_1',
      clusters: '',
      isAllIPs: false,
      cacheMillis: 10000,
      hosts: hostReactor.getServiceInfoMap[serviceName].hosts,
      lastRefTime: 1542806333263,
      checksum: 'c1762ddd16f512ae13bcf2c5a07e2e221542806333263',
      env: '',
    }));
    assert(hostReactor.getServiceInfoMap[serviceName + '_1']);

    serverProxy.deregisterService(serviceName, instance.ip, instance.port, instance.clusterName);

    while (hosts.length !== 0) {
      hosts = await hostReactor.await('update');
    }

    const listener = hosts => {
      assert(hosts.length === 0);
    };
    hostReactor.subscribe({
      serviceName,
    }, listener);
    hostReactor.unSubscribe({
      serviceName,
    }, listener);

    hostReactor.close();
  });

  it('should updateService4AllIPNow ok', async function() {
    const serverProxy = new NameProxy({
      logger,
      serverList: '127.0.0.1:8848',
    });
    const hostReactor = new HostReactor({
      logger,
      serverProxy,
    });
    await hostReactor.ready();

    const arr = await Promise.all([
      hostReactor.getServiceInfo({
        serviceName,
        allIPs: true,
      }),
      hostReactor.getServiceInfo({
        serviceName,
        allIPs: true,
      }),
    ]);
    console.log(arr);

    hostReactor.close();
  });
});
