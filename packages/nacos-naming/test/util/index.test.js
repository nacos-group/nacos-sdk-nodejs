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

const zlib = require('zlib');
const assert = require('assert');
const util = require('../../lib/util');

describe('test/util/index.test.js', () => {
  it('should tryDecompress ok', () => {
    const buf = Buffer.from('hello world');
    assert.deepEqual(util.tryDecompress(buf), buf);

    const zipped = zlib.gzipSync(buf);
    assert.deepEqual(util.tryDecompress(zipped), buf);
  });

  it('should getGroupedName ok', () => {
    const serviceWithGroupName = util.getGroupedName('serviceName', 'groupName');
    assert(serviceWithGroupName === 'groupName@@serviceName');
  });

  it('should getServiceName ok', () => {
    assert(util.getServiceName('groupName@@serviceName') === 'serviceName');
    assert(util.getServiceName('serviceName') === 'serviceName');
  });

  it('should getGroupName ok', () => {
    assert(util.getGroupName('groupName@@serviceName') === 'groupName');
    assert(util.getGroupName('serviceName') === 'DEFAULT_GROUP');
  });

  it('should sign ok', () => {
    const result = util.sign('1556606455782@@nodejs.test', 'xxxxxx');
    assert(result === 'hhmW6gWCqR0g8dctGZXQclYomYg=');
  });
});
