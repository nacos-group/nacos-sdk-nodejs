import { Snapshot } from '../src/snapshot';

const fs = require('mz/fs');
const path = require('path');
const mm = require('mm');
const assert = require('assert');
const { rimraf } = require('mz-modules');

const cacheDir = path.join(__dirname, '.cache');

describe('test/snapshot.test.ts', () => {
  let snapshot;
  before(async () => {
    snapshot = new Snapshot({ cacheDir });
    await snapshot.ready();
  });
  afterEach(mm.restore);
  after(async () => { await rimraf(cacheDir); });

  describe('save()', () => {
    it('should get/save snapshot ok', async () => {
      const key = 'foo';
      let content = await snapshot.get(key);
      assert(!content);
      await snapshot.save(key, 'bar');
      content = await snapshot.get(key);
      assert(content === 'bar');

      await snapshot.save(key, null);
      content = await snapshot.get(key);
      assert(content === '');
    });

    it('should delete snapshot ok', async () => {
      const key = 'foo';
      await snapshot.save(key, 'bar');
      let isExist = await fs.exists(snapshot.getSnapshotFile(key));
      assert(isExist);
      await snapshot.delete(key);
      isExist = await fs.exists(snapshot.getSnapshotFile(key));
      assert(!isExist);
    });

    it('should throw error if  batchSave param not Array', async () => {
      let error;
      try {
        await snapshot.batchSave({ key: 'key', value: 'value' });
      } catch (err) {
        error = err;
      }
      assert(error);
      assert(error.message === '[diamond#Snapshot] batchSave(arr) arr should be an Array.');
    });

    it('should emit error when save error', async () => {
      mm.error(fs, 'writeFile', 'mock error');
      const key = 'key';
      let error;
      try {
        await Promise.all([
          snapshot.await('error'),
          snapshot.save(key, 'content'),
        ]);
      } catch (err) {
        error = err;
      }
      assert(error && error.name === 'SnapshotWriteError');
      assert(error.message === 'mock error');
      const isExist = await fs.exists(snapshot.getSnapshotFile(key));
      assert(!isExist);
    });

    it('should emit error when getSnapshot error', async () => {
      mm.error(fs, 'readFile', 'mock error');
      const key = 'key';
      await snapshot.save(key, 'content');
      let error;
      try {
        await Promise.all([
          snapshot.await('error'),
          snapshot.get(key),
        ]);
      } catch (err) {
        error = err;
      }
      assert(error && error.name === 'SnapshotReadError');
      assert(error.message === 'mock error');
      const isExist = await fs.exists(snapshot.getSnapshotFile(key));
      assert(isExist);
    });

    it('should delete key ok', async () => {
      const key = path.join('group', 'id');
      await snapshot.save(key, 'value');
      const value = await snapshot.get(key);
      assert(value === 'value');
      let isExist = await fs.exists(snapshot.getSnapshotFile(key));
      assert(isExist);
      await snapshot.delete(key);
      isExist = await fs.exists(snapshot.getSnapshotFile(key));
      assert(!isExist);
      await snapshot.delete(key);
    });

    it('should delete with error', async () => {
      mm.error(require('fs'), 'unlink', 'mock error');
      const key = 'foo1';
      await snapshot.save(key, 'value');
      let error;
      try {
        await Promise.all([
          snapshot.await('error'),
          snapshot.delete(key),
        ]);
      } catch (err) {
        error = err;
      }
      assert(error && error.name === 'SnapshotDeleteError');
      assert(error.key === key);
      assert(error.message === 'mock error');
    });

    it('should batchSave ok', async () => {
      await snapshot.batchSave([
        { key: 'key1', value: 'value1' },
        { key: 'key2', value: 'value2' },
      ]);
      let data = await snapshot.get('key1');
      assert(data === 'value1');
      data = await snapshot.get('key2');
      assert(data === 'value2');
    });
  });
});
