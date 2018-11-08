import { SnapShotData } from './interface';

const Base = require('sdk-base');
const fs = require('mz/fs');
const path = require('path');
const osenv = require('osenv');
const assert = require('assert');
const is = require('is-type-of');
const {mkdirp, rimraf} = require('mz-modules');
const debug = require('debug')('diamond-client:snapshot');

const DEFAULT_OPITONS = {
  cacheDir: path.join(osenv.home(), '.node-diamond-client-cache'),
};

export class Snapshot extends Base {

  private cacheDir;
  private uuid = Math.random();

  constructor(options) {
    super(Object.assign({}, DEFAULT_OPITONS, options));
    this.cacheDir = this.options.cacheDir;
    this.ready(true);
    debug(this.uuid);
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
    await Promise.all(arr.map(({key, value}) => this.save(key, value)));
  }

  private getSnapshotFile(key) {
    return path.join(this.cacheDir, 'snapshot', key);
  }
}
