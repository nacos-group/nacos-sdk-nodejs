import { Snapshot } from '../src/snapshot';
import { ServerListManager } from '../src/server_list_mgr';
import { DiamondEnv } from '../src/diamond_env';

const fs = require('fs');
const path = require('path');
const mm = require('mm');
const assert = require('assert');
const pedding = require('pedding');
const httpclient = require('urllib');
const {rimraf, sleep} = require('mz-modules');
const defaultOptions = {
  endpoint: 'acm.aliyun.com',
  namespace: '81597370-5076-4216-9df5-538a2b55bac3',
  accessKey: '4c796a4dcd0d4f5895d4ba83a296b489',
  secretKey: 'UjLemP8inirhjMg1NZyY0faOk1E=',
  httpclient,
  ssl: false
};

const cacheDir = path.join(__dirname, '.cache');
const snapshot = new Snapshot({cacheDir});
const serverMgr = new ServerListManager(Object.assign({httpclient, snapshot}, defaultOptions));

describe('test/diamond.test.ts', () => {
  let client: DiamondEnv;

  function getClient() {
    return new DiamondEnv(Object.assign({
      snapshot,
      serverMgr,
    }, defaultOptions));
  }

  before(async () => {
    client = getClient();
    await client.ready();
  });
  afterEach(mm.restore);

  after(async () => {
    client.close();
    await rimraf(cacheDir);
  });


  describe('require value before test', () => {

    before(async () => {
      await client.publishSingle('com.taobao.hsf.redis', 'HSF', '10.123.32.1:8080');
      await sleep(1000);
    });

    after(async () => {
      await client.remove('com.taobao.hsf.redis', 'HSF');
    });

    it('should subscribe mutli times ok', async () => {
      const reg = {
        dataId: 'com.taobao.hsf.redis',
        group: 'HSF',
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

    it('should getConfig from diamond server', async () => {
      const content = await client.getConfig('com.taobao.hsf.redis', 'HSF');
      assert(/^\d+\.\d+\.\d+\.\d+\:\d+$/.test(content));
    });

  });

  it('should not emit duplicate', async () => {
    let count = 0;
    const client = getClient();
    await client.ready();
    client.subscribe({dataId: 'com.ali.unit.routerule', group: 'DEFAULT_GROUP'}, () => count++);
    client.subscribe({dataId: 'com.ali.unit.forbiddenuserrule', group: 'DEFAULT_GROUP'}, () => count++);
    client.subscribe({dataId: 'com.ali.unit.apprule', group: 'DEFAULT_GROUP'}, () => count++);
    client.subscribe({dataId: 'tangram_page_publish', group: 'tangram'}, () => count++);
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

  it('should getConfig from diamond server before init', async () => {
    const client = getClient();
    await client.publishSingle('com.taobao.hsf.redis', 'HSF', '10.123.32.1:8080');
    await sleep(1000);
    const content = await client.getConfig('com.taobao.hsf.redis', 'HSF');
    assert(/^\d+\.\d+\.\d+\.\d+\:\d+$/.test(content));
    await client.remove('com.taobao.hsf.redis', 'HSF');
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

  it('should remove config from diamond server', async () => {
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

  it.skip('should publishAggr & removeAggr ok', async () => {
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

  it('should batchGetConfig and save snapshot ok', async () => {
    let isSuccess = await client.publishSingle('test-dataId3', 'test-group', 'test-content');
    assert(isSuccess === true);

    isSuccess = await client.publishSingle('test-dataId4', 'test-group', 'test-content');
    assert(isSuccess === true);

    const content = await client.batchGetConfig(['test-dataId3', 'test-dataId4'], 'test-group');
    assert(content && content.length === 2);
    assert(content[0].dataId === 'test-dataId3');
    assert(content[0].content === 'test-content');
    assert(content[1].dataId === 'test-dataId4');
    assert(content[1].content === 'test-content');

    const cacheDir = client.snapshot.cacheDir;
    content.forEach(config => {
      const file = path.join(cacheDir, 'snapshot', 'config', 'CURRENT_UNIT', defaultOptions.namespace, config.group, config.dataId);
      assert(fs.readFileSync(file, 'utf8') === config.content);
    });
  });

  it('should batchQuery ok', async () => {
    const content = await client.batchQuery(['test-dataId3', 'test-dataId4'], 'test-group');
    assert(content && content.length === 2);
    assert(content[0].dataId === 'test-dataId3');
    assert(content[0].content === 'test-content');
    assert(content[1].dataId === 'test-dataId4');
    assert(content[1].content === 'test-content');
  });

  describe('mock error', () => {
    beforeEach(() => {
      client._subscriptions = new Map();
    });

    it.skip('should switch to another server when request error', async () => {
      await client._updateCurrentServer();
      const ip = client._currentServer;

      mm.http.requestError(/^\//, null, 'mock res error');
      try {
        await client.getConfig('com.taobao.hsf.redis', 'HSF');
      } catch (err) {
        assert(/mock res error/.test(err.message));
      }
      assert(ip !== client._currentServer);
    });

    it.skip('should switch to another server when invalid response', async () => {
      await client._updateCurrentServer();
      const ip = client._currentServer;
      mm.http.request(/^\//, 'mock', {
        statusCode: 502,
      }, 100);
      try {
        await client.getConfig('com.taobao.hsf.redis', 'HSF');
      } catch (err) {
        assert(/Diamond Server Error Status: 520/.test(err.message));
      }
      assert(ip !== client._currentServer);
    });

    it('should remove failed', async () => {
      await client.updateCurrentServer();
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

    it('should get null when batchGetConfig failed', async () => {
      mm.http.requestError(/^\//, null, 'mock res error');
      let error;
      try {
        await client.batchGetConfig(['test-dataId3', 'test-dataId4'], 'test-group');
        throw new Error('should never exec');
      } catch (err) {
        error = err;
      }
      assert(error);
      assert(/mock res error/.test(error.message));
    });

    it('should init failed', async () => {
      mm.empty(serverMgr, 'getOne');
      mm.empty(snapshot, 'get');
      const client = new DiamondEnv(Object.assign({appName: 'test', httpclient, snapshot, serverMgr}, defaultOptions));
      let error;
      try {
        await client.getConfig('com.taobao.hsf.redis', 'HSF');
      } catch (err) {
        error = err;
      }
      assert(error && error.name === 'DiamondServerUnavailableError');
      assert(error.unit === 'CURRENT_UNIT');
    });

    it('should emit DiamondBatchDeserializeError', async () => {
      mm.data(client, 'request', '{');
      let error;
      try {
        await client.batchGetConfig(['com.taobao.hsf.redis'], 'HSF');
      } catch (err) {
        error = err;
      }
      assert(error && error.name === 'DiamondBatchDeserializeError');
      assert(error.data === '{');
    });

    it('should emit DiamondBatchDeserializeError', async () => {
      mm.data(client, 'request', '{');
      let error;
      try {
        await client.batchQuery(['com.taobao.hsf.redis'], 'HSF');
      } catch (err) {
        error = err;
      }
      assert(error && error.name === 'DiamondBatchDeserializeError');
      assert(error.data === '{');
    });

    it('should emit DiamondLongPullingError event', done => {
      const client = getClient();
      mm.error(client, 'checkServerConfigInfo');
      mm.empty(client.snapshot, 'get');
      client.once('error', err => {
        assert(err.name === 'DiamondLongPullingError');
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

    it('should emit DiamondSyncConfigError event', (done) => {
      const client = getClient();
      // await client.updateCurrentServer();
      const _request = client.request.bind(client);
      mm.empty(client.snapshot, 'get');
      mm(client, 'request', async (path, options) => {
        if (options.method !== 'POST') {
          throw new Error('mm mock error');
        }
        return await _request(path, options);
      });

      done = pedding(done, 2);
      client.once('error', function (err) {
        assert(err.name === 'DiamondSyncConfigError');
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

    it('should emit DiamondConnectionTimeoutError syncConfigError event', done => {
      mm(client.options, 'requestTimeout', 1);
      client.once('error', function (err) {
        assert(err.name === 'DiamondSyncConfigError');
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
      mm.data(client.httpclient, 'request', {status: 409});
      mm.empty(client.snapshot, 'get');
      let error;
      try {
        await client.getConfig('com.taobao.hsf.redis', 'HSF');
      } catch (err) {
        error = err;
      }
      assert(error && error.name === 'DiamondServerConflictError');
    });
  });
});
