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

/* tslint:disable:no-var-requires */
declare function require(module: string): any;
const zlib = require('zlib');
const crypto = require('crypto');
/* tslint:enable:no-var-requires */
import { SERVICE_INFO_SPLITER, DEFAULT_GROUP } from './const';

const GZIP_MAGIC = 35615;

/* eslint-disable no-bitwise */
export function isGzipStream(buf: any): boolean {
  if (!buf || buf.length < 2) {
    return false;
  }
  return GZIP_MAGIC === ((buf[1] << 8 | buf[0]) & 0xFFFF);
}
/* eslint-enable no-bitwise */

export function tryDecompress(buf: any): any {
  if (!isGzipStream(buf)) {
    return buf;
  }
  return zlib.gunzipSync(buf);
}

export function sign(data: string, key: string): string {
  return crypto.createHmac('sha1', key).update(data).digest('base64');
}

export function getGroupedName(serviceName: string, groupName: string): string {
  return groupName + SERVICE_INFO_SPLITER + serviceName;
}

export function getServiceName(serviceNameWithGroup: string): string {
  if (!serviceNameWithGroup.includes(SERVICE_INFO_SPLITER)) {
    return serviceNameWithGroup;
  }
  return serviceNameWithGroup.split(SERVICE_INFO_SPLITER)[1];
}

export function getGroupName(serviceNameWithGroup: string): string {
  if (!serviceNameWithGroup.includes(SERVICE_INFO_SPLITER)) {
    return DEFAULT_GROUP;
  }
  return serviceNameWithGroup.split(SERVICE_INFO_SPLITER)[0];
}
