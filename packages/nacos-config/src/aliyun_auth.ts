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
import { ClientOptionKeys, IConfiguration } from './interface';

export interface AliyunCredentials {
  accessKeyId?: string;
  accessKeySecret?: string;
  securityToken?: string;
  signatureRegionId?: string;
}

function firstNotEmpty(values: any[]): string {
  for (const value of values) {
    if (value !== undefined && value !== null && value !== '') {
      return value;
    }
  }
  return undefined;
}

export function resolveAliyunCredentials(configuration: IConfiguration): AliyunCredentials {
  const legacyAccessKeyId = configuration.get(ClientOptionKeys.ACCESSKEY);
  const legacyAccessKeySecret = configuration.get(ClientOptionKeys.SECRETKEY);
  const hasLegacyCredentials = legacyAccessKeyId || legacyAccessKeySecret;
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
  };
}

export function hmacSha1(data: string, key: string): string {
  return crypto.createHmac('sha1', key)
    .update(data).digest()
    .toString('base64');
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
  const signature = hmacSha1(signStr + '+' + timestamp, credentials.accessKeySecret || '');
  const headers: any = {
    'Spas-AccessKey': credentials.accessKeyId,
    timeStamp: timestamp,
    'Spas-Signature': signature,
  };
  if (credentials.securityToken) {
    headers[ 'Spas-SecurityToken' ] = credentials.securityToken;
  }
  return headers;
}
