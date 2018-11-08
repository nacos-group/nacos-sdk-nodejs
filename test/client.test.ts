'use strict';
import { DataClient } from '../src/client';

const mm = require('mm');
const assert = require('assert');
const pedding = require('pedding');
const httpclient = require('urllib');
const { sleep } = require('mz-modules');

describe('test/client.test.ts', () => {
  let client;
  before(async () => {
    client = new DataClient({
      appName: 'test',
      endpoint: 'acm.aliyun.com',
      namespace: '81597370-5076-4216-9df5-538a2b55bac3',
      accessKey: '4c796a4dcd0d4f5895d4ba83a296b489',
      secretKey: 'UjLemP8inirhjMg1NZyY0faOk1E=',
      httpclient,
      ssl: false
    });
  });
  after(() => {
    client.close();
  });
  afterEach(mm.restore);

  it('should have proper properties', () => {
    assert(client.httpclient === httpclient);
    assert(client.appName);
    assert(!client.appKey);
    assert(client.snapshot);
    assert(client.serverMgr);
  });

  it('should listen error', done => {
    done = pedding(done, 2);
    client.on('error', err => {
      assert(err.message === 'mock error');
      done();
    });
    client.snapshot.emit('error', new Error('mock error'));
    client.serverMgr.emit('error', new Error('mock error'));
  });

  it('should remove config ok', async () => {
    await client.publishSingle('test-data-id', 'test-group', 'hello');
    await sleep(1000);
    let data = await client.getConfig('test-data-id', 'test-group');
    assert(data === 'hello');
    await client.remove('test-data-id', 'test-group');
    await sleep(1000);
    data = await client.getConfig('test-data-id', 'test-group');
    assert(!data);
  });

  it('should batchGetConfig ok', async () => {
    const ret = await client.batchGetConfig([ 'com.taobao.hsf.redis' ], 'HSF');
    assert(Array.isArray(ret) && ret.length > 0);
  });

  it('should batchQuery ok', async () => {
    const ret = await client.batchQuery([ 'com.taobao.hsf.redis' ], 'HSF');
    assert(Array.isArray(ret) && ret.length > 0);
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

  describe('invalid parameters', () => {
    it('should throw when subscribe with invalid dataId or group', () => {
      try {
        client.subscribe({
          dataId: 'xxx xxx',
        }, () => {
        });
      } catch (err) {
        assert(err.message.indexOf('only allow digital, letter and symbols in [ "_", "-", ".", ":" ]') > -1);
      }
      try {
        client.subscribe({
          dataId: 'dataId',
          group: 'DEFAULT GROUP',
        }, function () {
        });
        assert(false, 'should not run this!');
      } catch (err) {
        assert(err.message.indexOf('only allow digital, letter and symbols in [ "_", "-", ".", ":" ]') > -1);
      }
    });
  });

});
