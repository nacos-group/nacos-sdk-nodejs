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
const urllib = require('urllib');
const utils = require('./');

const RAM_SECURITY_CREDENTIALS_URL = 'http://100.100.100.200/latest/meta-data/ram/security-credentials/';
const V4_PREFIX = 'aliyun_v4';
const V4_REQUEST = 'aliyun_v4_request';
const V4_PRODUCT = 'mse-nacos';
const V4_SIGNATURE_VERSION = 'v4';
const DEFAULT_REFRESH_BEFORE_EXPIRE = 3 * 60 * 1000;
const credentialCache = new WeakMap();

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

function normalizeAliyunCredentials(data, signatureRegionId) {
  const credentials = typeof data === 'string' ? JSON.parse(data) : data || {};
  return {
    accessKeyId: firstNotEmpty([
      credentials.AccessKeyId,
      credentials.accessKeyId,
      credentials.accessKey,
    ]),
    accessKeySecret: firstNotEmpty([
      credentials.AccessKeySecret,
      credentials.accessKeySecret,
      credentials.secretKey,
    ]),
    securityToken: firstNotEmpty([
      credentials.SecurityToken,
      credentials.securityToken,
    ]),
    signatureRegionId: firstNotEmpty([
      credentials.signatureRegionId,
      signatureRegionId,
    ]),
    expiration: firstNotEmpty([
      credentials.Expiration,
      credentials.expiration,
    ]),
  };
}

function getExpirationTime(credentials) {
  if (!credentials.expiration) return;
  if (credentials.expiration instanceof Date) {
    return credentials.expiration.getTime();
  }
  const expirationTime = Date.parse(credentials.expiration);
  return isNaN(expirationTime) ? undefined : expirationTime;
}

function getRefreshBeforeExpire(options) {
  return Number(firstNotEmpty([
    options.timeToRefreshInMillisecond,
    options['time.to.refresh.in.millisecond'],
  ])) || DEFAULT_REFRESH_BEFORE_EXPIRE;
}

function isCacheEnabled(options) {
  const value = firstNotEmpty([
    options.cacheSecurityCredentials,
    options['cache.security.credentials'],
  ]);
  return value !== false && value !== 'false';
}

function getCachedCredentials(options, key) {
  const cache = credentialCache.get(options);
  if (!cache || cache.key !== key || !isCacheEnabled(options)) {
    return null;
  }
  if (!cache.expirationTime) {
    return cache.credentials;
  }
  if (cache.expirationTime - Date.now() > getRefreshBeforeExpire(options)) {
    return cache.credentials;
  }
  return null;
}

function setCachedCredentials(options, key, credentials) {
  if (!isCacheEnabled(options)) {
    return;
  }
  credentialCache.set(options, {
    key,
    credentials,
    expirationTime: getExpirationTime(credentials),
  });
}

function hasDynamicCredentials(options) {
  const hasLegacyCredentials = options.ak || options.sk;
  return !!(options.aliyunCredentialsProvider
    || options.alibabaCloudCredentialsProvider
    || options.securityCredentials
    || options['security.credentials']
    || options.securityCredentialsUrl
    || options['security.credentials.url']
    || options.ramRoleName
    || options['ram.role.name']
    || options.alibabaCloudCredentialsUri
    || (!hasLegacyCredentials && process.env.ALIBABA_CLOUD_CREDENTIALS_URI));
}

async function resolveFromProvider(provider, options) {
  if (!provider) {
    return null;
  }
  if (typeof provider === 'function') {
    return normalizeAliyunCredentials(await provider(options));
  }
  if (typeof provider.getCredentials === 'function') {
    return normalizeAliyunCredentials(await provider.getCredentials());
  }
  if (typeof provider.getCredential === 'function') {
    return normalizeAliyunCredentials(await provider.getCredential());
  }
  return normalizeAliyunCredentials(provider);
}

async function fetchCredentials(options, url) {
  const cacheKey = 'url:' + url;
  const cachedCredentials = getCachedCredentials(options, cacheKey);
  if (cachedCredentials) {
    return cachedCredentials;
  }
  const httpclient = options.httpclient || urllib;
  const res = await httpclient.request(url, {
    method: 'GET',
    dataType: 'text',
    timeout: options.requestTimeout,
  });
  const status = res.status || res.statusCode;
  if (status !== 200) {
    throw new Error('Can not get aliyun security credentials, url: ' + url + ', status: ' + status);
  }
  const credentials = normalizeAliyunCredentials(res.data);
  setCachedCredentials(options, cacheKey, credentials);
  return credentials;
}

async function resolveDynamicAliyunCredentials(options) {
  const baseCredentials = exports.resolveAliyunCredentials(options);
  const provider = firstNotEmpty([
    options.aliyunCredentialsProvider,
    options.alibabaCloudCredentialsProvider,
  ]);
  if (provider) {
    const providerCredentials = await resolveFromProvider(provider, options) || {};
    return Object.assign({}, baseCredentials, providerCredentials, {
      signatureRegionId: firstNotEmpty([
        providerCredentials.signatureRegionId,
        baseCredentials.signatureRegionId,
      ]),
    });
  }

  const securityCredentials = firstNotEmpty([
    options.securityCredentials,
    options['security.credentials'],
  ]);
  if (securityCredentials) {
    const credentials = normalizeAliyunCredentials(securityCredentials);
    return Object.assign({}, baseCredentials, credentials, {
      signatureRegionId: firstNotEmpty([
        credentials.signatureRegionId,
        baseCredentials.signatureRegionId,
      ]),
    });
  }

  const credentialsUri = firstNotEmpty([
    options.alibabaCloudCredentialsUri,
    process.env.ALIBABA_CLOUD_CREDENTIALS_URI,
  ]);
  if (credentialsUri) {
    const credentials = await fetchCredentials(options, credentialsUri);
    return Object.assign({}, baseCredentials, credentials, {
      signatureRegionId: firstNotEmpty([
        credentials.signatureRegionId,
        baseCredentials.signatureRegionId,
      ]),
    });
  }

  const ramRoleName = firstNotEmpty([
    options.ramRoleName,
    options['ram.role.name'],
  ]);
  const securityCredentialsUrl = firstNotEmpty([
    options.securityCredentialsUrl,
    options['security.credentials.url'],
    ramRoleName ? RAM_SECURITY_CREDENTIALS_URL + ramRoleName : undefined,
  ]);
  if (securityCredentialsUrl) {
    const credentials = await fetchCredentials(options, securityCredentialsUrl);
    return Object.assign({}, baseCredentials, credentials, {
      signatureRegionId: firstNotEmpty([
        credentials.signatureRegionId,
        baseCredentials.signatureRegionId,
      ]),
    });
  }
  return null;
}

exports.resolveAliyunCredentialsAsync = async options => {
  if (!hasDynamicCredentials(options)) {
    return exports.resolveAliyunCredentials(options);
  }
  const credentials = await resolveDynamicAliyunCredentials(options);
  return credentials || exports.resolveAliyunCredentials(options);
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
