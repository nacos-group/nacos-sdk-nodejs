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

const utils = require('./');

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
    appName: options.appName,
  };
};

exports.getNamingSignData = serviceName => {
  return serviceName ? Date.now() + '@@' + serviceName : Date.now() + '';
};

exports.buildNamingAuthParams = (serviceName, credentials) => {
  if (!credentials.accessKeyId && !credentials.accessKeySecret) return null;

  const signData = exports.getNamingSignData(serviceName);
  const params = {
    signature: utils.sign(signData, credentials.accessKeySecret),
    data: signData,
    ak: credentials.accessKeyId,
    app: credentials.appName,
  };
  if (credentials.securityToken) {
    params['Spas-SecurityToken'] = credentials.securityToken;
  }
  return params;
};
