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
import * as urllib from 'urllib';
import * as path from 'path';
import * as osenv from 'osenv';

export const DEFAULT_GROUP = 'DEFAULT_GROUP';

export const LINE_SEPARATOR = String.fromCharCode(1);
export const WORD_SEPARATOR = String.fromCharCode(2);

export const VERSION = 'nodejs-diamond-client/' + require('../package.json').version;
export const CURRENT_UNIT = 'CURRENT_UNIT';

export const HTTP_OK = 200;
export const HTTP_NOT_FOUND = 404;
export const HTTP_CONFLICT = 409;
export const HTTP_UNAVAILABLE = 503; // 被限流

export const DEFAULT_OPTIONS = {
  serverPort: 8848,
  requestTimeout: 5000,
  refreshInterval: 30000,
  cacheDir: path.join(osenv.home(), '.node-diamond-client-cache'),
  httpclient: urllib,
  contextPath: 'nacos',
  clusterName: 'serverlist',
  unit: CURRENT_UNIT,
  ssl: false,
  secretKey: '',
  defaultEncoding: 'utf8',
};
