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
const aliyunAuth = require('../../lib/util/aliyun_auth');

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

  it('should build aliyun naming auth params with legacy credentials', () => {
    const params = aliyunAuth.buildNamingAuthParams('nodejs.test', {
      accessKeyId: 'ak',
      accessKeySecret: 'sk',
      appName: 'app',
    });
    assert(params.data.endsWith('@@nodejs.test'));
    assert(params.signature === util.sign(params.data, 'sk'));
    assert(params.ak === 'ak');
    assert(params.app === 'app');
  });

  it('should build aliyun naming auth params with static sts credentials', () => {
    const credentials = aliyunAuth.resolveAliyunCredentials({
      alibabaCloudAccessKeyId: 'stsAk',
      alibabaCloudAccessKeySecret: 'stsSk',
      alibabaCloudSecurityToken: 'stsToken',
      appName: 'app',
    });
    const params = aliyunAuth.buildNamingAuthParams('nodejs.test', credentials);

    assert(credentials.accessKeyId === 'stsAk');
    assert(credentials.accessKeySecret === 'stsSk');
    assert(credentials.securityToken === 'stsToken');
    assert(params.ak === 'stsAk');
    assert(params['Spas-SecurityToken'] === 'stsToken');
  });

  it('should resolve aliyun naming credentials from env without overriding legacy token behavior', () => {
    const oldAccessKeyId = process.env.ALIBABA_CLOUD_ACCESS_KEY_ID;
    const oldAccessKeySecret = process.env.ALIBABA_CLOUD_ACCESS_KEY_SECRET;
    const oldSecurityToken = process.env.ALIBABA_CLOUD_SECURITY_TOKEN;
    const oldSignatureRegionId = process.env.ALIBABA_CLOUD_SIGNATURE_REGION_ID;
    try {
      process.env.ALIBABA_CLOUD_ACCESS_KEY_ID = 'envAk';
      process.env.ALIBABA_CLOUD_ACCESS_KEY_SECRET = 'envSk';
      process.env.ALIBABA_CLOUD_SECURITY_TOKEN = 'envToken';
      process.env.ALIBABA_CLOUD_SIGNATURE_REGION_ID = 'cn-hangzhou';

      let credentials = aliyunAuth.resolveAliyunCredentials({});
      assert(credentials.accessKeyId === 'envAk');
      assert(credentials.accessKeySecret === 'envSk');
      assert(credentials.securityToken === 'envToken');
      assert(credentials.signatureRegionId === 'cn-hangzhou');

      credentials = aliyunAuth.resolveAliyunCredentials({
        ak: 'legacyAk',
        sk: 'legacySk',
      });
      assert(credentials.accessKeyId === 'legacyAk');
      assert(credentials.accessKeySecret === 'legacySk');
      assert(!credentials.securityToken);
      assert(!credentials.signatureRegionId);
    } finally {
      if (oldAccessKeyId === undefined) {
        delete process.env.ALIBABA_CLOUD_ACCESS_KEY_ID;
      } else {
        process.env.ALIBABA_CLOUD_ACCESS_KEY_ID = oldAccessKeyId;
      }
      if (oldAccessKeySecret === undefined) {
        delete process.env.ALIBABA_CLOUD_ACCESS_KEY_SECRET;
      } else {
        process.env.ALIBABA_CLOUD_ACCESS_KEY_SECRET = oldAccessKeySecret;
      }
      if (oldSecurityToken === undefined) {
        delete process.env.ALIBABA_CLOUD_SECURITY_TOKEN;
      } else {
        process.env.ALIBABA_CLOUD_SECURITY_TOKEN = oldSecurityToken;
      }
      if (oldSignatureRegionId === undefined) {
        delete process.env.ALIBABA_CLOUD_SIGNATURE_REGION_ID;
      } else {
        process.env.ALIBABA_CLOUD_SIGNATURE_REGION_ID = oldSignatureRegionId;
      }
    }
  });

  it('should build aliyun naming auth params with v4 signature', () => {
    const expectedV4Key = '6qedNinbBK9xTBPtLzmqJMJTlAPB8WaXt3IKrbcu31I=';
    const v4Key = aliyunAuth.calculateV4SigningKey('secretKey', 'cn-hangzhou', '20260102');
    assert(v4Key === expectedV4Key);

    const credentials = aliyunAuth.resolveAliyunCredentials({
      ak: 'accessKey',
      sk: 'secretKey',
      signatureRegionId: 'cn-hangzhou',
    });
    const params = aliyunAuth.buildNamingAuthParams('nodejs.test', credentials);
    const signatureKey = aliyunAuth.calculateV4SigningKey('secretKey', 'cn-hangzhou');

    assert(params.signatureVersion === 'v4');
    assert(params.signature === util.sign(params.data, signatureKey));
  });

  it('should resolve aliyun naming credentials from credentials uri with cache', async () => {
    let count = 0;
    const options = {
      alibabaCloudCredentialsUri: 'http://credentials.local',
      httpclient: {
        request: async url => {
          count++;
          assert(url === 'http://credentials.local');
          return {
            status: 200,
            data: JSON.stringify({
              AccessKeyId: 'uriAk',
              AccessKeySecret: 'uriSk',
              SecurityToken: 'uriToken',
              Expiration: '2999-01-01T00:00:00Z',
            }),
          };
        },
      },
    };

    let credentials = await aliyunAuth.resolveAliyunCredentialsAsync(options);
    assert(credentials.accessKeyId === 'uriAk');
    assert(credentials.accessKeySecret === 'uriSk');
    assert(credentials.securityToken === 'uriToken');

    credentials = await aliyunAuth.resolveAliyunCredentialsAsync(options);
    assert(credentials.accessKeyId === 'uriAk');
    assert(count === 1);
  });

  it('should resolve aliyun naming credentials from java style security credentials', async () => {
    const credentials = await aliyunAuth.resolveAliyunCredentialsAsync({
      'security.credentials': JSON.stringify({
        AccessKeyId: 'securityAk',
        AccessKeySecret: 'securitySk',
        SecurityToken: 'securityToken',
      }),
    });

    assert(credentials.accessKeyId === 'securityAk');
    assert(credentials.accessKeySecret === 'securitySk');
    assert(credentials.securityToken === 'securityToken');
  });

  it('should resolve aliyun naming credentials from custom provider', async () => {
    const credentials = await aliyunAuth.resolveAliyunCredentialsAsync({
      signatureRegionId: 'cn-hangzhou',
      aliyunCredentialsProvider: async () => {
        return {
          AccessKeyId: 'providerAk',
          AccessKeySecret: 'providerSk',
          SecurityToken: 'providerToken',
        };
      },
    });

    assert(credentials.accessKeyId === 'providerAk');
    assert(credentials.accessKeySecret === 'providerSk');
    assert(credentials.securityToken === 'providerToken');
    assert(credentials.signatureRegionId === 'cn-hangzhou');
  });

  it('should not build aliyun naming auth params without credentials', () => {
    assert(!aliyunAuth.buildNamingAuthParams('nodejs.test', {}));
  });
});
