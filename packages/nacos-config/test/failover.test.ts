import * as assert from 'assert';
import * as path from 'path';
import { mkdirp, rimraf } from 'mz-modules';
import * as fs from 'mz/fs';
import { Configuration } from '../src/configuration';
import { ClientOptionKeys } from '../src/interface';
import { Snapshot } from '../src/snapshot';
import { ClientWorker } from '../src/client_worker';

describe('local failover and snapshot lifecycle', function() {
  const cacheDir = path.join(__dirname, '.cache-failover');
  let snapshot: Snapshot;
  let requests: number;

  beforeEach(async function() {
    await rimraf(cacheDir);
    const configuration = new Configuration({
      cacheDir,
      unit: 'CURRENT_UNIT',
      namespace: 'public',
      defaultEncoding: 'utf8',
    });
    snapshot = new Snapshot({ configuration });
    requests = 0;
  });

  afterEach(async function() {
    await rimraf(cacheDir);
  });

  it('prioritizes failover, then snapshots, and clears empty server results', async function() {
    const key = path.join('config', 'CURRENT_UNIT', 'public', 'G', 'app');
    const failoverPath = path.join(cacheDir, 'failover', key);
    await mkdirp(path.dirname(failoverPath));
    await fs.writeFile(failoverPath, 'local=value');

    const configuration = new Configuration({
      cacheDir,
      unit: 'CURRENT_UNIT',
      namespace: 'public',
      defaultEncoding: 'utf8',
      snapshot,
      cipher: null,
      httpAgent: {
        request: async () => {
          requests++;
          return 'server=value';
        },
      },
    });
    const worker = new ClientWorker({ configuration });
    worker.on('error', () => {});

    assert.strictEqual(await worker.getConfig('app', 'G'), 'local=value');
    assert.strictEqual(requests, 0);

    await rimraf(failoverPath);
    assert.strictEqual(await worker.getConfig('app', 'G'), 'server=value');
    assert.strictEqual(requests, 1);
    assert.strictEqual(await snapshot.get(key), 'server=value');

    configuration.set(ClientOptionKeys.HTTP_AGENT, {
      request: async () => null,
    });
    assert.strictEqual(await worker.getConfig('app', 'G'), null);
    assert.strictEqual(await snapshot.get(key), null);
  });

  it('returns the failover file mtime for hot-switch detection', async function() {
    const key = path.join('config', 'CURRENT_UNIT', 'public', 'G', 'app');
    assert.strictEqual(await snapshot.getFailover(key), null);
    assert.strictEqual(await snapshot.getFailoverMtime(key), null);
    const filepath = path.join(cacheDir, 'failover', key);
    await mkdirp(path.dirname(filepath));
    await fs.writeFile(filepath, 'v1');
    const mtime = await snapshot.getFailoverMtime(key);
    assert(mtime !== null);
    assert.strictEqual(await snapshot.getFailover(key), 'v1');
  });
});
