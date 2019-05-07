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
const crypto = require('crypto');
const Constants = require('../const');

const GZIP_MAGIC = 35615;

/* eslint-disable no-bitwise */
exports.isGzipStream = buf => {
  if (!buf || buf.length < 2) {
    return false;
  }
  return GZIP_MAGIC === ((buf[1] << 8 | buf[0]) & 0xFFFF);
};
/* eslint-enable no-bitwise */

exports.tryDecompress = buf => {
  if (!this.isGzipStream(buf)) {
    return buf;
  }
  return zlib.gunzipSync(buf);
};

exports.sign = (data, key) => {
  return crypto.createHmac('sha1', key).update(data).digest('base64');
};

exports.getGroupedName = (serviceName, groupName) => {
  return groupName + Constants.SERVICE_INFO_SPLITER + serviceName;
};

exports.getServiceName = serviceNameWithGroup => {
  if (!serviceNameWithGroup.includes(Constants.SERVICE_INFO_SPLITER)) {
    return serviceNameWithGroup;
  }
  return serviceNameWithGroup.split(Constants.SERVICE_INFO_SPLITER)[1];
};

exports.getGroupName = serviceNameWithGroup => {
  if (!serviceNameWithGroup.includes(Constants.SERVICE_INFO_SPLITER)) {
    return Constants.DEFAULT_GROUP;
  }
  return serviceNameWithGroup.split(Constants.SERVICE_INFO_SPLITER)[0];
};
