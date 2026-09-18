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
import { DataClient } from '../src/client';
import { HttpAgent } from '../src/http_agent';
import { KeyedAsyncQueue } from '../src/keyed_queue';
import { GrpcConnection } from 'nacos-common';
import { createDefaultConfiguration } from './utils';
import * as path from 'path';
import * as mm from 'mm';
import * as assert from 'assert';

const fs = require('mz/fs');
const rawFs = require('fs');
const { mkdirp, rimraf, sleep } = require('mz-modules');

const cacheDir = path.join(__dirname, '.cache_local');

/** 确定性测试用的可外部结算 Promise。 */
interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value?: T) => void;
  reject: (err: any) => void;
}
function deferred<T>(): Deferred<T> {
  let resolve: (value?: T) => void;
  let reject: (err: any) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res as any; reject = rej; });
  return { promise, resolve: resolve!, reject: reject! };
}

/**
 * 排干事件循环：连续若干轮 setImmediate，确保所有已就绪的 micro/macro task 结算。
 * 不依赖具体时长（非 sleep 定时），仅用于在所有 deferred 结算后让链式回调收敛。
 */
async function flush(rounds = 8): Promise<void> {
  for (let i = 0; i < rounds; i++) {
    await new Promise(resolve => setImmediate(resolve));
  }
}

/** 用内存 Map 替换快照读写，使 get/save/delete 成为确定性 microtask（无真实 fs 时序）。 */
function memSnapshot(client: any): Map<string, string> {
  const store = new Map<string, string>();
  mm(client.snapshot, 'get', async (key: string) => (store.has(key) ? store.get(key) : null));
  mm(client.snapshot, 'save', async (key: string, value: string) => {
    if (!value) { store.delete(key); } else { store.set(key, value); }
  });
  mm(client.snapshot, 'delete', async (key: string) => { store.delete(key); });
  mm(client.snapshot, 'getFailover', async () => null);
  mm(client.snapshot, 'getFailoverMtime', async () => null);
  return store;
}

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

  describe('HTTP empty-probe bounded delay (checkServerConfigInfo)', () => {
    // 隔离 checkServerConfigInfo：屏蔽 checkLocalFailover 的副作用，直接编排订阅项的 useFailover
    function seedHttp(client: any, dataId: string, group: string, useFailover: boolean) {
      const key = client.formatKey({ dataId, group });
      client.subscriptions.set(key, { dataId, group, md5: 'md5-' + dataId, content: 'c', useFailover });
    }

    it('P2-3: all-failover round sends no HTTP request but awaits one bounded delay', async () => {
      const client = createClient();
      mm(client as any, 'checkLocalFailover', async () => {});
      let reqCount = 0;
      mm(client.httpAgent, 'request', async () => { reqCount++; return ''; });
      let delayCount = 0;
      mm(client as any, 'waitBeforeNextLocalCheck', async () => { delayCount++; });
      seedHttp(client as any, 'p23-fo1', 'g', true);
      seedHttp(client as any, 'p23-fo2', 'g', true);

      await (client as any).checkServerConfigInfo();
      assert(reqCount === 0);
      assert(delayCount === 1);
    });

    it('P2-3: mixed failover/server sends only server keys and no delay', async () => {
      const client = createClient();
      mm(client as any, 'checkLocalFailover', async () => {});
      let captured = '';
      mm(client.httpAgent, 'request', async (_path: string, options: any) => {
        captured = options.data[(client as any).listenerDataKey];
        return '';
      });
      let delayCount = 0;
      mm(client as any, 'waitBeforeNextLocalCheck', async () => { delayCount++; });
      seedHttp(client as any, 'p23-fo', 'g', true);
      seedHttp(client as any, 'p23-srv', 'g', false);

      await (client as any).checkServerConfigInfo();
      assert(delayCount === 0);
      assert(captured.indexOf('p23-srv') >= 0);
      assert(captured.indexOf('p23-fo') < 0);
    });

    it('P2-3: no-failover round issues an HTTP request and no delay', async () => {
      const client = createClient();
      mm(client as any, 'checkLocalFailover', async () => {});
      let reqCount = 0;
      mm(client.httpAgent, 'request', async () => { reqCount++; return ''; });
      let delayCount = 0;
      mm(client as any, 'waitBeforeNextLocalCheck', async () => { delayCount++; });
      seedHttp(client as any, 'p23-normal', 'g', false);

      await (client as any).checkServerConfigInfo();
      assert(reqCount === 1);
      assert(delayCount === 0);
    });
  });

  describe('gRPC transport disaster recovery', () => {
    // gRPC 是默认传输（Nacos 3.x 唯一传输），构造 DataClient 会真实 connect()。
    // 这里 mock 掉 connect 及 proxy 的网络方法，做纯离线的本地缓存 / 容灾单测。
    const grpcClients: DataClient[] = [];

    function createGrpcClient(): DataClient {
      mm(GrpcConnection.prototype, 'connect', async () => {});
      const client = new DataClient({
        appName: 'test',
        serverAddr: '127.0.0.1:8848',
        namespace: '',
        cacheDir,
      } as any);
      // 服务端异常回退快照时会 emit 'error'，挂空监听避免未捕获错误中断测试
      client.on('error', () => {});
      grpcClients.push(client);
      return client;
    }

    // 直接种入订阅与容灾状态，绕开异步 subscribe 初始化，确定性地驱动热切换检查
    function seedGrpcSubscription(client: DataClient, dataId: string, group: string) {
      const key = `${dataId}@@${group}`;
      const received: string[] = [];
      const anyClient = client as any;
      if (!anyClient._grpcSubscribers) { anyClient._grpcSubscribers = new Map(); }
      anyClient._grpcSubscribers.set(key, [ (content: string) => { received.push(content); } ]);
      if (!anyClient._grpcFailoverState) { anyClient._grpcFailoverState = new Map(); }
      anyClient._grpcFailoverState.set(key, { dataId, group, useFailover: false, failoverVersion: null, content: null, listenerRegistered: true, listenerMd5: '' });
      return { key, received };
    }

    afterEach(() => {
      for (const client of grpcClients) {
        client.close();
      }
      grpcClients.length = 0;
    });

    it('should return failover content without calling server', async () => {
      const client = createGrpcClient();
      let serverCalled = false;
      mm((client as any)._grpcConfigProxy, 'getConfig', async () => {
        serverCalled = true;
        return { content: 'server-config' };
      });
      const snapshotKey = (client as any)._getSnapshotKey('fo-data-id', 'fo-group');
      const failoverFile = (client as any).snapshot.getFailoverFile(snapshotKey);
      await mkdirp(path.dirname(failoverFile));
      await fs.writeFile(failoverFile, 'emergency-config');

      const content = await client.getConfig('fo-data-id', 'fo-group');
      assert(content === 'emergency-config');
      assert(serverCalled === false);
    });

    it('should save snapshot when server responds', async () => {
      const client = createGrpcClient();
      mm((client as any)._grpcConfigProxy, 'getConfig', async () => ({ content: 'server-config' }));
      const snapshotKey = (client as any)._getSnapshotKey('snap-data-id', 'fo-group');

      const content = await client.getConfig('snap-data-id', 'fo-group');
      assert(content === 'server-config');
      assert(await (client as any).snapshot.get(snapshotKey) === 'server-config');
    });

    it('should fall back to snapshot when server errors', async () => {
      const client = createGrpcClient();
      const snapshotKey = (client as any)._getSnapshotKey('fb-data-id', 'fo-group');
      await (client as any).snapshot.save(snapshotKey, 'cached-config');
      mm((client as any)._grpcConfigProxy, 'getConfig', async () => {
        throw new Error('server down');
      });

      const content = await client.getConfig('fb-data-id', 'fo-group');
      assert(content === 'cached-config');
    });

    it('should throw when server errors and no snapshot exists', async () => {
      const client = createGrpcClient();
      mm((client as any)._grpcConfigProxy, 'getConfig', async () => {
        throw new Error('server down');
      });

      let threw = false;
      try {
        await client.getConfig('nofb-data-id', 'fo-group');
      } catch (err) {
        threw = true;
      }
      assert(threw === true);
    });

    it('should not persist snapshot when server returns blank content', async () => {
      const client = createGrpcClient();
      const snapshotKey = (client as any)._getSnapshotKey('blank-data-id', 'fo-group');
      await (client as any).snapshot.save(snapshotKey, 'stale-content');
      assert(await (client as any).snapshot.get(snapshotKey) === 'stale-content');
      // gRPC getConfig 对缺失配置返回空串，空内容应按删除处理（对齐 Java saveSnapshot(null)）
      mm((client as any)._grpcConfigProxy, 'getConfig', async () => ({ content: '' }));

      const content = await client.getConfig('blank-data-id', 'fo-group');
      assert(content === '');
      assert(await (client as any).snapshot.get(snapshotKey) === null);
    });

    it('should delete snapshot on remove()', async () => {
      const client = createGrpcClient();
      const snapshotKey = (client as any)._getSnapshotKey('rm-data-id', 'fo-group');
      await (client as any).snapshot.save(snapshotKey, 'to-be-removed');
      mm((client as any)._grpcConfigProxy, 'remove', async () => true);

      await client.remove('rm-data-id', 'fo-group');
      assert(await (client as any).snapshot.get(snapshotKey) === null);
    });

    it('should switch to failover content when file is created', async () => {
      const client = createGrpcClient();
      const { key, received } = seedGrpcSubscription(client, 'hot-data-id', 'fo-group');
      const snapshotKey = (client as any)._getSnapshotKey('hot-data-id', 'fo-group');
      const failoverFile = (client as any).snapshot.getFailoverFile(snapshotKey);

      await (client as any)._checkGrpcLocalFailover();
      assert((client as any)._grpcFailoverState.get(key).useFailover === false);

      await mkdirp(path.dirname(failoverFile));
      await fs.writeFile(failoverFile, 'failover-v1');
      await (client as any)._checkGrpcLocalFailover();
      const state = (client as any)._grpcFailoverState.get(key);
      assert(state.useFailover === true);
      assert(state.content === 'failover-v1');
      assert(received.includes('failover-v1'));
    });

    it('should reload failover content when file changes', async () => {
      const client = createGrpcClient();
      const { key, received } = seedGrpcSubscription(client, 'hot-data-id2', 'fo-group');
      const snapshotKey = (client as any)._getSnapshotKey('hot-data-id2', 'fo-group');
      const failoverFile = (client as any).snapshot.getFailoverFile(snapshotKey);
      await mkdirp(path.dirname(failoverFile));
      await fs.writeFile(failoverFile, 'failover-v1');
      await (client as any)._checkGrpcLocalFailover();

      await fs.writeFile(failoverFile, 'failover-v2');
      const future = new Date(Date.now() + 5000);
      rawFs.utimesSync(failoverFile, future, future);
      await (client as any)._checkGrpcLocalFailover();
      const state = (client as any)._grpcFailoverState.get(key);
      assert(state.content === 'failover-v2');
      assert(received.includes('failover-v2'));
    });

    it('should switch back to server content when file is deleted', async () => {
      const client = createGrpcClient();
      const { key, received } = seedGrpcSubscription(client, 'hot-data-id3', 'fo-group');
      const snapshotKey = (client as any)._getSnapshotKey('hot-data-id3', 'fo-group');
      const failoverFile = (client as any).snapshot.getFailoverFile(snapshotKey);
      await mkdirp(path.dirname(failoverFile));
      await fs.writeFile(failoverFile, 'failover-v1');
      await (client as any)._checkGrpcLocalFailover();
      assert((client as any)._grpcFailoverState.get(key).useFailover === true);

      mm((client as any)._grpcConfigProxy, 'getConfig', async () => ({ content: 'server-config' }));
      await rimraf(failoverFile);
      await (client as any)._checkGrpcLocalFailover();
      const state = (client as any)._grpcFailoverState.get(key);
      assert(state.useFailover === false);
      assert(state.failoverVersion === null);
      assert(state.content === 'server-config');
      assert(received.includes('server-config'));
    });

    it('should deliver server push when not in failover mode', async () => {
      const client = createGrpcClient();
      let serverContent = 'server-config';
      mm((client as any)._grpcConfigProxy, 'getConfig', async () => ({ content: serverContent }));
      mm((client as any)._grpcConfigProxy, 'addListener', async () => {});
      const received: string[] = [];
      client.subscribe({ dataId: 'push-ok-data-id', group: 'fo-group' }, (content: string) => received.push(content));
      await sleep(100);

      serverContent = 'server-config-v2';
      (client as any)._grpcConfigProxy.emit('configChanged', { dataId: 'push-ok-data-id', group: 'fo-group', tenant: '' });
      await sleep(100);
      assert(received.includes('server-config-v2'));
    });

    it('should ignore server push while in failover mode', async () => {
      const client = createGrpcClient();
      let serverContent = 'server-config';
      mm((client as any)._grpcConfigProxy, 'getConfig', async () => ({ content: serverContent }));
      mm((client as any)._grpcConfigProxy, 'addListener', async () => {});
      const received: string[] = [];
      client.subscribe({ dataId: 'push-data-id', group: 'fo-group' }, (content: string) => received.push(content));
      await sleep(100);

      const snapshotKey = (client as any)._getSnapshotKey('push-data-id', 'fo-group');
      const failoverFile = (client as any).snapshot.getFailoverFile(snapshotKey);
      await mkdirp(path.dirname(failoverFile));
      await fs.writeFile(failoverFile, 'failover-v1');
      await (client as any)._checkGrpcLocalFailover();
      assert((client as any)._grpcFailoverState.get('push-data-id@@fo-group').useFailover === true);

      serverContent = 'server-config-v2';
      (client as any)._grpcConfigProxy.emit('configChanged', { dataId: 'push-data-id', group: 'fo-group', tenant: '' });
      await sleep(100);
      assert(!received.includes('server-config-v2'));
    });

    it('should not resurrect snapshot when in-flight get finishes after remove', async () => {
      const client = createGrpcClient();
      const store = memSnapshot(client);
      const snapshotKey = (client as any)._getSnapshotKey('io-data-id', 'fo-group');
      const fetchGate = deferred<string>();
      mm((client as any)._grpcConfigProxy, 'getConfig', async () => ({ content: await fetchGate.promise }));
      mm((client as any)._grpcConfigProxy, 'remove', async () => true);

      // get 先开始并停在服务端拉取处
      const getP = client.getConfig('io-data-id', 'fo-group');
      await flush();
      // remove 随后开始（远端 remove + 本地清理）
      const removeP = client.remove('io-data-id', 'fo-group');
      await flush();
      // get 在 remove 之后才拿到服务端响应
      fetchGate.resolve('server-config');
      await Promise.all([ getP, removeP ]);
      await flush();
      // 无论 get 何时晚到，最终都不得复活已被 remove 删除的快照
      assert(store.has(snapshotKey) === false);
    });

    // ---- DataClient 生命周期 / 顺序 / 去重 / 多监听（对齐 Java CacheData synchronized + lifecycle）----

    it('A: subscribe init finishing after unSubscribe must not callback or addListener', async () => {
      const client = createGrpcClient();
      memSnapshot(client);
      const gate = deferred<string>();
      let addCalls = 0;
      mm((client as any)._grpcConfigProxy, 'getConfig', async () => ({ content: await gate.promise }));
      mm((client as any)._grpcConfigProxy, 'addListener', async () => { addCalls++; });
      mm((client as any)._grpcConfigProxy, 'removeListener', async () => {});
      const received: string[] = [];
      const listener = (content: string) => received.push(content);

      client.subscribe({ dataId: 'lif-a-data-id', group: 'fo-group' }, listener);
      await flush(); // 初始化停在服务端拉取处
      client.unSubscribe({ dataId: 'lif-a-data-id', group: 'fo-group' }, listener);
      gate.resolve('server-config'); // 退订后初始化才拿到服务端响应
      await flush();

      assert(received.length === 0);
      assert(addCalls === 0);
    });

    it('B: subscribe init finishing after close must not callback or addListener', async () => {
      const client = createGrpcClient();
      memSnapshot(client);
      const gate = deferred<string>();
      let addCalls = 0;
      mm((client as any)._grpcConfigProxy, 'getConfig', async () => ({ content: await gate.promise }));
      mm((client as any)._grpcConfigProxy, 'addListener', async () => { addCalls++; });
      mm((client as any)._grpcConfigProxy, 'removeListener', async () => {});
      const received: string[] = [];

      client.subscribe({ dataId: 'lif-b-data-id', group: 'fo-group' }, (content: string) => received.push(content));
      await flush();
      client.close(); // 关闭后初始化才完成
      gate.resolve('server-config');
      await flush();

      assert(received.length === 0);
      assert(addCalls === 0);
    });

    it('C: two same-key configChanged responses completing out of order must not regress to old value', async () => {
      const client = createGrpcClient();
      memSnapshot(client);
      let call = 0;
      const slow = deferred<string>();
      mm((client as any)._grpcConfigProxy, 'getConfig', async () => {
        call++;
        if (call === 1) { return { content: 'init' }; }      // subscribe 初始化
        if (call === 2) { return { content: await slow.promise }; } // event1 -> 'old'（延迟）
        return { content: 'new' };                             // event2 -> 'new'
      });
      mm((client as any)._grpcConfigProxy, 'addListener', async () => {});
      const received: string[] = [];
      client.subscribe({ dataId: 'ord-data-id', group: 'fo-group' }, (content: string) => received.push(content));
      await flush(); // 初始化完成（call 1 -> 'init'）

      // event1 先到：其服务端响应被 slow 阻塞
      (client as any)._grpcConfigProxy.emit('configChanged', { dataId: 'ord-data-id', group: 'fo-group', tenant: '' });
      await flush();
      // event2 后到：其服务端响应立即返回 'new'
      (client as any)._grpcConfigProxy.emit('configChanged', { dataId: 'ord-data-id', group: 'fo-group', tenant: '' });
      await flush();
      // event1 的旧响应最后才完成
      slow.resolve('old');
      await flush();

      const state = (client as any)._grpcFailoverState.get('ord-data-id@@fo-group');
      // 旧异步响应不得后完成覆盖新值
      assert(received[received.length - 1] === 'new');
      assert(state.content === 'new');
    });

    it('D: overlapping _checkGrpcLocalFailover triggers at most one server recovery', async () => {
      const client = createGrpcClient();
      memSnapshot(client); // getFailoverMtime -> null，触发从 failover 恢复
      const { key } = seedGrpcSubscription(client, 'ovl-data-id', 'fo-group');
      const state = (client as any)._grpcFailoverState.get(key);
      state.useFailover = true;
      state.failoverVersion = 123;
      state.content = 'failover';

      let calls = 0;
      const gate = deferred<string>();
      mm((client as any)._grpcConfigProxy, 'getConfig', async () => { calls++; return { content: await gate.promise }; });

      const p1 = (client as any)._checkGrpcLocalFailover();
      const p2 = (client as any)._checkGrpcLocalFailover();
      await flush();
      gate.resolve('server-config');
      await Promise.all([ p1, p2 ]);
      await flush();

      assert(calls === 1);
      assert(state.content === 'server-config'); // 已恢复且未被旧值覆盖
    });

    it('E: failover created during subscribe init server fetch notifies server then failover', async () => {
      const client = createGrpcClient();
      const serverFetchStarted = deferred<void>();
      const fetchGate = deferred<string>();
      const listenerAdded = deferred<void>();
      let addCalls = 0;
      mm((client as any)._grpcConfigProxy, 'getConfig', async () => {
        serverFetchStarted.resolve();
        return { content: await fetchGate.promise };
      });
      mm((client as any)._grpcConfigProxy, 'addListener', async () => {
        addCalls++;
        listenerAdded.resolve();
      });
      const received: string[] = [];
      const dataId = 'init-race-data-id';
      const group = 'fo-group';
      const snapshotKey = (client as any)._getSnapshotKey(dataId, group);
      const failoverFile = (client as any).snapshot.getFailoverFile(snapshotKey);

      client.subscribe({ dataId, group }, (content: string) => received.push(content));
      await serverFetchStarted.promise;
      await mkdirp(path.dirname(failoverFile));
      await fs.writeFile(failoverFile, 'failover-v1');
      fetchGate.resolve('server-config');
      await listenerAdded.promise;
      await flush();

      const state = (client as any)._grpcFailoverState.get(`${dataId}@@${group}`);
      assert.deepStrictEqual(received, [ 'server-config', 'failover-v1' ]);
      assert(state.useFailover === true);
      assert(state.content === 'failover-v1');
      assert(addCalls === 1);
    });

    it('F: pre-existing failover with identical content notifies listener only once on subscribe init', async () => {
      const client = createGrpcClient();
      const snapshotKey = (client as any)._getSnapshotKey('pre-fo-data-id', 'fo-group');
      const failoverFile = (client as any).snapshot.getFailoverFile(snapshotKey);
      await mkdirp(path.dirname(failoverFile));
      await fs.writeFile(failoverFile, 'failover-v1');

      const added = deferred<void>();
      mm((client as any)._grpcConfigProxy, 'getConfig', async () => ({ content: 'server-config' }));
      mm((client as any)._grpcConfigProxy, 'addListener', async () => { added.resolve(); });
      const received: string[] = [];
      client.subscribe({ dataId: 'pre-fo-data-id', group: 'fo-group' }, (content: string) => received.push(content));
      await added.promise;
      await flush();

      // failover 已存在且内容与已读到的相同：只回调一次
      assert(received.filter(x => x === 'failover-v1').length === 1);
    });

    it('G: same-key double listener addListener once; unsubscribing one keeps the other receiving push', async () => {
      const client = createGrpcClient();
      memSnapshot(client);
      let addCalls = 0;
      mm((client as any)._grpcConfigProxy, 'getConfig', async () => ({ content: 'init' }));
      mm((client as any)._grpcConfigProxy, 'addListener', async () => { addCalls++; });
      mm((client as any)._grpcConfigProxy, 'removeListener', async () => {});
      const r1: string[] = [];
      const r2: string[] = [];
      const l1 = (content: string) => r1.push(content);
      const l2 = (content: string) => r2.push(content);

      client.subscribe({ dataId: 'dbl-data-id', group: 'fo-group' }, l1);
      client.subscribe({ dataId: 'dbl-data-id', group: 'fo-group' }, l2);
      await flush();
      // 同 key 多 listener 只注册一次远端 listener
      assert(addCalls === 1);

      // 退订其中一个，另一个仍收 push
      client.unSubscribe({ dataId: 'dbl-data-id', group: 'fo-group' }, l1);
      mm((client as any)._grpcConfigProxy, 'getConfig', async () => ({ content: 'v2' }));
      (client as any)._grpcConfigProxy.emit('configChanged', { dataId: 'dbl-data-id', group: 'fo-group', tenant: '' });
      await flush();

      assert(r2.indexOf('v2') >= 0);
      assert(r1.indexOf('v2') < 0);
    });

    it('H: fast unsubscribe then resubscribe orders remote ops add-old, remove-old, add-new via op queue', async () => {
      const client = createGrpcClient();
      memSnapshot(client);
      const order: string[] = [];
      mm((client as any)._grpcConfigProxy, 'getConfig', async () => ({ content: 'server-config' }));
      const addOld = deferred<void>();
      const addNew = deferred<void>();
      let addCall = 0;
      mm((client as any)._grpcConfigProxy, 'addListener', async () => {
        addCall++;
        if (addCall === 1) { order.push('add-old'); await addOld.promise; }
        else { order.push('add-new'); await addNew.promise; }
      });
      const removeOld = deferred<void>();
      mm((client as any)._grpcConfigProxy, 'removeListener', async () => {
        order.push('remove-old');
        await removeOld.promise;
      });

      const l1 = () => {};
      const l2 = () => {};
      const key = 'seq-data-id@@fo-group';
      // subscribe(l1)：init-old 入队；flush 后其远端 add 已在途（deferred 未结算）
      client.subscribe({ dataId: 'seq-data-id', group: 'fo-group' }, l1);
      await flush();
      // add-old 在途时快速退订并同 key 重新订阅：remove-old 与 init-new 依次入队
      client.unSubscribe({ dataId: 'seq-data-id', group: 'fo-group' }, l1);
      client.subscribe({ dataId: 'seq-data-id', group: 'fo-group' }, l2);
      await flush();
      addOld.resolve();   // 旧 init 的 add 完成，队列继续到远端 remove
      await flush();
      removeOld.resolve();
      await flush();
      addNew.resolve();   // 新 init 的 add 完成
      await flush();

      // 同 key 远端 add/remove 全部经 op queue FIFO：add-old -> remove-old -> add-new
      assert.deepStrictEqual(order, [ 'add-old', 'remove-old', 'add-new' ]);
      const state = (client as any)._grpcFailoverState.get(key);
      assert(state.listenerRegistered === true);
    });

    it('I: failed initial addListener is retried by failover watcher until it succeeds', async () => {
      const client = createGrpcClient();
      memSnapshot(client);
      let calls = 0;
      mm((client as any)._grpcConfigProxy, 'getConfig', async () => ({ content: 'server-config' }));
      mm((client as any)._grpcConfigProxy, 'addListener', async () => {
        calls++;
        if (calls === 1) { throw new Error('addListener failed'); }
      });
      mm((client as any)._grpcConfigProxy, 'removeListener', async () => {});

      const key = 'retry-data-id@@fo-group';
      client.subscribe({ dataId: 'retry-data-id', group: 'fo-group' }, () => {});
      await flush();
      const state = (client as any)._grpcFailoverState.get(key);
      // 初始注册失败：仅调用一次且未标记为已注册（快照到局部变量，避免 assert 收窄字面量类型）
      const callsAfterInit = calls;
      assert(callsAfterInit === 1);
      assert(state.listenerRegistered === false);

      // watcher 每轮对 active 且未注册成功的 key 重试 addListener，成功后置 true
      await (client as any)._checkGrpcLocalFailover();
      await flush();
      const callsAfterRetry = calls;
      assert(callsAfterRetry === 2);
      assert(state.listenerRegistered === true);
    });

    it('K: initial fetch failure keeps key retriable; failover watcher registers with empty md5 on recovery', async () => {
      const client = createGrpcClient();
      memSnapshot(client); // 内存快照全空：服务端异常时无快照可回退 -> _getConfigWithCache 抛错
      const errors: Error[] = [];
      client.on('error', (err: Error) => errors.push(err));

      // 初始 fetch 因服务端错误失败；恢复后返回内容（本测试仅用于验证注册可重试，服务端不会被 watcher 再拉取）
      let failGet = true;
      mm((client as any)._grpcConfigProxy, 'getConfig', async () => {
        if (failGet) { throw new Error('server down'); }
        return { content: 'server-config' };
      });
      // addListener 始终成功；记录调用次数与注册所用 md5
      let addCalls = 0;
      let lastMd5: string | null = null;
      mm((client as any)._grpcConfigProxy, 'addListener', async (_dataId: string, _group: string, md5: string) => {
        addCalls++;
        lastMd5 = md5;
      });
      mm((client as any)._grpcConfigProxy, 'removeListener', async () => {});

      const key = 'recover-data-id@@fo-group';
      client.subscribe({ dataId: 'recover-data-id', group: 'fo-group' }, () => {});
      await flush();

      // 初始 fetch 失败且无快照：错误经 error event 可观察，且未注册远端监听
      const errorsAfterInit = errors.length;
      assert(errorsAfterInit >= 1);
      const addCallsAfterInit = addCalls;
      assert(addCallsAfterInit === 0);
      // state 仍 active（未关闭、仍为该 key 登记对象）且尚未注册成功 -> 可由 watcher 重试
      const state = (client as any)._grpcFailoverState.get(key);
      assert(state !== undefined);
      assert(state.listenerRegistered === false);

      // 服务端恢复：watcher 对 active 且未注册成功的 key 以空 md5（本地无内容的合法监听语义）重试 addListener
      failGet = false;
      await (client as any)._checkGrpcLocalFailover();
      await flush();
      const addCallsAfterRetry = addCalls;
      assert(addCallsAfterRetry === 1);
      assert(lastMd5 === '');
      assert(state.listenerRegistered === true);
    });

    it('J: subscribe after close is a no-op (no server get / addListener / watcher / subscriber)', async () => {
      const client = createGrpcClient();
      memSnapshot(client);
      let getCalls = 0;
      let addCalls = 0;
      mm((client as any)._grpcConfigProxy, 'getConfig', async () => { getCalls++; return { content: 'server-config' }; });
      mm((client as any)._grpcConfigProxy, 'addListener', async () => { addCalls++; });
      mm((client as any)._grpcConfigProxy, 'removeListener', async () => {});

      client.close();
      const ret = client.subscribe({ dataId: 'closed-data-id', group: 'fo-group' }, () => {});
      await flush();

      assert(ret === client);
      assert(getCalls === 0);
      assert(addCalls === 0);
      const subs = (client as any)._grpcSubscribers;
      assert(!subs || subs.size === 0);
      assert((client as any)._failoverWatcher === null);
    });

    it('P2-1: snapshot fallback during failover-file-delete keeps failover; only server fetch clears it', async () => {
      const client = createGrpcClient();
      const { key, received } = seedGrpcSubscription(client, 'p21-data-id', 'fo-group');
      const store = memSnapshot(client);
      const snapshotKey = (client as any)._getSnapshotKey('p21-data-id', 'fo-group');
      // 预存旧的 server 快照，作为服务端异常时的回退内容
      store.set(snapshotKey, 'server-old');
      // 进入 failover 模式；memSnapshot 使 getFailoverMtime 恒为 null，驱动删除恢复路径
      const state = (client as any)._grpcFailoverState.get(key);
      state.useFailover = true;
      state.failoverVersion = 12345;
      state.content = 'failover-v1';
      state.listenerRegistered = true;
      state.listenerMd5 = '';

      let call = 0;
      mm((client as any)._grpcConfigProxy, 'getConfig', async () => {
        call++;
        if (call === 1) { throw new Error('server down'); }
        return { content: 'server-new' };
      });

      // 第一轮：服务端失败 → 回退快照 'server-old'（source==='snapshot'）
      await (client as any)._checkGrpcFailoverForKey(key);
      await flush();
      // 快照回退不得清 failover，也不得用 server-old 通知（下一轮继续请求服务端）
      assert(state.useFailover === true);
      assert(state.content === 'failover-v1');
      assert(received.indexOf('server-old') < 0);

      // 第二轮：服务端恢复返回 server-new（source==='server'）→ 清 failover 并通知
      await (client as any)._checkGrpcFailoverForKey(key);
      await flush();
      assert(state.useFailover === false);
      assert(state.failoverVersion === null);
      assert(state.content === 'server-new');
      assert(received.indexOf('server-new') >= 0);
      // 只通知一次 server-new，无额外/重复 push
      assert(received.filter(c => c === 'server-new').length === 1);
    });

    it('P2-2: DataClient getConfig preserves snapshot and falls back on server error (500 internal)', async () => {
      const client = createGrpcClient();
      const store = memSnapshot(client);
      const snapshotKey = (client as any)._getSnapshotKey('p22-500', 'fo-group');
      store.set(snapshotKey, 'cached-500');
      mm((client as any)._grpcConfigProxy, 'getConfig', async () => {
        const err: any = new Error('internal'); err.resultCode = 500; err.errorCode = 500; throw err;
      });
      const content = await client.getConfig('p22-500', 'fo-group');
      assert(content === 'cached-500');
      // 服务端错误只回退，不得删除快照
      assert(store.get(snapshotKey) === 'cached-500');
    });

    it('P2-2: DataClient getConfig deletes snapshot on confirmed absence (getConfig null)', async () => {
      const client = createGrpcClient();
      const store = memSnapshot(client);
      const snapshotKey = (client as any)._getSnapshotKey('p22-absent', 'fo-group');
      store.set(snapshotKey, 'stale');
      // 服务端确认不存在（typed getConfig 返回 null）
      mm((client as any)._grpcConfigProxy, 'getConfig', async () => ({ content: null }));
      const content = await client.getConfig('p22-absent', 'fo-group');
      assert(content === '');
      assert(store.has(snapshotKey) === false);
    });

    it('P2-2: DataClient remove preserves snapshot when server remove returns false', async () => {
      const client = createGrpcClient();
      const store = memSnapshot(client);
      const snapshotKey = (client as any)._getSnapshotKey('p22-rm-false', 'fo-group');
      store.set(snapshotKey, 'keep-me');
      mm((client as any)._grpcConfigProxy, 'remove', async () => false);
      const ret = await client.remove('p22-rm-false', 'fo-group');
      assert(ret === false);
      assert(store.get(snapshotKey) === 'keep-me');
    });

    it('P2-2: DataClient remove deletes snapshot only when server remove returns true', async () => {
      const client = createGrpcClient();
      const store = memSnapshot(client);
      const snapshotKey = (client as any)._getSnapshotKey('p22-rm-true', 'fo-group');
      store.set(snapshotKey, 'gone');
      mm((client as any)._grpcConfigProxy, 'remove', async () => true);
      const ret = await client.remove('p22-rm-true', 'fo-group');
      assert(ret === true);
      assert(store.has(snapshotKey) === false);
    });

    it('P2-4: initial listener throwing does not block addListener; error is observable', async () => {
      const client = createGrpcClient();
      memSnapshot(client);
      mm((client as any)._grpcConfigProxy, 'getConfig', async () => ({ content: 'init-content' }));
      let addCalled: boolean = false;
      mm((client as any)._grpcConfigProxy, 'addListener', async () => { addCalled = true; });
      const errors: Error[] = [];
      client.removeAllListeners('error');
      client.on('error', (err: Error) => { errors.push(err); });

      client.subscribe({ dataId: 'p24-init', group: 'fo-group' }, () => { throw new Error('listener-boom'); });
      await flush();
      // 初始 listener 抛异常不得阻断 addListener
      assert(addCalled);
      assert(errors.some(e => e.message === 'listener-boom'));
    });

    it('P2-4: failover watcher isolates a throwing listener; others still receive and state commits', async () => {
      const client = createGrpcClient();
      const anyClient = client as any;
      const key = 'p24-fo@@fo-group';
      const received: string[] = [];
      anyClient._grpcSubscribers = new Map();
      anyClient._grpcSubscribers.set(key, [
        () => { throw new Error('fo-listener-boom'); },
        (c: string) => { received.push(c); },
      ]);
      anyClient._grpcFailoverState = new Map();
      anyClient._grpcFailoverState.set(key, { dataId: 'p24-fo', group: 'fo-group', useFailover: false, failoverVersion: null, content: null, listenerRegistered: true, listenerMd5: '' });
      mm(anyClient.snapshot, 'getFailoverMtime', async () => 4242);
      mm(anyClient.snapshot, 'getFailover', async () => 'failover-content');
      const errors: Error[] = [];
      client.removeAllListeners('error');
      client.on('error', (err: Error) => { errors.push(err); });

      await anyClient._checkGrpcFailoverForKey(key);
      await flush();
      const state = anyClient._grpcFailoverState.get(key);
      // 第一个 listener 抛异常，第二个仍收到内容；状态/version 已提交
      assert(state.useFailover === true);
      assert(state.failoverVersion === 4242);
      assert(state.content === 'failover-content');
      assert(received.indexOf('failover-content') >= 0);
      assert(errors.some(e => e.message === 'fo-listener-boom'));
    });

    it('P2-4: server push broadcast isolates a throwing listener', async () => {
      const client = createGrpcClient();
      const anyClient = client as any;
      const key = 'p24-push@@fo-group';
      const received: string[] = [];
      anyClient._grpcSubscribers = new Map();
      anyClient._grpcSubscribers.set(key, [
        () => { throw new Error('push-listener-boom'); },
        (c: string) => { received.push(c); },
      ]);
      anyClient._grpcFailoverState = new Map();
      anyClient._grpcFailoverState.set(key, { dataId: 'p24-push', group: 'fo-group', useFailover: false, failoverVersion: null, content: null, listenerRegistered: true, listenerMd5: '' });
      memSnapshot(client);
      mm((client as any)._grpcConfigProxy, 'getConfig', async () => ({ content: 'pushed-content' }));
      const errors: Error[] = [];
      client.removeAllListeners('error');
      client.on('error', (err: Error) => { errors.push(err); });

      anyClient._onGrpcConfigChanged({ dataId: 'p24-push', group: 'fo-group', tenant: '' });
      await flush();
      assert(received.indexOf('pushed-content') >= 0);
      assert(errors.some(e => e.message === 'push-listener-boom'));
    });

    it('P2-4: async listener rejection is isolated and observable; later listeners still notified', async () => {
      const client = createGrpcClient();
      const anyClient = client as any;
      const key = 'p24-async@@fo-group';
      const received: string[] = [];
      anyClient._grpcSubscribers = new Map();
      anyClient._grpcSubscribers.set(key, [
        async () => { throw new Error('async-push-boom'); },
        (c: string) => { received.push(c); },
      ]);
      anyClient._grpcFailoverState = new Map();
      anyClient._grpcFailoverState.set(key, { dataId: 'p24-async', group: 'fo-group', useFailover: false, failoverVersion: null, content: null, listenerRegistered: true, listenerMd5: '' });
      memSnapshot(client);
      mm((client as any)._grpcConfigProxy, 'getConfig', async () => ({ content: 'async-pushed' }));
      const errors: Error[] = [];
      client.removeAllListeners('error');
      client.on('error', (err: Error) => { errors.push(err); });

      anyClient._onGrpcConfigChanged({ dataId: 'p24-async', group: 'fo-group', tenant: '' });
      await flush();
      // async listener 返回的 rejected promise 不会被 try/catch 捕获，必须经 thenable 分支路由到 throwError；
      // 后续 listener 仍同步收到内容
      assert(received.indexOf('async-pushed') >= 0);
      assert(errors.some(e => e.message === 'async-push-boom'));
    });

    describe('KMS cipher snapshot pairing (gRPC)', () => {
      // ---- KMS cipher：content 快照与 EDK 快照的并发成对性（共享快照锁保证）----
      // 正确性由 #154 的 readConfigWithFailover 共享 withSnapshotLock 提供，KMS 的 EDK
      // 双写/双删纳入同一临界区。用一次性阻断“首个 EDK 写入”制造交叉窗口作为回归保护。

      it('KMS: concurrent same-key reads keep the content/EDK snapshot pair matched (never crossed)', async () => {
        const client = createGrpcClient();
        const dataId = 'cipher-kms-aes-128-pair-grpc';
        const group = 'fo-group';
        const contentKey = (client as any)._getSnapshotKey(dataId, group);
        const edkKey = (client as any)._getEncryptedDataKeySnapshotKey(dataId, group);
        const store = new Map<string, string>();
        const edkGate = deferred<void>();
        let edkSaves = 0;
        mm((client as any).snapshot, 'get', async (key: string) => (store.has(key) ? store.get(key) : null));
        mm((client as any).snapshot, 'getFailover', async () => null);
        mm((client as any).snapshot, 'getFailoverMtime', async () => null);
        mm((client as any).snapshot, 'delete', async (key: string) => { store.delete(key); });
        mm((client as any).snapshot, 'save', async (key: string, value: string) => {
          // 阻塞第一个 EDK 写入，若无锁则第二个读会在此窗口写入并造成错配
          if (key === edkKey) { edkSaves++; if (edkSaves === 1) { await edkGate.promise; } }
          if (!value) { store.delete(key); } else { store.set(key, value); }
        });
        // 两对自洽的（content, encryptedDataKey）：v1 配 edk-1，v2 配 edk-2
        let call = 0;
        mm((client as any)._grpcConfigProxy, 'getConfig', async () => {
          call++;
          if (call === 1) { return { content: 'cipher-v1', encryptedDataKey: 'edk-1' }; }
          return { content: 'cipher-v2', encryptedDataKey: 'edk-2' };
        });

        const a = (client as any)._getConfigWithCache(dataId, group);
        await flush();
        const b = (client as any)._getConfigWithCache(dataId, group);
        await flush();
        edkGate.resolve();
        await Promise.all([ a, b ]);
        await flush();

        const finalContent = store.get(contentKey);
        const finalEdk = store.get(edkKey);
        // 落盘的 content 与 edk 必须成对：要么 (v1, edk-1)，要么 (v2, edk-2)，绝不错配
        const matched = (finalContent === 'cipher-v1' && finalEdk === 'edk-1') ||
                        (finalContent === 'cipher-v2' && finalEdk === 'edk-2');
        assert(matched === true);
      });

      it('KMS: concurrent get and remove leave neither content nor EDK snapshot', async () => {
        const client = createGrpcClient();
        const dataId = 'cipher-kms-aes-128-rmpair-grpc';
        const group = 'fo-group';
        const contentKey = (client as any)._getSnapshotKey(dataId, group);
        const edkKey = (client as any)._getEncryptedDataKeySnapshotKey(dataId, group);
        const store = new Map<string, string>();
        // 预置一对旧快照；get 在途、remove 先完成后，二者都不应残留或被复活
        store.set(contentKey, 'old-cipher');
        store.set(edkKey, 'old-edk');
        mm((client as any).snapshot, 'get', async (key: string) => (store.has(key) ? store.get(key) : null));
        mm((client as any).snapshot, 'getFailover', async () => null);
        mm((client as any).snapshot, 'getFailoverMtime', async () => null);
        mm((client as any).snapshot, 'save', async (key: string, value: string) => { if (!value) { store.delete(key); } else { store.set(key, value); } });
        mm((client as any).snapshot, 'delete', async (key: string) => { store.delete(key); });
        const fetchGate = deferred<void>();
        mm((client as any)._grpcConfigProxy, 'getConfig', async () => {
          await fetchGate.promise;
          return { content: 'new-cipher', encryptedDataKey: 'new-edk' };
        });
        mm((client as any)._grpcConfigProxy, 'remove', async () => true);

        const getP = (client as any)._getConfigWithCache(dataId, group);
        await flush();
        const removeP = client.remove(dataId, group);
        await flush();
        fetchGate.resolve();
        await Promise.all([ getP, removeP ]);
        await flush();

        assert(store.has(contentKey) === false, 'content snapshot must not survive remove');
        assert(store.has(edkKey) === false, 'EDK snapshot must not survive remove');
      });
    });
  });

  describe('gRPC typed business responses (real GrpcConfigProxy)', () => {
    const { GrpcConfigProxy } = require('../src/grpc_config_proxy');
    const noopLogger = { info() {}, error() {}, warn() {}, debug() {} };

    function makeProxy(responder: (req: any, type: string) => any) {
      const transport = {
        registerServerPushHandler() {},
        removeServerPushHandler() {},
        onReconnect() {},
        request: async (req: any, type: string) => responder(req, type),
      };
      return new GrpcConfigProxy({ transportClient: transport, namespace: 'public', logger: noopLogger });
    }

    it('P2-2: returns content on resultCode 200 (empty string allowed)', async () => {
      const empty = makeProxy(() => ({ resultCode: 200, content: '' }));
      assert((await empty.getConfig('d', 'g')).content === '');
      const some = makeProxy(() => ({ resultCode: 200, content: 'hello' }));
      assert((await some.getConfig('d', 'g')).content === 'hello');
    });

    it('P2-2: returns null on errorCode 300 (config not found)', async () => {
      const proxy = makeProxy(() => ({ resultCode: 500, errorCode: 300, message: 'config data not exist' }));
      const ret = await proxy.getConfig('d', 'g');
      assert(ret.content === null);
    });

    it('P2-2: throws with diagnostic fields on 400 conflict', async () => {
      const proxy = makeProxy(() => ({ resultCode: 400, errorCode: 400, message: 'config conflict' }));
      let err: any;
      try { await proxy.getConfig('d', 'g'); } catch (e) { err = e; }
      assert(err);
      assert(err.resultCode === 400);
      assert(err.errorCode === 400);
      assert(/conflict/.test(err.message));
    });

    it('P2-2: throws with diagnostic fields on 500 internal', async () => {
      const proxy = makeProxy(() => ({ resultCode: 500, errorCode: 500, message: 'internal server error' }));
      let err: any;
      try { await proxy.getConfig('d', 'g'); } catch (e) { err = e; }
      assert(err);
      assert(err.resultCode === 500);
      assert(err.errorCode === 500);
      assert(/internal/.test(err.message));
    });
  });

  describe('get/remove interleave (shared snapshot lock)', () => {

    it('HTTP: in-flight get finishing after remove must not resurrect snapshot', async () => {
      const client = createClient();
      const store = memSnapshot(client);
      const encodedKey = (client as any).getSnapshotKeyEncoded('io-data-id', 'fo-group');
      const fetchGate = deferred<string>();
      mm(client.httpAgent, 'request', async (_path: string, options: any) => {
        if (options && options.method === 'DELETE') { return 'true'; }
        return await fetchGate.promise;
      });

      const getP = client.getConfig('io-data-id', 'fo-group');
      await flush();
      const removeP = client.remove('io-data-id', 'fo-group');
      await flush();
      fetchGate.resolve('server-config');
      await Promise.all([ getP, removeP ]);
      await flush();
      assert(store.has(encodedKey) === false);
    });
  });

  describe('KeyedAsyncQueue', () => {

    it('should run same-key tasks FIFO and serially', async () => {
      const q = new KeyedAsyncQueue();
      const order: number[] = [];
      const d1 = deferred<void>();
      const p1 = q.run('k', async () => { order.push(1); await d1.promise; order.push(11); });
      const p2 = q.run('k', async () => { order.push(2); });
      // p1 尚未结算，p2 不得开始
      await flush();
      assert.deepStrictEqual(order, [ 1 ]);
      d1.resolve();
      await Promise.all([ p1, p2 ]);
      assert.deepStrictEqual(order, [ 1, 11, 2 ]);
    });

    it('should run different-key tasks in parallel', async () => {
      const q = new KeyedAsyncQueue();
      const order: string[] = [];
      const dA = deferred<void>();
      const pA = q.run('a', async () => { order.push('a-start'); await dA.promise; order.push('a-end'); });
      const pB = q.run('b', async () => { order.push('b'); });
      // key b 不必等待 key a
      await pB;
      assert(order.indexOf('b') >= 0);
      assert(order.indexOf('a-end') < 0);
      dA.resolve();
      await pA;
      assert(order.indexOf('a-end') >= 0);
    });

    it('should not let a failed task block subsequent same-key tasks', async () => {
      const q = new KeyedAsyncQueue();
      const order: number[] = [];
      const p1 = q.run('k', async () => { order.push(1); throw new Error('boom'); });
      const p2 = q.run('k', async () => { order.push(2); return 'ok'; });
      let err: any;
      try { await p1; } catch (e) { err = e; }
      assert(err && err.message === 'boom');
      assert(await p2 === 'ok');
      assert.deepStrictEqual(order, [ 1, 2 ]);
    });

    it('should clean up the map entry after a key drains', async () => {
      const q = new KeyedAsyncQueue();
      assert(q.size === 0);
      await q.run('k', async () => 'done');
      await flush();
      assert(q.size === 0);
    });
  });
});
