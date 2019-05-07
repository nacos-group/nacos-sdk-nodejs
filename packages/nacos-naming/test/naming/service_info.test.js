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
const ServiceInfo = require('../../lib/naming/service_info');

describe('test/naming/service_info.test.js', () => {
  afterEach(mm.restore);

  it('should new ServiceInfo', () => {
    const serviceInfo = new ServiceInfo({
      name: 'xxx',
      clusters: 'clusters',
      allIPs: true,
      hosts: [{
        instanceId: 'instanceId',
        ip: '1.1.1.1',
        port: 80,
        weight: 1.0,
        valid: true,
        enabled: true,
        ephemeral: true,
        metadata: {},
      }],
    });
    assert(serviceInfo.ipCount === 1);
    assert(serviceInfo.isValid);
    assert(serviceInfo.getKey() === 'xxx@@clusters');

    mm(serviceInfo, 'isAllIPs', false);
    assert(serviceInfo.getKey() === 'xxx@@clusters');

    mm(serviceInfo, 'env', 'test');
    assert(serviceInfo.getKey() === 'xxx@@clusters');

    mm(serviceInfo, 'isAllIPs', true);
    assert(serviceInfo.getKey() === 'xxx@@clusters');

    mm(serviceInfo, 'clusters', null);
    assert(serviceInfo.getKey() === 'xxx');

    mm(serviceInfo, 'isAllIPs', false);
    assert(serviceInfo.getKey() === 'xxx');

    mm(serviceInfo, 'isAllIPs', true);
    assert(serviceInfo.getKey() === 'xxx');
    assert(serviceInfo.toString() === 'xxx');
  });

  it('should parse from string', () => {
    let data = ServiceInfo.fromKey('DEFAULT_GROUP@@xxx');
    assert(data.name === 'xxx');
    assert(data.groupName === 'DEFAULT_GROUP');
    assert(!data.clusters);
    assert(!data.isAllIPs);

    data = ServiceInfo.fromKey('DEFAULT_GROUP@@xxx@@clusters');
    assert(data.name === 'xxx');
    assert(data.clusters === 'clusters');
    assert(!data.isAllIPs);
    assert(data.groupName === 'DEFAULT_GROUP');

    data = ServiceInfo.fromKey('xxx');
    assert(!data.name);
    assert(!data.clusters);
    assert(!data.isAllIPs);
    assert(!data.groupName);
  });
});
