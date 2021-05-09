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
import { ServerListManager } from '../src';
import { createDefaultConfiguration } from './utils';

const fs = require('mz/fs');
const path = require('path');
const mm = require('mm');
const assert = require('assert');
const pedding = require('pedding');
const httpclient = require('urllib');
const { rimraf, sleep } = require('mz-modules');

describe('test/server_list_mgr.test.ts', () => {
  const cacheDir = path.join(__dirname, '.cache');

  describe('find server addresss list by server', () => {
    let serverManager: ServerListManager;
    const defaultOptions = {
      appName: 'test',
      endpoint: 'acm.aliyun.com',
      namespace: '81597370-5076-4216-9df5-538a2b55bac3',
      accessKey: '4c796a4dcd0d4f5895d4ba83a296b489',
      secretKey: 'UjLemP8inirhjMg1NZyY0faOk1E=',
      httpclient,
      ssl: false,
      cacheDir
    };

    const configuration = createDefaultConfiguration(defaultOptions);

    beforeAll(async () => {
      serverManager = new ServerListManager({ configuration });
      await serverManager.ready();
    });

    afterEach(mm.restore);

    afterAll(async () => {
      serverManager.close();
      await rimraf(cacheDir);
      await sleep(4000);
    });


    it('should ready', done => {
      done = pedding(3, done);
      serverManager.ready(done);
      serverManager.ready(done);
      serverManager.ready(() => serverManager.ready(done));
    });

    describe('getCurrentServerAddr()', () => {
      it('should got nacos server list data', async () => {
        let host = await serverManager.getCurrentServerAddr();
        assert(host && /^\d+\.\d+\.\d+\.\d+$/.test(host));
        host = await serverManager.getCurrentServerAddr();
        assert(host && /^\d+\.\d+\.\d+\.\d+$/.test(host));
      });

      it('should traverse all diamond server list data', async () => {
        const start = await serverManager.getCurrentServerAddr();
        let host;
        do {
          host = await serverManager.getCurrentServerAddr();
        } while (start !== host);
      });

      it('should return null when server list return empty', async () => {
        mm.data(serverManager, 'fetchServerList', null);
        mm(serverManager, 'serverListCache', new Map());
        mm(serverManager, 'currentServerAddrMap', new Map());
        const result = await serverManager.getCurrentServerAddr();
        assert(result == null);
      });
    });

    describe('fetchServerList(unit)', () => {
      it('should use CURRENT_UNIT if unit not providered', async () => {
        const data = await serverManager.fetchServerList();
        assert(data && Array.isArray(data.hosts));
        assert(data.index < data.hosts.length && data.index >= 0);
      });

      it('should empty server list', async () => {
        mm.http.request(/nacos/, Buffer.alloc(0), {});
        mm.data(serverManager.snapshot, 'get', null);
        let data = await serverManager.fetchServerList();
        assert(!data);

        mm.data(serverManager.httpclient, 'request', { status: 500 });
        data = await serverManager.fetchServerList();
        assert(!data);

        mm.restore();
        mm.data(serverManager, 'request', null);
        // mm.data(serverManager.snapshot, 'get', '{');
        const key = serverManager.formatKey('CURRENT_UNIT');
        await serverManager.snapshot.save(key, '{');
        let cache = await serverManager.snapshot.get(key);
        assert(cache === '{');
        data = await serverManager.fetchServerList();
        cache = await serverManager.snapshot.get(key);
        assert(!cache);
        assert(!data);
      });

      it('should get server list of certain unit', async () => {
        const currentUnit = await serverManager.getCurrentUnit();
        const data = await serverManager.fetchServerList(currentUnit);
        assert(data && Array.isArray(data.hosts));
        assert(data.index < data.hosts.length && data.index >= 0);
      });
    });

    describe('snapshot', () => {
      it('should save diamond server list ok', async () => {
        const host = await serverManager.getCurrentServerAddr();
        assert(host && /^\d+\.\d+\.\d+\.\d+$/.test(host));
        const isExist = await fs.exists(path.join(cacheDir, 'snapshot', 'server_list', 'CURRENT_UNIT'));
        assert(isExist);
      });

      it('should get diamond server list ok when request error', async () => {
        let host = await serverManager.getCurrentServerAddr();
        assert(host && /^\d+\.\d+\.\d+\.\d+$/.test(host));
        mm(serverManager, 'serverListCache', new Map());
        mm.data(serverManager, 'request', null);
        host = await serverManager.getCurrentServerAddr();
        assert(host && /^\d+\.\d+\.\d+\.\d+$/.test(host));
      });
    });

    describe('_syncServers', () => {
      it('should auto _syncServers', async () => {
        // assert(serverManager.isSync);
        const host = await serverManager.getCurrentServerAddr();
        assert(host && /^\d+\.\d+\.\d+\.\d+$/.test(host));
        assert(serverManager.hasServerInCache('CURRENT_UNIT'));
        serverManager.syncServers();
        serverManager.syncServers();
      });

      it('should _syncServers periodically', async () => {
        mm.error(serverManager, 'fetchServerList', 'mock error');
        let error;
        try {
          await serverManager.await('error');
        } catch (err) {
          error = err;
        }
        assert(error && error.name === 'NacosUpdateServersError');
        assert(error.message.includes('mock error'));
      });

      it('should update server list', async () => {
        serverManager.clearServerCache();
        mm.data(serverManager, 'request', null);
        mm.data(serverManager.snapshot, 'get', null);
        mm(serverManager, 'currentServerAddrMap', new Map());

        const host = await serverManager.getCurrentServerAddr('CURRENT_UNIT');
        assert(!host);
        mm.restore();
        await sleep(4000);

        assert(serverManager.hasServerInCache('CURRENT_UNIT'));
      });
    });
  });

  describe('use ip and direct mode', () => {
    let serverManager: ServerListManager;

    beforeAll(async () => {
      const configuration = createDefaultConfiguration({
        httpclient,
        serverAddr: '106.14.43.196:8848',
        cacheDir,
      });
      serverManager = new ServerListManager({ configuration });
      await serverManager.ready();
    });

    afterEach(mm.restore);

    afterAll(async () => {
      serverManager.close();
      await rimraf(cacheDir);
      await sleep(4000);
    });

    it('should get server from direct mode', async () => {
      const addr = await serverManager.getServerInCache();
      assert(addr.hosts.length === 1);
      assert(addr.index === 0);
    });

    it('should get one addr from direct mode', async () => {
      const addr = await serverManager.getCurrentServerAddr();
      assert(addr && /^\d+\.\d+\.\d+\.\d+:\d+$/.test(addr));
    });
  });
});
