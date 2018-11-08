const mm = require('mm');
const assert = require('assert');
const httpclient = require('urllib');
const {sleep} = require('mz-modules');
const co = require('co');
import { ACMClient } from '../src';

describe('test/index.test.ts', () => {
  let client: ACMClient;
  before(async () => {
    client = new ACMClient({
      endpoint: 'acm.aliyun.com',
      namespace: '81597370-5076-4216-9df5-538a2b55bac3',
      accessKey: '4c796a4dcd0d4f5895d4ba83a296b489',
      secretKey: 'UjLemP8inirhjMg1NZyY0faOk1E=',
      httpclient,
      ssl: false
    });
    await client.ready();
  });
  after(() => {
    client.close();
  });
  afterEach(mm.restore);

  it('should publishSingle and getConfig ok', async () => {
    const dataId = 'acm.test';
    const group = 'DEFAULT_GROUP';
    const str = `淘杰tj_test_${Math.random()}_${Date.now()}`;
    await client.publishSingle(dataId, group, str);
    await sleep(1000);
    const content = await client.getConfig(dataId, group);
    assert(content === str);
  });

  it('should subscribe ok', function (done) {
    const dataId = 'subscribe.test';
    const group = 'DEFAULT_GROUP';
    const str = `subscribe.test_${Math.random().toString(32)}_${Date.now()}`;

    client.subscribe({
      dataId,
      group,
    }, content => {
      if (content !== str) {
        co(async () => {
          await client.publishSingle(dataId, group, str);
        });
        return;
      }
      assert(content === str);
      done();
    });
  });

  it('should remove ok', async () => {
    const dataId = 'remove.test';
    const group = 'DEFAULT_GROUP';
    const str = `subscribe.test_${Math.random().toString(32)}_${Date.now()}`;
    await client.publishSingle(dataId, group, str);
    await sleep(1000);
    const content = await client.getConfig(dataId, group);
    assert(content === str);
    await client.remove(dataId, group);
    await sleep(1000);
    const temp = await client.getConfig(dataId, group);
    assert(temp == null);
  });

  it('should batchQuery ok', async () => {
    const dataIds = ['acm.test', 'json.data'];
    const group = 'DEFAULT_GROUP';
    const content = await client.batchQuery(dataIds, group);
    assert(content[0].dataId === dataIds[0]);
    assert(content[1].dataId === dataIds[1]);
  });

  it.skip('should getAllConfigInfo ok', async () => {
    const configs = await client.getAllConfigInfo();
    assert(configs.length);
  });
});
