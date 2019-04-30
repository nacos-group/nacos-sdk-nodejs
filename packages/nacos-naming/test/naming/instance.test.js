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
const Instance = require('../../lib/naming/instance');

describe('test/naming/instance.test.js', () => {
  it('should new instance ok', () => {
    const instance1 = new Instance({
      ip: '1.1.1.1',
      port: 8888,
      valid: true,
      enabled: false,
    });
    assert(instance1.toString() === '{"ip":"1.1.1.1","port":8888,"weight":1,"healthy":true,"enabled":false,"ephemeral":true,"clusterName":"DEFAULT","metadata":{}}');
    assert(instance1.toInetAddr() === '1.1.1.1:8888');

    const instance2 = new Instance({
      ip: '1.1.1.1',
      port: 8888,
      healthy: true,
      enabled: false,
    });
    assert(instance2.toString() === '{"ip":"1.1.1.1","port":8888,"weight":1,"healthy":true,"enabled":false,"ephemeral":true,"clusterName":"DEFAULT","metadata":{}}');
    assert(instance2.toInetAddr() === '1.1.1.1:8888');

    assert(instance1.equal(instance2));

    const instance3 = new Instance({
      ip: '1.1.1.1',
      port: 8888,
    });
    assert(instance3.toString() === '{"ip":"1.1.1.1","port":8888,"weight":1,"healthy":true,"enabled":true,"ephemeral":true,"clusterName":"DEFAULT","metadata":{}}');
    assert(instance3.toInetAddr() === '1.1.1.1:8888');

    assert(!instance1.equal(instance3));
    assert(!instance3.equal(instance2));
  });
});
