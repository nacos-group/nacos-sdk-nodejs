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
const crypto = require('crypto');
const is = require('is-type-of');
const assert = require('assert');
const qs = require('querystring');
const iconv = require('iconv-lite');
const urlencode = require('urlencode');

const sep = '&';
const eq = '=';
const REG_VALID_CHAR = /^[a-z0-9A-Z_\.\-\:]+$/;

/**
 * 获取字符串的 md5 值
 * @param {String} val - 字符串
 * @return {String} md5
 */
export function getMD5String(val, encodingFormat = 'utf8') {
  if (is.nullOrUndefined(val)) {
    return '';
  }
  const md5 = crypto.createHash('md5');
  // 注意：这里的编码
  md5.update(iconv.encode(val, encodingFormat));
  return md5.digest('hex');
}

export function encodingParams(data, encodingFormat = 'utf8') {
  return qs.stringify(data, sep, eq, {
    encodeURIComponent(str) {
      // nacos 默认 utf8，其他是 gbk
      return urlencode.encode(str, encodingFormat);
    },
  });
}

/**
 * 是否是合法字符
 * @param {String} val - 字符串
 * @return {Boolean} valid or not?
 */
export function isValid(val) {
  return val && REG_VALID_CHAR.test(val);
}

// Helper
// --------------------
export function checkParameters(dataIds, group, datumId?) {
  if (Array.isArray(dataIds)) {
    const invalidDataIds = dataIds.filter(function(dataId) {
      return !exports.isValid(dataId);
    });
    assert(invalidDataIds.length === 0, `[dataId] only allow digital, letter and symbols in [ "_", "-", ".", ":" ], but got ${invalidDataIds}`);
  } else {
    assert(dataIds && exports.isValid(dataIds), `[dataId] only allow digital, letter and symbols in [ "_", "-", ".", ":" ], but got ${dataIds}`);
  }
  assert(group && exports.isValid(group), `[group] only allow digital, letter and symbols in [ "_", "-", ".", ":" ], but got ${group}`);
  if (datumId) {
    assert(exports.isValid(datumId), `[datumId] only allow digital, letter and symbols in [ "_", "-", ".", ":" ], but got ${datumId}`);
  }
}


export function transformGBKToUTF8(text) {
  return iconv.decode(iconv.encode(text, 'gbk'), 'utf8');
}
