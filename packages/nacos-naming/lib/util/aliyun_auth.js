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

const crypto = require('crypto');
const utils = require('./');

const V4_PREFIX = 'aliyun_v4';
const V4_REQUEST = 'aliyun_v4_request';
const V4_PRODUCT = 'mse-nacos';
const V4_SIGNATURE_VERSION = 'v4';

function firstNotEmpty(values) {
  for (const value of values) {
    if (value !== undefined && value !== null && value !== '') {
      return value;
    }
  }
}

exports.resolveAliyunCredentials = options => {
  const legacyAccessKeyId = options.ak;
  const legacyAccessKeySecret = options.sk;
  const hasLegacyCredentials = legacyAccessKeyId || legacyAccessKeySecret;
  const signatureRegionId = options.signatureRegionId;
  return {
    accessKeyId: firstNotEmpty([
      legacyAccessKeyId,
      options.accessKey,
      options.accessKeyId,
      options.alibabaCloudAccessKeyId,
      process.env.ALIBABA_CLOUD_ACCESS_KEY_ID,
    ]),
    accessKeySecret: firstNotEmpty([
      legacyAccessKeySecret,
      options.secretKey,
      options.accessKeySecret,
      options.alibabaCloudAccessKeySecret,
      process.env.ALIBABA_CLOUD_ACCESS_KEY_SECRET,
    ]),
    securityToken: firstNotEmpty([
      options.securityToken,
      options.alibabaCloudSecurityToken,
      hasLegacyCredentials ? undefined : process.env.ALIBABA_CLOUD_SECURITY_TOKEN,
    ]),
    signatureRegionId: firstNotEmpty([
      signatureRegionId,
      hasLegacyCredentials ? undefined : process.env.ALIBABA_CLOUD_SIGNATURE_REGION_ID,
    ]),
    appName: options.appName,
  };
};

exports.getNamingSignData = serviceName => {
  return serviceName ? Date.now() + '@@' + serviceName : Date.now() + '';
};

function hmacSha256(data, key) {
  return crypto.createHmac('sha256', key)
    .update(data).digest();
}

function getUtcSignDate() {
  const date = new Date();
  const year = date.getUTCFullYear();
  const month = ('0' + (date.getUTCMonth() + 1)).slice(-2);
  const day = ('0' + date.getUTCDate()).slice(-2);
  return year + month + day;
}

exports.calculateV4SigningKey = (secret, regionId, signDate = getUtcSignDate()) => {
  const firstKey = hmacSha256(signDate, V4_PREFIX + secret);
  const regionKey = hmacSha256(regionId, firstKey);
  const productKey = hmacSha256(V4_PRODUCT, regionKey);
  return hmacSha256(V4_REQUEST, productKey).toString('base64');
};

exports.getActualAccessKeySecret = credentials => {
  const accessKeySecret = credentials.accessKeySecret || '';
  if (!credentials.signatureRegionId) {
    return accessKeySecret;
  }
  return exports.calculateV4SigningKey(accessKeySecret, credentials.signatureRegionId);
};

exports.buildNamingAuthParams = (serviceName, credentials) => {
  if (!credentials.accessKeyId && !credentials.accessKeySecret) return null;

  const signData = exports.getNamingSignData(serviceName);
  const params = {
    signature: utils.sign(signData, exports.getActualAccessKeySecret(credentials)),
    data: signData,
    ak: credentials.accessKeyId,
    app: credentials.appName,
  };
  if (credentials.securityToken) {
    params['Spas-SecurityToken'] = credentials.securityToken;
  }
  if (credentials.signatureRegionId) {
    params.signatureVersion = V4_SIGNATURE_VERSION;
  }
  return params;
};
