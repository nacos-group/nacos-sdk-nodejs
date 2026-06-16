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
import * as crypto from 'crypto';
import * as urllib from 'urllib';
import { ClientOptionKeys, IConfiguration } from './interface';

const RAM_SECURITY_CREDENTIALS_URL = 'http://100.100.100.200/latest/meta-data/ram/security-credentials/';
const V4_PREFIX = 'aliyun_v4';
const V4_REQUEST = 'aliyun_v4_request';
const V4_PRODUCT = 'mse-nacos';
const V4_SIGNATURE_VERSION = 'v4';
const DEFAULT_REFRESH_BEFORE_EXPIRE = 3 * 60 * 1000;

export interface AliyunCredentials {
  accessKeyId?: string;
  accessKeySecret?: string;
  securityToken?: string;
  signatureRegionId?: string;
  expiration?: string | Date;
}

interface CredentialCache {
  key: string;
  credentials: AliyunCredentials;
  expirationTime?: number;
}

const credentialCache = new WeakMap<IConfiguration, CredentialCache>();

function firstNotEmpty(values: any[]): any {
  for (const value of values) {
    if (value !== undefined && value !== null && value !== '') {
      return value;
    }
  }
  return undefined;
}

function getRawProperty(configuration: IConfiguration, key: string): any {
  const properties = configuration.get();
  return properties ? properties[ key ] : undefined;
}

export function resolveAliyunCredentials(configuration: IConfiguration): AliyunCredentials {
  const legacyAccessKeyId = configuration.get(ClientOptionKeys.ACCESSKEY);
  const legacyAccessKeySecret = configuration.get(ClientOptionKeys.SECRETKEY);
  const hasLegacyCredentials = legacyAccessKeyId || legacyAccessKeySecret;
  const signatureRegionId = configuration.get(ClientOptionKeys.SIGNATURE_REGION_ID);
  return {
    accessKeyId: firstNotEmpty([
      legacyAccessKeyId,
      configuration.get(ClientOptionKeys.ALIBABA_CLOUD_ACCESS_KEY_ID),
      process.env.ALIBABA_CLOUD_ACCESS_KEY_ID,
    ]),
    accessKeySecret: firstNotEmpty([
      legacyAccessKeySecret,
      configuration.get(ClientOptionKeys.ALIBABA_CLOUD_ACCESS_KEY_SECRET),
      process.env.ALIBABA_CLOUD_ACCESS_KEY_SECRET,
    ]),
    securityToken: firstNotEmpty([
      configuration.get(ClientOptionKeys.SECURITY_TOKEN),
      configuration.get(ClientOptionKeys.ALIBABA_CLOUD_SECURITY_TOKEN),
      hasLegacyCredentials ? undefined : process.env.ALIBABA_CLOUD_SECURITY_TOKEN,
    ]),
    signatureRegionId: firstNotEmpty([
      signatureRegionId,
      hasLegacyCredentials ? undefined : process.env.ALIBABA_CLOUD_SIGNATURE_REGION_ID,
    ]),
  };
}

function normalizeAliyunCredentials(data: any, signatureRegionId?: string): AliyunCredentials {
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

function getExpirationTime(credentials: AliyunCredentials): number {
  if (!credentials.expiration) {
    return undefined;
  }
  if (credentials.expiration instanceof Date) {
    return credentials.expiration.getTime();
  }
  const expirationTime = Date.parse(credentials.expiration);
  return isNaN(expirationTime) ? undefined : expirationTime;
}

function getRefreshBeforeExpire(configuration: IConfiguration): number {
  return Number(firstNotEmpty([
    configuration.get(ClientOptionKeys.TIME_TO_REFRESH_IN_MILLISECOND),
    getRawProperty(configuration, 'time.to.refresh.in.millisecond'),
  ]))
    || DEFAULT_REFRESH_BEFORE_EXPIRE;
}

function isCacheEnabled(configuration: IConfiguration): boolean {
  const value = firstNotEmpty([
    configuration.get(ClientOptionKeys.CACHE_SECURITY_CREDENTIALS),
    getRawProperty(configuration, 'cache.security.credentials'),
  ]);
  return value !== false && value !== 'false';
}

function getCachedCredentials(configuration: IConfiguration, key: string): AliyunCredentials {
  const cache = credentialCache.get(configuration);
  if (!cache || cache.key !== key || !isCacheEnabled(configuration)) {
    return null;
  }
  if (!cache.expirationTime) {
    return cache.credentials;
  }
  if (cache.expirationTime - Date.now() > getRefreshBeforeExpire(configuration)) {
    return cache.credentials;
  }
  return null;
}

function setCachedCredentials(configuration: IConfiguration, key: string, credentials: AliyunCredentials): void {
  if (!isCacheEnabled(configuration)) {
    return;
  }
  credentialCache.set(configuration, {
    key,
    credentials,
    expirationTime: getExpirationTime(credentials),
  });
}

function hasDynamicCredentials(configuration: IConfiguration): boolean {
  const hasLegacyCredentials = configuration.get(ClientOptionKeys.ACCESSKEY)
    || configuration.get(ClientOptionKeys.SECRETKEY);
  return !!(configuration.get(ClientOptionKeys.ALIYUN_CREDENTIALS_PROVIDER)
    || configuration.get(ClientOptionKeys.ALIBABA_CLOUD_CREDENTIALS_PROVIDER)
    || configuration.get(ClientOptionKeys.SECURITY_CREDENTIALS)
    || getRawProperty(configuration, 'security.credentials')
    || configuration.get(ClientOptionKeys.SECURITY_CREDENTIALS_URL)
    || getRawProperty(configuration, 'security.credentials.url')
    || configuration.get(ClientOptionKeys.RAM_ROLE_NAME)
    || getRawProperty(configuration, 'ram.role.name')
    || configuration.get(ClientOptionKeys.ALIBABA_CLOUD_CREDENTIALS_URI)
    || (!hasLegacyCredentials && process.env.ALIBABA_CLOUD_CREDENTIALS_URI));
}

async function resolveFromProvider(provider: any, configuration: IConfiguration): Promise<AliyunCredentials> {
  if (!provider) {
    return null;
  }
  if (typeof provider === 'function') {
    return normalizeAliyunCredentials(await provider(configuration.get()));
  }
  if (typeof provider.getCredentials === 'function') {
    return normalizeAliyunCredentials(await provider.getCredentials());
  }
  if (typeof provider.getCredential === 'function') {
    return normalizeAliyunCredentials(await provider.getCredential());
  }
  return normalizeAliyunCredentials(provider);
}

async function fetchCredentials(configuration: IConfiguration, url: string): Promise<AliyunCredentials> {
  const cacheKey = 'url:' + url;
  const cachedCredentials = getCachedCredentials(configuration, cacheKey);
  if (cachedCredentials) {
    return cachedCredentials;
  }
  const httpclient = configuration.get(ClientOptionKeys.HTTPCLIENT) || urllib;
  const res = await httpclient.request(url, {
    method: 'GET',
    dataType: 'text',
    timeout: configuration.get(ClientOptionKeys.REQUEST_TIMEOUT),
  });
  const status = res.status || res.statusCode;
  if (status !== 200) {
    throw new Error('Can not get aliyun security credentials, url: ' + url + ', status: ' + status);
  }
  const credentials = normalizeAliyunCredentials(res.data);
  setCachedCredentials(configuration, cacheKey, credentials);
  return credentials;
}

async function resolveDynamicAliyunCredentials(configuration: IConfiguration): Promise<AliyunCredentials> {
  const baseCredentials = resolveAliyunCredentials(configuration);
  const provider = firstNotEmpty([
    configuration.get(ClientOptionKeys.ALIYUN_CREDENTIALS_PROVIDER),
    configuration.get(ClientOptionKeys.ALIBABA_CLOUD_CREDENTIALS_PROVIDER),
  ]);
  if (provider) {
    const providerCredentials = await resolveFromProvider(provider, configuration) || {};
    return Object.assign({}, baseCredentials, providerCredentials, {
      signatureRegionId: firstNotEmpty([
        providerCredentials.signatureRegionId,
        baseCredentials.signatureRegionId,
      ]),
    });
  }

  const securityCredentials = firstNotEmpty([
    configuration.get(ClientOptionKeys.SECURITY_CREDENTIALS),
    getRawProperty(configuration, 'security.credentials'),
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
    configuration.get(ClientOptionKeys.ALIBABA_CLOUD_CREDENTIALS_URI),
    process.env.ALIBABA_CLOUD_CREDENTIALS_URI,
  ]);
  if (credentialsUri) {
    const credentials = await fetchCredentials(configuration, credentialsUri);
    return Object.assign({}, baseCredentials, credentials, {
      signatureRegionId: firstNotEmpty([
        credentials.signatureRegionId,
        baseCredentials.signatureRegionId,
      ]),
    });
  }

  const ramRoleName = firstNotEmpty([
    configuration.get(ClientOptionKeys.RAM_ROLE_NAME),
    getRawProperty(configuration, 'ram.role.name'),
  ]);
  const securityCredentialsUrl = firstNotEmpty([
    configuration.get(ClientOptionKeys.SECURITY_CREDENTIALS_URL),
    getRawProperty(configuration, 'security.credentials.url'),
    ramRoleName ? RAM_SECURITY_CREDENTIALS_URL + ramRoleName : undefined,
  ]);
  if (securityCredentialsUrl) {
    const credentials = await fetchCredentials(configuration, securityCredentialsUrl);
    return Object.assign({}, baseCredentials, credentials, {
      signatureRegionId: firstNotEmpty([
        credentials.signatureRegionId,
        baseCredentials.signatureRegionId,
      ]),
    });
  }
  return null;
}

export async function resolveAliyunCredentialsAsync(configuration: IConfiguration): Promise<AliyunCredentials> {
  if (!hasDynamicCredentials(configuration)) {
    return resolveAliyunCredentials(configuration);
  }
  const credentials = await resolveDynamicAliyunCredentials(configuration);
  return credentials || resolveAliyunCredentials(configuration);
}

export function hmacSha1(data: string, key: string): string {
  return crypto.createHmac('sha1', key)
    .update(data).digest()
    .toString('base64');
}

function hmacSha256(data: string, key: string | Buffer): Buffer {
  return crypto.createHmac('sha256', key)
    .update(data).digest();
}

function getUtcSignDate(): string {
  const date = new Date();
  const year = date.getUTCFullYear();
  const month = ('0' + (date.getUTCMonth() + 1)).slice(-2);
  const day = ('0' + date.getUTCDate()).slice(-2);
  return `${year}${month}${day}`;
}

export function calculateV4SigningKey(secret: string, regionId: string, signDate = getUtcSignDate()): string {
  const firstKey = hmacSha256(signDate, V4_PREFIX + secret);
  const regionKey = hmacSha256(regionId, firstKey);
  const productKey = hmacSha256(V4_PRODUCT, regionKey);
  return hmacSha256(V4_REQUEST, productKey).toString('base64');
}

export function getActualAccessKeySecret(credentials: AliyunCredentials): string {
  const accessKeySecret = credentials.accessKeySecret || '';
  if (!credentials.signatureRegionId) {
    return accessKeySecret;
  }
  return calculateV4SigningKey(accessKeySecret, credentials.signatureRegionId);
}

export function getConfigSignResource(data: any): string {
  let signStr = data.tenant;
  if (data.group && data.tenant) {
    signStr = data.tenant + '+' + data.group;
  } else if (data.group) {
    signStr = data.group;
  }
  return signStr;
}

export function buildConfigAuthHeaders(data: any, credentials: AliyunCredentials, timestamp: string) {
  const signStr = getConfigSignResource(data);
  const signature = hmacSha1(signStr + '+' + timestamp, getActualAccessKeySecret(credentials));
  const headers: any = {
    'Spas-AccessKey': credentials.accessKeyId,
    timeStamp: timestamp,
    'Spas-Signature': signature,
  };
  if (credentials.securityToken) {
    headers[ 'Spas-SecurityToken' ] = credentials.securityToken;
  }
  if (credentials.signatureRegionId) {
    headers.signatureVersion = V4_SIGNATURE_VERSION;
  }
  return headers;
}
