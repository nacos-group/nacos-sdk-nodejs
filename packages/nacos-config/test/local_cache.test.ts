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

import { ClientWorker, ServerListManager, Snapshot } from '../src';
import { HttpAgent } from '../src/http_agent';
import { createDefaultConfiguration } from './utils';
import * as path from 'path';
import * as mm from 'mm';
import * as assert from 'assert';

const fs = require('mz/fs');
const rawFs = require('fs');
const { mkdirp, rimraf } = require('mz-modules');

const cacheDir = path.join(__dirname, '.cache_local');

function createClient(): ClientWorker {
  const configuration = createDefaultConfiguration({
    serverAddr: '127.0.0.1:8848',
    namespace: '',
    cacheDir,
  });
  const snapshot = new Snapshot({ configuration });
  const serverMgr = new ServerListManager({ configuration });
  const httpAgent = new HttpAgent({ configuration });
  configuration.merge({ snapshot, serverMgr, httpAgent });
  return new ClientWorker({ configuration });
}

describe('test/local_cache.test.ts', () => {

  afterEach(async () => {
    mm.restore();
    await rimraf(cacheDir);
  });

  describe('getConfig with failover', () => {

    it('should return failover content without calling server', async () => {
      const client = createClient();
      const snapshotKey = (client as any).getSnapshotKeyEncoded('fo-data-id', 'fo-group');
      const failoverFile = (client.snapshot as any).getFailoverFile(snapshotKey);
      await mkdirp(path.dirname(failoverFile));
      await fs.writeFile(failoverFile, 'emergency-config');

      let serverCalled = false;
      mm(client.httpAgent, 'request', async () => {
        serverCalled = true;
        return 'server-config';
      });
      const content = await client.getConfig('fo-data-id', 'fo-group');
      assert(content === 'emergency-config');
      assert(serverCalled === false);
    });

    it('should fall back to server when failover file absent', async () => {
      const client = createClient();
      mm(client.httpAgent, 'request', async () => 'server-config');
      const content = await client.getConfig('no-fo-data-id', 'fo-group');
      assert(content === 'server-config');
    });

    it('should ignore non-file failover path (directory)', async () => {
      const client = createClient();
      const snapshotKey = (client as any).getSnapshotKeyEncoded('dir-data-id', 'fo-group');
      const failoverFile = (client.snapshot as any).getFailoverFile(snapshotKey);
      await mkdirp(failoverFile);

      const calls = { server: false };
      mm(client.httpAgent, 'request', async () => {
        calls.server = true;
        return 'server-config';
      });
      const content = await client.getConfig('dir-data-id', 'fo-group');
      assert(content === 'server-config');
      assert(calls.server === true);
    });
  });

  describe('snapshot lifecycle', () => {

    it('should delete snapshot when server responds 404', async () => {
      const client = createClient();
      const snapshotKey = (client as any).getSnapshotKeyEncoded('gone-data-id', 'fo-group');
      // 预置一份过期快照
      await client.snapshot.save(snapshotKey, 'stale-content');
      assert(await client.snapshot.get(snapshotKey) === 'stale-content');

      mm(client.httpAgent, 'request', async () => null);
      const content = await client.getConfig('gone-data-id', 'fo-group');
      assert(content === null);
      assert(await client.snapshot.get(snapshotKey) === null);
    });

    it('should delete snapshot on remove()', async () => {
      const client = createClient();
      const snapshotKey = (client as any).getSnapshotKeyEncoded('rm-data-id', 'fo-group');
      await client.snapshot.save(snapshotKey, 'to-be-removed');

      mm(client.httpAgent, 'request', async () => 'true');
      await client.remove('rm-data-id', 'fo-group');
      assert(await client.snapshot.get(snapshotKey) === null);
    });
  });

  describe('checkLocalFailover (subscription hot switch)', () => {

    function seedSubscription(client: ClientWorker, dataId: string, group: string) {
      const key = (client as any).formatKey({ dataId, group });
      (client as any).subscriptions.set(key, { dataId, group, md5: null, content: null });
      return key;
    }

    function nextEmit(client: ClientWorker, key: string): Promise<string> {
      return new Promise(resolve => client.once(key, resolve));
    }

    it('should switch to failover content when file is created', async () => {
      const client = createClient();
      const key = seedSubscription(client, 'hot-data-id', 'fo-group');
      const snapshotKey = (client as any).getSnapshotKeyEncoded('hot-data-id', 'fo-group');
      const failoverFile = (client.snapshot as any).getFailoverFile(snapshotKey);

      await (client as any).checkLocalFailover();
      const item = (client as any).subscriptions.get(key);
      assert(item.useFailover !== true);

      await mkdirp(path.dirname(failoverFile));
      await fs.writeFile(failoverFile, 'failover-v1');
      const emitted = nextEmit(client, key);
      await (client as any).checkLocalFailover();
      assert(await emitted === 'failover-v1');
      assert(item.useFailover === true);
      assert(item.content === 'failover-v1');
    });

    it('should reload failover content when file changes', async () => {
      const client = createClient();
      const key = seedSubscription(client, 'hot-data-id2', 'fo-group');
      const snapshotKey = (client as any).getSnapshotKeyEncoded('hot-data-id2', 'fo-group');
      const failoverFile = (client.snapshot as any).getFailoverFile(snapshotKey);
      await mkdirp(path.dirname(failoverFile));
      await fs.writeFile(failoverFile, 'failover-v1');
      await (client as any).checkLocalFailover();

      await fs.writeFile(failoverFile, 'failover-v2');
      // 强制 mtime 前进，避免毫秒级写入落在同一时刻
      const future = new Date(Date.now() + 5000);
      rawFs.utimesSync(failoverFile, future, future);

      const emitted = nextEmit(client, key);
      await (client as any).checkLocalFailover();
      assert(await emitted === 'failover-v2');
      const item = (client as any).subscriptions.get(key);
      assert(item.content === 'failover-v2');
    });

    it('should switch back to server mode when file is deleted', async () => {
      const client = createClient();
      const key = seedSubscription(client, 'hot-data-id3', 'fo-group');
      const snapshotKey = (client as any).getSnapshotKeyEncoded('hot-data-id3', 'fo-group');
      const failoverFile = (client.snapshot as any).getFailoverFile(snapshotKey);
      await mkdirp(path.dirname(failoverFile));
      await fs.writeFile(failoverFile, 'failover-v1');
      await (client as any).checkLocalFailover();
      const item = (client as any).subscriptions.get(key);
      assert(item.useFailover === true);

      await rimraf(failoverFile);
      await (client as any).checkLocalFailover();
      assert(item.useFailover === false);
      assert(item.failoverVersion === null);
    });

    it('should exclude failover-mode keys from server probe', async () => {
      const client = createClient();
      const failoverKey = seedSubscription(client, 'probe-skip-data-id', 'fo-group');
      seedSubscription(client, 'probe-keep-data-id', 'fo-group');
      // 通过真实 failover 文件进入 failover 模式
      const snapshotKey = (client as any).getSnapshotKeyEncoded('probe-skip-data-id', 'fo-group');
      const failoverFile = (client.snapshot as any).getFailoverFile(snapshotKey);
      await mkdirp(path.dirname(failoverFile));
      await fs.writeFile(failoverFile, 'failover-content');

      let captured;
      mm(client.httpAgent, 'request', async (path, options) => {
        captured = options;
        return '';
      });
      await (client as any).checkServerConfigInfo();

      assert((client as any).subscriptions.get(failoverKey).useFailover === true);
      const probing = captured.data['Listening-Configs'];
      assert(probing.includes('probe-keep-data-id'));
      assert(!probing.includes('probe-skip-data-id'));
    });
  });
});
