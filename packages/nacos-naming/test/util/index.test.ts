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

import * as assert from 'assert';
import * as zlib from 'zlib';
import { tryDecompress, getGroupedName, getServiceName, getGroupName, sign } from '../../src/utils';

describe('test/util/index.test.js', () => {
  it('should tryDecompress ok', () => {
    const buf = Buffer.from('hello world');
    assert.deepEqual(tryDecompress(buf), buf);

    const zipped = zlib.gzipSync(buf);
    assert.deepEqual(tryDecompress(zipped), buf);
  });

  it('should getGroupedName ok', () => {
    const serviceWithGroupName = getGroupedName('serviceName', 'groupName');
    assert(serviceWithGroupName === 'groupName@@serviceName');
  });

  it('should getServiceName ok', () => {
    assert(getServiceName('groupName@@serviceName') === 'serviceName');
    assert(getServiceName('serviceName') === 'serviceName');
  });

  it('should getGroupName ok', () => {
    assert(getGroupName('groupName@@serviceName') === 'groupName');
    assert(getGroupName('serviceName') === 'DEFAULT_GROUP');
  });

  it('should sign ok', () => {
    const result = sign('1556606455782@@nodejs.test', 'xxxxxx');
    assert(result === 'hhmW6gWCqR0g8dctGZXQclYomYg=');
  });
});
