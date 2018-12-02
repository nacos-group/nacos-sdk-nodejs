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
import { ClientOptionKeys, IConfiguration, ISnapshot, SnapShotData } from './interface';
import * as path from 'path';
import * as assert from 'assert';

const Base = require('sdk-base');
const is = require('is-type-of');
const { mkdirp, rimraf } = require('mz-modules');
const debug = require('debug')('diamond-client:snapshot');
const fs = require('mz/fs');

export class Snapshot extends Base implements ISnapshot {

  private uuid = Math.random();

  constructor(options) {
    super(options);
    this.ready(true);
    debug(this.uuid);
  }

  get cacheDir() {
    return this.configuration.get(ClientOptionKeys.CACHE_DIR);
  }

  get configuration(): IConfiguration {
    return this.options.configuration;
  }

  async get(key) {
    const filepath = this.getSnapshotFile(key);
    try {
      const exists = await fs.exists(filepath);
      if (exists) {
        return await fs.readFile(filepath, 'utf8');
      }
    } catch (err) {
      err.name = 'SnapshotReadError';
      this.emit('error', err);
    }
    return null;
  }

  async save(key, value) {
    const filepath = this.getSnapshotFile(key);
    const dir = path.dirname(filepath);
    value = value || '';
    try {
      await mkdirp(dir);
      await fs.writeFile(filepath, value);
    } catch (err) {
      err.name = 'SnapshotWriteError';
      err.key = key;
      err.value = value;
      this.emit('error', err);
    }
  }

  async delete(key) {
    const filepath = this.getSnapshotFile(key);
    try {
      await rimraf(filepath);
    } catch (err) {
      err.name = 'SnapshotDeleteError';
      err.key = key;
      this.emit('error', err);
    }
  }

  async batchSave(arr: Array<SnapShotData>) {
    assert(is.array(arr), '[diamond#Snapshot] batchSave(arr) arr should be an Array.');
    await Promise.all(arr.map(({ key, value }) => this.save(key, value)));
  }

  private getSnapshotFile(key) {
    return path.join(this.cacheDir, 'snapshot', key);
  }
}
