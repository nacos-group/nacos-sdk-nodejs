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
import { getMD5String } from '../src/utils';
import { buildConfigAuthHeaders, calculateV4SigningKey, resolveAliyunCredentials } from '../src/aliyun_auth';
import { createDefaultConfiguration } from './utils';
import * as crypto from 'crypto';

const assert = require('assert');

describe('test/utils.test.ts', function() {
  it('should getMD5String ok', function() {
    const str = '172.24.13.28:5198#172.24.30.28:5198#172.23.13.10:5198#172.23.14.46:5198#group3#100#Mon Mar 20 13:32:49 CST 2010#online';
    assert(getMD5String(str) === '3001aeb96c243fa3302e42ab2c1a16ad');
  });

  it('should getMD5String ok with 中文', function() {
    const str = 'cashier.function.switcher.status=on\ncashier.function.switcher.whiteListStrategy.tbNickPattern=临观|lichen6928|fangyuct01|朱琳1219|xiaoyin1916|简单de老公|奚薇0716|安桔熟了|七空八档|lichen6928|蝶羽轻尘|漂亮一下吧11|xupingan126|qqk2006|tb5808466|江南好吃|zhang_junlong|ct测试账号002|cguo82|';
    assert(getMD5String(str, 'gbk') === 'f7c5371396b7e7c2777a43590d4c5be2');
  });

  it('should build aliyun config auth headers with legacy credentials', function() {
    const configuration = createDefaultConfiguration({
      accessKey: 'accessKey',
      secretKey: 'secretKey',
    });
    const credentials = resolveAliyunCredentials(configuration);
    const headers = buildConfigAuthHeaders({
      tenant: 'tenant',
      group: 'group',
    }, credentials, '1234567890');

    const signature = crypto.createHmac('sha1', 'secretKey')
      .update('tenant+group+1234567890').digest()
      .toString('base64');
    assert(headers[ 'Spas-AccessKey' ] === 'accessKey');
    assert(headers.timeStamp === '1234567890');
    assert(headers[ 'Spas-Signature' ] === signature);
  });

  it('should resolve aliyun config auth headers with static sts credentials', function() {
    const configuration = createDefaultConfiguration({
      alibabaCloudAccessKeyId: 'stsAccessKey',
      alibabaCloudAccessKeySecret: 'stsSecretKey',
      alibabaCloudSecurityToken: 'stsToken',
    });
    const credentials = resolveAliyunCredentials(configuration);
    const headers = buildConfigAuthHeaders({
      tenant: 'tenant',
      group: 'group',
    }, credentials, '1234567890');

    assert(credentials.accessKeyId === 'stsAccessKey');
    assert(credentials.accessKeySecret === 'stsSecretKey');
    assert(credentials.securityToken === 'stsToken');
    assert(headers[ 'Spas-AccessKey' ] === 'stsAccessKey');
    assert(headers[ 'Spas-SecurityToken' ] === 'stsToken');
  });

  it('should resolve aliyun config credentials from env without overriding legacy token behavior', function() {
    const oldAccessKeyId = process.env.ALIBABA_CLOUD_ACCESS_KEY_ID;
    const oldAccessKeySecret = process.env.ALIBABA_CLOUD_ACCESS_KEY_SECRET;
    const oldSecurityToken = process.env.ALIBABA_CLOUD_SECURITY_TOKEN;
    const oldSignatureRegionId = process.env.ALIBABA_CLOUD_SIGNATURE_REGION_ID;
    try {
      process.env.ALIBABA_CLOUD_ACCESS_KEY_ID = 'envAccessKey';
      process.env.ALIBABA_CLOUD_ACCESS_KEY_SECRET = 'envSecretKey';
      process.env.ALIBABA_CLOUD_SECURITY_TOKEN = 'envToken';
      process.env.ALIBABA_CLOUD_SIGNATURE_REGION_ID = 'cn-hangzhou';

      let credentials = resolveAliyunCredentials(createDefaultConfiguration({}));
      assert(credentials.accessKeyId === 'envAccessKey');
      assert(credentials.accessKeySecret === 'envSecretKey');
      assert(credentials.securityToken === 'envToken');
      assert(credentials.signatureRegionId === 'cn-hangzhou');

      credentials = resolveAliyunCredentials(createDefaultConfiguration({
        accessKey: 'legacyAccessKey',
        secretKey: 'legacySecretKey',
      }));
      assert(credentials.accessKeyId === 'legacyAccessKey');
      assert(credentials.accessKeySecret === 'legacySecretKey');
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

  it('should build aliyun config auth headers with v4 signature', function() {
    assert(calculateV4SigningKey('secretKey', 'cn-hangzhou', '20260102') === '6qedNinbBK9xTBPtLzmqJMJTlAPB8WaXt3IKrbcu31I=');

    const credentials = resolveAliyunCredentials(createDefaultConfiguration({
      accessKey: 'accessKey',
      secretKey: 'secretKey',
      signatureRegionId: 'cn-hangzhou',
    }));
    const headers = buildConfigAuthHeaders({
      tenant: 'tenant',
      group: 'group',
    }, credentials, '1234567890');
    const signatureKey = calculateV4SigningKey('secretKey', 'cn-hangzhou');
    const signature = crypto.createHmac('sha1', signatureKey)
      .update('tenant+group+1234567890').digest()
      .toString('base64');

    assert(headers.signatureVersion === 'v4');
    assert(headers[ 'Spas-Signature' ] === signature);
  });
});
