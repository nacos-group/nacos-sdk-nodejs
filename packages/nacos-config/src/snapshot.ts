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
  // 快照写序号：与 pid/随机数共同构成唯一临时文件名，避免同进程并发写撞文件
  private writeSeq = 0;

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
    // Preserve the historical Snapshot API: an explicit empty value is still
    // readable as an empty snapshot. Higher-level config reads remove stale
    // snapshots when the server confirms an absent/empty configuration.
    value = value || '';
    const dir = path.dirname(filepath);
    // 每次写用唯一临时文件名（pid + 递增序号 + 随机），避免同进程并发写同一 key 时复用同一
    // 临时文件：先完成 rename 的一方会让另一方 rename 到已不存在的文件而报 ENOENT
    const tmpPath = `${filepath}.${process.pid}.${++this.writeSeq}.${Math.random().toString(36).slice(2, 8)}.tmp`;
    try {
      await mkdirp(dir);
      // 先写临时文件再 rename，避免多进程读到写一半的内容
      await fs.writeFile(tmpPath, value);
      await fs.rename(tmpPath, filepath);
    } catch (err) {
      // rename 未完成时清理残留临时文件，避免磁盘泄漏
      try {
        await fs.unlink(tmpPath);
      } catch (_) {
        // 临时文件可能已被 rename 移走或从未创建，忽略清理失败
      }
      err.name = 'SnapshotWriteError';
      err.key = key;
      err.value = value;
      this.emit('error', err);
    }
  }

  async getFailover(key): Promise<string | null> {
    const filepath = this.getFailoverFile(key);
    try {
      // 仅读取普通文件（对齐 Java SDK: !localPath.isFile() 时返回 null）
      const stat = await fs.stat(filepath);
      if (stat.isFile()) {
        return await fs.readFile(filepath, 'utf8');
      }
    } catch (err) {
      if (err.code !== 'ENOENT') {
        err.name = 'FailoverReadError';
        this.emit('error', err);
      }
    }
    return null;
  }

  async getFailoverMtime(key): Promise<number | null> {
    const filepath = this.getFailoverFile(key);
    try {
      const stat = await fs.stat(filepath);
      if (stat.isFile()) {
        return stat.mtimeMs;
      }
    } catch (err) {
      // 文件不存在属于正常情况，不上报错误
    }
    return null;
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

  private getFailoverFile(key) {
    return path.join(this.cacheDir, 'failover', key);
  }
}
