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
import * as fs from 'fs';
import * as path from 'path';
import { HttpAgent } from '../src/http_agent';
import { createDefaultConfiguration } from './utils';
import * as mm from 'mm';
import * as assert from 'assert';

const pedding = require('pedding');
const httpclient = require('urllib');
const { rimraf, sleep } = require('mz-modules');
const cacheDir = path.join(__dirname, '.cache');

function getClient(configuration) {
  return new ClientWorker({
    configuration
  });
}

describe('test/client_worker.test.ts', () => {

  describe('test features in direct mode', () => {

    const defaultOptions = {
      serverAddr: '127.0.0.1:8848',
      namespace: '',
      cacheDir
    };

    const configuration = createDefaultConfiguration(defaultOptions);
    const snapshot = new Snapshot({ configuration });
    const serverMgr = new ServerListManager({ configuration });
    const httpAgent = new HttpAgent({ configuration });
    configuration.merge({
      snapshot,
      serverMgr,
      httpAgent,
    });

    let client: ClientWorker;

    beforeAll(async () => {
      client = getClient(configuration);
      await client.publishSingle('com.taobao.hsf.redis', 'DEFAULT_GROUP', '10.123.32.1:8080');
      await sleep(1000);
      await client.ready();
    });
    afterEach(mm.restore);

    afterAll(async () => {
      client.close();
      await client.remove('com.taobao.hsf.redis', 'DEFAULT_GROUP');
      await client.remove('test-dataId-encoding', 'test-group');
      await rimraf(cacheDir);
    });

    it('should subscribe mutli times ok', async () => {
      const reg = {
        dataId: 'com.taobao.hsf.redis',
        group: 'DEFAULT_GROUP',
      };

      client.subscribe(reg, val => {
        client.emit('redis_address_1', val);
      });
      let val = await client.await('redis_address_1');
      assert(val && /^\d+\.\d+\.\d+\.\d+\:\d+$/.test(val));

      client.subscribe(reg, val => {
        client.emit('redis_address_2', val);
      });
      val = await client.await('redis_address_2');
      assert(val && /^\d+\.\d+\.\d+\.\d+\:\d+$/.test(val));
      client.unSubscribe(reg);
    });

    it('should getConfig from nacos server', async () => {
      const content = await client.getConfig('com.taobao.hsf.redis', 'DEFAULT_GROUP');
      assert(/^\d+\.\d+\.\d+\.\d+\:\d+$/.test(content));
    });

    it('should not emit duplicate', async () => {
      let count = 0;
      const client = getClient(configuration);
      await client.ready();
      client.subscribe({ dataId: 'com.ali.unit.routerule', group: 'DEFAULT_GROUP' }, () => count++);
      client.subscribe({ dataId: 'com.ali.unit.forbiddenuserrule', group: 'DEFAULT_GROUP' }, () => count++);
      client.subscribe({ dataId: 'com.ali.unit.apprule', group: 'DEFAULT_GROUP' }, () => count++);
      client.subscribe({ dataId: 'tangram_page_publish', group: 'tangram' }, () => count++);
      await sleep(5000);
      assert(count === 4);
      client.close();
    });

    it('should ready', done => {
      done = pedding(3, done);
      client.ready(done);
      client.ready(done);
      client.ready(() => {
        client.ready(done);
      });
    });

    it('should subscribe a not exists config', done => {
      client.subscribe({
        dataId: 'config-not-exists',
        group: 'DEFAULT_GROUP',
      }, content => {
        assert(!content);
        client.unSubscribe({
          dataId: 'config-not-exists',
          group: 'DEFAULT_GROUP',
        });
        done();
      });
    });

    it('should getConfig from nacos server before init', async () => {
      const client = getClient(configuration);
      await client.publishSingle('com.taobao.hsf.redis', 'testGroup', '10.123.32.1:8080');
      await sleep(1000);
      const content = await client.getConfig('com.taobao.hsf.redis', 'testGroup');
      assert(/^\d+\.\d+\.\d+\.\d+\:\d+$/.test(content));
      await client.remove('com.taobao.hsf.redis', 'testGroup');
      client.close();
    });

    it('should publishSingle ok', async () => {
      let isSuccess = await client.publishSingle('test-dataId', 'test-group', 'test-content');
      assert(isSuccess);

      let content = await client.getConfig('test-dataId', 'test-group');
      assert(content === 'test-content');

      isSuccess = await client.publishSingle('test-dataId-unicode', 'test-group', 'tj');
      assert(isSuccess);

      content = await client.getConfig('test-dataId-unicode', 'test-group');
      assert(content === 'tj');
    });

    it('should test publish encoding content', async () => {
      await client.publishSingle('test-dataId-encoding', 'test-group', '你好');
      let data = '';

      client.subscribe({
        dataId: 'test-dataId-encoding',
        group: 'test-group',
      }, (content) => {
        data = content;
      });

      await sleep(1000);
      await client.publishSingle('test-dataId-encoding', 'test-group', '你好啊');
      await sleep(30000);
      assert(data === '你好啊');
    });

    it('should remove config from nacos server', async () => {
      const dataId = 'test-dataId2-' + process.pid + '-' + Date.now();
      let isSuccess = await client.publishSingle(dataId, 'test-group', 'test-content');
      assert(isSuccess === true);

      await sleep(2000);
      let content = await client.getConfig(dataId, 'test-group');
      assert(content === 'test-content');
      isSuccess = await client.remove(dataId, 'test-group');
      assert(isSuccess === true);

      await sleep(1000);
      content = await client.getConfig('test-dataId2', 'test-group');
      assert(content == null);
    });

  });

  describe('test features in find address mode', () => {

    const defaultOptions = {
      appName: 'test',
      endpoint: 'acm.aliyun.com',
      namespace: '81597370-5076-4216-9df5-538a2b55bac3',
      accessKey: '4c796a4dcd0d4f5895d4ba83a296b489',
      secretKey: 'UjLemP8inirhjMg1NZyY0faOk1E=',
      httpclient,
      ssl: false
    };

    const configuration = createDefaultConfiguration(defaultOptions);
    const snapshot = new Snapshot({ configuration });
    const serverMgr = new ServerListManager({ configuration });
    const httpAgent = new HttpAgent({ configuration });
    configuration.merge({
      snapshot,
      serverMgr,
      httpAgent,
    });

    let client: ClientWorker;
    beforeAll(async () => {
      client = getClient(configuration);
      await client.publishSingle('com.taobao.hsf.redis', 'DEFAULT_GROUP', '10.123.32.1:8080');
      await sleep(1000);
      await client.ready();
    });
    afterEach(mm.restore);

    afterAll(async () => {
      client.close();
      await client.remove('com.taobao.hsf.redis', 'DEFAULT_GROUP');
      await rimraf(cacheDir);
    });

    it('should getConfig from nacos server', async () => {
      const content = await client.getConfig('com.taobao.hsf.redis', 'DEFAULT_GROUP');
      assert(/^\d+\.\d+\.\d+\.\d+\:\d+$/.test(content));
    });

    it('should subscribe a not exists config', done => {
      client.subscribe({
        dataId: 'config-not-exists',
        group: 'DEFAULT_GROUP',
      }, content => {
        assert(!content);
        client.unSubscribe({
          dataId: 'config-not-exists',
          group: 'DEFAULT_GROUP',
        });
        done();
      });
    });

    it('should getConfig from nacos server before init', async () => {
      const client = getClient(configuration);
      await client.publishSingle('com.taobao.hsf.redis', 'testGroup', '10.123.32.1:8080');
      await sleep(1000);
      const content = await client.getConfig('com.taobao.hsf.redis', 'testGroup');
      assert(/^\d+\.\d+\.\d+\.\d+\:\d+$/.test(content));
      await client.remove('com.taobao.hsf.redis', 'testGroup');
      client.close();
    });

    it('should publishSingle ok', async () => {
      let isSuccess = await client.publishSingle('test-dataId', 'test-group', 'test-content');
      assert(isSuccess);

      let content = await client.getConfig('test-dataId', 'test-group');
      assert(content === 'test-content');

      isSuccess = await client.publishSingle('test-dataId-unicode', 'test-group', 'tj');
      assert(isSuccess);

      content = await client.getConfig('test-dataId-unicode', 'test-group');
      assert(content === 'tj');
    });

    it('should remove config from nacos server', async () => {
      const dataId = 'test-dataId2-' + process.pid + '-' + Date.now();
      let isSuccess = await client.publishSingle(dataId, 'test-group', 'test-content');
      assert(isSuccess === true);

      await sleep(2000);
      let content = await client.getConfig(dataId, 'test-group');
      assert(content === 'test-content');
      isSuccess = await client.remove(dataId, 'test-group');
      assert(isSuccess === true);

      await sleep(1000);
      content = await client.getConfig('test-dataId2', 'test-group');
      assert(content == null);
    });

    xit('should publishAggr & removeAggr ok', async () => {
      let isSuccess = await client.publishAggr('NS_DIAMOND_SUBSCRIPTION_TOPIC_chenwztest', 'DEFAULT_GROUP', 'somebody-pub-test', 'xx xx');
      assert(isSuccess === true);
      await sleep(1000);
      let content = await client.getConfig('NS_DIAMOND_SUBSCRIPTION_TOPIC_chenwztest', 'DEFAULT_GROUP');
      assert(content === 'xx xx');

      isSuccess = await client.removeAggr('NS_DIAMOND_SUBSCRIPTION_TOPIC_chenwztest', 'DEFAULT_GROUP', 'somebody-pub-test2');
      assert(isSuccess === true);

      isSuccess = await client.publishAggr('NS_DIAMOND_SUBSCRIPTION_TOPIC_unicode', 'DEFAULT_GROUP', 'somebody-pub-test', '宗羽');
      assert(isSuccess === true);
      content = await client.getConfig('NS_DIAMOND_SUBSCRIPTION_TOPIC_unicode', 'DEFAULT_GROUP');
      assert(content === '宗羽');
    });

    xit('should batchGetConfig and save snapshot ok', async () => {
      let isSuccess = await client.publishSingle('test-dataId3', 'test-group', 'test-content');
      assert(isSuccess === true);

      isSuccess = await client.publishSingle('test-dataId4', 'test-group', 'test-content');
      assert(isSuccess === true);

      const content = await client.batchGetConfig([ 'test-dataId3', 'test-dataId4' ], 'test-group');
      assert(content && content.length === 2);
      assert(content[ 0 ].dataId === 'test-dataId3');
      assert(content[ 0 ].content === 'test-content');
      assert(content[ 1 ].dataId === 'test-dataId4');
      assert(content[ 1 ].content === 'test-content');

      const cacheDir = client.snapshot.cacheDir;
      content.forEach(config => {
        const file = path.join(cacheDir, 'snapshot', 'config', 'CURRENT_UNIT', defaultOptions.namespace, config.group, config.dataId);
        assert(fs.readFileSync(file, 'utf8') === config.content);
      });
    });

    xit('should batchQuery ok', async () => {
      const content = await client.batchQuery([ 'test-dataId3', 'test-dataId4' ], 'test-group');
      assert(content && content.length === 2);
      assert(content[ 0 ].dataId === 'test-dataId3');
      assert(content[ 0 ].content === 'test-content');
      assert(content[ 1 ].dataId === 'test-dataId4');
      assert(content[ 1 ].content === 'test-content');
    });

    describe('mock error', () => {
      beforeAll(async () => {
        client = getClient(configuration);
        await client.ready();
      });
      afterEach(mm.restore);

      afterAll(async () => {
        client.close();
        await rimraf(cacheDir);
      });

      beforeEach(() => {
        client.clearSubscriptions();
      });

      it('should remove failed', async () => {
        mm.http.requestError(/^\//, null, 'mock res error');
        let error;
        try {
          await client.remove('intl-alipush-notify-subscribe-info', 'DEFAULT_GROUP');
          throw new Error('should never exec');
        } catch (err) {
          error = err;
        }
        assert(error);
        assert(/mock res error/.test(error.message));
      });

      xit('should get null when batchGetConfig failed', async () => {
        mm.http.requestError(/^\//, null, 'mock res error');
        let error;
        try {
          await client.batchGetConfig([ 'test-dataId3', 'test-dataId4' ], 'test-group');
          throw new Error('should never exec');
        } catch (err) {
          error = err;
        }
        assert(error);
        assert(/mock res error/.test(error.message));
      });

      it('should init failed', (done) => {
        mm.empty(snapshot, 'get');
        mm(serverMgr, 'serverListCache', new Map());
        mm(serverMgr, 'currentServerAddrMap', new Map());
        mm.http.request(/^\//, []);
        serverMgr.on('error', (error) => {
          assert(error && error.name === 'NacosServerHostEmptyError');
          assert(error.unit === 'CURRENT_UNIT');
          done();
        });
        client.getConfig('com.taobao.hsf.redis', 'HSF');
      });

      xit('should emit NacosBatchDeserializeError', async () => {
        mm.data(client, 'request', '{');
        let error;
        try {
          await client.batchGetConfig([ 'com.taobao.hsf.redis' ], 'HSF');
        } catch (err) {
          error = err;
        }
        assert(error && error.name === 'NacosBatchDeserializeError');
        assert(error.data === '{');
      });

      xit('should emit NacosBatchDeserializeError', async () => {
        mm.data(client, 'request', '{');
        let error;
        try {
          await client.batchQuery([ 'com.taobao.hsf.redis' ], 'HSF');
        } catch (err) {
          error = err;
        }
        assert(error && error.name === 'NacosBatchDeserializeError');
        assert(error.data === '{');
      });

      it('should emit NacosLongPullingError event', done => {
        mm.error(client, 'checkServerConfigInfo');
        mm.empty(client.snapshot, 'get');
        client.once('error', err => {
          assert(err.name === 'NacosLongPullingError');
          assert(err.message === 'mm mock error');
          client.unSubscribe({
            dataId: 'com.taobao.hsf.redis',
            group: 'HSF',
          });
          client.close();
          done();
        });
        client.subscribe({
          dataId: 'com.taobao.hsf.redis',
          group: 'HSF',
        }, content => console.log(content));
      });

      xit('should emit NacosSyncConfigError event', (done) => {
        // await client.updateCurrentServer();
        const _request = httpAgent.request.bind(httpAgent);
        mm(serverMgr, 'serverListCache', new Map());
        mm(serverMgr, 'currentServerAddrMap', new Map());
        mm.empty(client.snapshot, 'get');
        mm(httpAgent, 'request', async (path, options) => {
          if (options.method !== 'POST') {
            throw new Error('mm mock error');
          }
          return await _request(path, options);
        });

        done = pedding(done, 2);
        client.once('error', function (err) {
          assert(err.name === 'NacosSyncConfigError');
          assert(err.message.indexOf('mm mock error') >= 0);
          assert(err.dataId === 'com.taobao.hsf.redis');
          assert(err.group === 'HSF');
          mm.restore(); // 恢复后自动重试
          done();
        });
        client.subscribe({
          dataId: 'com.taobao.hsf.redis',
          group: 'HSF',
        }, () => {
          client.unSubscribe({
            dataId: 'com.taobao.hsf.redis',
            group: 'HSF',
          });
          done();
        });
      });

      it('should emit NacosConnectionTimeoutError syncConfigError event', done => {
        mm(httpAgent, 'requestTimeout', 1);
        client.once('error', function (err) {
          assert(err.name === 'NacosSyncConfigError');
          assert(err.dataId === 'com.taobao.hsf.redis2');
          client.unSubscribe({
            dataId: 'com.taobao.hsf.redis2',
            group: 'HSF',
          });
          assert(err.group === 'HSF');
          done();
        });
        client.subscribe({
          dataId: 'com.taobao.hsf.redis2',
          group: 'HSF',
        }, () => {
          throw new Error('should not run here');
        });
      });

      it('should throw error if http status is 409', async () => {
        mm.data(httpAgent.httpclient, 'request', { status: 409 });
        mm.empty(snapshot, 'get');
        let error;
        try {
          await client.getConfig('com.taobao.hsf.redis', 'HSF');
        } catch (err) {
          error = err;
        }
        assert(error && error.name === 'NacosServerConflictError');
      });
    });
  });
});
