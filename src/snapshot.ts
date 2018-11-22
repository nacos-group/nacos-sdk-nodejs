import { ClientOptionKeys, IConfiguration, SnapShotData } from './interface';
import * as path from 'path';
import * as fs from 'fs';
import * as assert from 'assert';

const Base = require('sdk-base');
const is = require('is-type-of');
const { mkdirp, rimraf } = require('mz-modules');
const debug = require('debug')('diamond-client:snapshot');

export class Snapshot extends Base {

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
      const exists = fs.existsSync(filepath);
      if (exists) {
        return fs.readFileSync(filepath, 'utf8');
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
      fs.writeFileSync(filepath, value);
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
