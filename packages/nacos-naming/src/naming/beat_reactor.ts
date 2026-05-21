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
const Base = require('sdk-base');
const assert = require('assert');
const sleep = require('mz-modules/sleep');
/* tslint:enable:no-var-requires */

import { BeatInfo } from '../interface';
import { NAMING_INSTANCE_ID_SPLITTER } from '../const';

export class BeatReactor extends Base {
  private _isClosed: boolean;
  private _dom2Beat: Map<string, BeatInfo>;
  private _isRunning: boolean;
  private _clientBeatInterval: number;

  constructor(options: any = {}) {
    assert(options.serverProxy, '[BeatReactor] options.serverProxy is required');
    super(options);

    this._isClosed = false;
    this._dom2Beat = new Map();
    this._isRunning = false;
    this._clientBeatInterval = 10 * 1000;
    this._startBeat();
    this.ready(true);
  }

  get serverProxy(): any {
    return this.options.serverProxy;
  }

  addBeatInfo(serviceName: string, beatInfo: BeatInfo): void {
    this._dom2Beat.set(this._buildKey(serviceName, beatInfo.ip, beatInfo.port), beatInfo);
  }

  removeBeatInfo(serviceName: string, ip: string, port: number): void {
    this._dom2Beat.delete(this._buildKey(serviceName, ip, port));
  }

  _buildKey(dom: string, ip: string, port: number): string {
    return dom + NAMING_INSTANCE_ID_SPLITTER + ip + NAMING_INSTANCE_ID_SPLITTER + port;
  }

  async _beat(beatInfo: BeatInfo): Promise<void> {
    if (beatInfo.scheduled) return;

    beatInfo.scheduled = true;
    this._clientBeatInterval = await this.serverProxy.sendBeat(beatInfo);
    beatInfo.scheduled = false;
  }

  async _startBeat(): Promise<void> {
    if (this._isRunning) return;

    this._isRunning = true;
    while (!this._isClosed) {
      await Promise.all(Array.from(this._dom2Beat.values())
        .map((beatInfo: BeatInfo) => this._beat(beatInfo)));
      await sleep(this._clientBeatInterval);
    }
    this._isRunning = false;
  }

  async _close(): Promise<void> {
    this._isClosed = true;
    this._isRunning = false;
    this._dom2Beat.clear();
  }
}
