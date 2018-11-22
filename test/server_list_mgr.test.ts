import { ServerListManager } from '../src';

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
    let serverManager;

    before(async () => {
      serverManager = new ServerListManager({
        httpclient,
        endpoint: 'acm.aliyun.com',
        cacheDir,
      });
      await serverManager.ready();
    });

    afterEach(mm.restore);

    after(async () => {
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

    it('should throw error if httpclient not providered', () => {
      assert.throws(() => {
        new ServerListManager({ httpclient: null });
      }, { message: '[Nacos#ServerListManager] options.httpclient is required' });
    });

    describe('getOne()', () => {
      it('should got nacos server list data', async () => {
        let host = await serverManager.getOne();
        assert(host && /^\d+\.\d+\.\d+\.\d+$/.test(host));
        host = await serverManager.getOne();
        assert(host && /^\d+\.\d+\.\d+\.\d+$/.test(host));
      });

      it('should traverse all diamond server list data', async () => {
        const start = await serverManager.getOne();
        let host;
        do {
          host = await serverManager.getOne();
        } while (start !== host);
      });

      it('should return null when server list return empty', async () => {
        mm.data(serverManager, 'fetchServerList', null);
        mm(serverManager, 'serverListCache', new Map());
        const result = await serverManager.getOne();
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
        const host = await serverManager.getOne();
        assert(host && /^\d+\.\d+\.\d+\.\d+$/.test(host));
        const isExist = await fs.exists(path.join(cacheDir, 'snapshot', 'server_list', 'CURRENT_UNIT'));
        assert(isExist);
      });

      it('should get diamond server list ok when request error', async () => {
        let host = await serverManager.getOne();
        assert(host && /^\d+\.\d+\.\d+\.\d+$/.test(host));
        mm(serverManager, 'serverListCache', new Map());
        mm.data(serverManager, 'request', null);
        host = await serverManager.getOne();
        assert(host && /^\d+\.\d+\.\d+\.\d+$/.test(host));
      });
    });

    describe('_syncServers', () => {
      it('should auto _syncServers', async () => {
        // assert(serverManager.isSync);
        const host = await serverManager.getOne();
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
        serverManager.clearaServerCache();
        mm.data(serverManager, 'request', null);
        mm.data(serverManager.snapshot, 'get', null);

        const host = await serverManager.getOne('CURRENT_UNIT');
        assert(!host);
        mm.restore();
        await sleep(4000);

        assert(serverManager.hasServerInCache('CURRENT_UNIT'));
      });
    });
  });

  describe('use ip and direct mode', () => {
    let serverManager: ServerListManager;

    before(async () => {
      serverManager = new ServerListManager({
        httpclient,
        serverAddr: '106.14.43.196:8848',
        cacheDir,
      });
      await serverManager.ready();
    });

    afterEach(mm.restore);

    after(async () => {
      serverManager.close();
      await rimraf(cacheDir);
      await sleep(4000);
    });

    it('should get server from direct mode', async () => {
      const addr = await serverManager.getServerAddr();
      assert(addr.hosts.length === 1);
      assert(addr.index === 0);
    });

    it('should get one addr from direct mode', async () => {
      const addr = await serverManager.getOne();
      assert(addr && /^\d+\.\d+\.\d+\.\d+:\d+$/.test(addr));
    });
  });
});
