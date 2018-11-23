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
        metadata: {},
      }],
    });
    assert(serviceInfo.ipCount === 1);
    assert(serviceInfo.isValid);
    assert(serviceInfo.getKey() === 'xxx@@clusters@@000--00-ALL_IPS--00--000');

    mm(serviceInfo, 'isAllIPs', false);
    assert(serviceInfo.getKey() === 'xxx@@clusters');

    mm(serviceInfo, 'env', 'test');
    assert(serviceInfo.getKey() === 'xxx@@clusters@@test');

    mm(serviceInfo, 'isAllIPs', true);
    assert(serviceInfo.getKey() === 'xxx@@clusters@@test@@000--00-ALL_IPS--00--000');

    mm(serviceInfo, 'clusters', null);
    assert(serviceInfo.getKey() === 'xxx@@@@test@@000--00-ALL_IPS--00--000');

    mm(serviceInfo, 'isAllIPs', false);
    assert(serviceInfo.getKey() === 'xxx@@@@test');

    mm(serviceInfo, 'env', null);
    assert(serviceInfo.getKey() === 'xxx');

    mm(serviceInfo, 'isAllIPs', true);
    assert(serviceInfo.getKey() === 'xxx@@000--00-ALL_IPS--00--000');
    assert(serviceInfo.toString() === 'xxx@@000--00-ALL_IPS--00--000');
  });

  it('should parse from string', () => {
    let data = ServiceInfo.parse('xxx@@clusters@@000--00-ALL_IPS--00--000');
    assert(data.name === 'xxx');
    assert(data.clusters === 'clusters');
    assert(data.isAllIPs);

    data = ServiceInfo.parse('xxx@@clusters@@test@@000--00-ALL_IPS--00--000');
    assert(data.name === 'xxx');
    assert(data.clusters === 'clusters');
    assert(data.isAllIPs);
    assert(data.env === 'test');

    data = ServiceInfo.parse('xxx@@clusters');
    assert(data.name === 'xxx');
    assert(data.clusters === 'clusters');
    assert(!data.isAllIPs);

    data = ServiceInfo.parse('xxx@@clusters@@test');
    assert(data.name === 'xxx');
    assert(data.clusters === 'clusters');
    assert(data.env === 'test');
    assert(!data.isAllIPs);

    data = ServiceInfo.parse('xxx@@000--00-ALL_IPS--00--000');
    assert(data.name === 'xxx');
    assert(!data.clusters);
    assert(!data.env);
    assert(data.isAllIPs);
  });
});
