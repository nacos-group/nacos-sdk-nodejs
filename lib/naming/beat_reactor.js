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

const Base = require('sdk-base');
const assert = require('assert');
const Constants = require('../const');
const sleep = require('mz-modules/sleep');

class BeatReactor extends Base {
  constructor(options = {}) {
    assert(options.logger, '[BeatReactor] options.logger is required');
    assert(options.serverProxy, '[BeatReactor] options.serverProxy is required');
    super(options);

    this._isClosed = false;
    this._dom2Beat = new Map();
    this._isRunning = false;
    this._clientBeatInterval = 10 * 1000;
    this._startBeat();
    this.ready(true);
  }

  get logger() {
    return this.options.logger;
  }

  get serverProxy() {
    return this.options.serverProxy;
  }

  addBeatInfo(serviceName, beatInfo) {
    this._dom2Beat.set(this._buildKey(serviceName, beatInfo.ip, beatInfo.port), beatInfo);
  }

  removeBeatInfo(serviceName, ip, port) {
    this._dom2Beat.delete(this._buildKey(serviceName, ip, port));
  }

  _buildKey(dom, ip, port) {
    return dom + Constants.NAMING_INSTANCE_ID_SPLITTER + ip + Constants.NAMING_INSTANCE_ID_SPLITTER + port;
  }

  async _beat(beatInfo) {
    const params = {
      beat: JSON.stringify(beatInfo),
      dom: beatInfo.dom,
    };
    try {
      const result = await this.serverProxy.reqAPI(Constants.NACOS_URL_BASE + '/api/clientBeat', params);
      const jsonObject = JSON.parse(result);
      if (jsonObject) {
        this._clientBeatInterval = jsonObject.clientBeatInterval;
      }
    } catch (err) {
      err.message = '[CLIENT-BEAT] failed to send beat: ' + JSON.stringify(beatInfo) + ', caused by ' + err.message;
      this.emit('error', err);
    }
  }

  async _startBeat() {
    if (this._isRunning) return;

    this._isRunning = true;
    while (!this._isClosed) {
      for (const beatInfo of this._dom2Beat.values()) {
        this._beat(beatInfo);
      }
      await sleep(this._clientBeatInterval);
    }
    this._isRunning = false;
  }

  close() {
    this._isClosed = true;
    this._isRunning = false;
    this._dom2Beat.clear();
  }
}

module.exports = BeatReactor;
