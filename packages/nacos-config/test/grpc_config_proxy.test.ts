import * as assert from 'assert';
import { GrpcConnection, GrpcTransportClient } from 'nacos-common';
import { GrpcConfigProxy } from '../src/grpc_config_proxy';

const { sleep } = require('mz-modules');
const logger = console;

describe('test/grpc_config_proxy.test.ts', () => {
  let connection: GrpcConnection;
  let transportClient: GrpcTransportClient;
  let proxy: GrpcConfigProxy;
  const dataId = 'nodejs.grpc.config.test';
  const group = 'DEFAULT_GROUP';

  before(async function() {
    this.timeout(10000);
    connection = new GrpcConnection({
      serverList: ['127.0.0.1:8848'],
      namespace: 'public',
      username: 'nacos',
      password: 'nacos',
      logger,
      labels: { source: 'sdk', module: 'config' },
    });
    await connection.connect();
    await sleep(500);
    transportClient = new GrpcTransportClient(connection);
    proxy = new GrpcConfigProxy({
      transportClient,
      namespace: 'public',
      logger,
    });
  });

  after(async function() {
    try {
      await proxy.remove(dataId, group);
    } catch (_) {}
    proxy.close();
    connection.close();
  });

  it('should publish and get config via gRPC', async function() {
    this.timeout(10000);

    const published = await proxy.publishSingle(dataId, group, 'public', 'grpc_test=hello');
    assert(published === true, 'publish should return true');

    await sleep(500);

    const content = await proxy.getConfig(dataId, group);
    assert(content === 'grpc_test=hello', `getConfig should return published content, got: ${content}`);
  });

  it('should update config via gRPC', async function() {
    this.timeout(10000);

    const updated = await proxy.publishSingle(dataId, group, 'public', 'grpc_test=updated');
    assert(updated === true);

    await sleep(500);

    const content = await proxy.getConfig(dataId, group);
    assert(content === 'grpc_test=updated', `getConfig should return updated content, got: ${content}`);
  });

  it('should remove config via gRPC', async function() {
    this.timeout(10000);

    const removed = await proxy.remove(dataId, group);
    assert(removed === true, 'remove should return true');

    await sleep(500);

    const content = await proxy.getConfig(dataId, group);
    assert(content === '', `getConfig after remove should return empty, got: ${content}`);
  });

  it('should listen for config changes via gRPC', async function() {
    this.timeout(30000);
    const listenDataId = 'nodejs.grpc.listen.test';

    // Publish initial config
    await proxy.publishSingle(listenDataId, group, 'public', 'initial=value');
    await sleep(500);

    // Get initial MD5
    const initial = await proxy.getConfig(listenDataId, group);
    assert(initial === 'initial=value');

    // Listen for changes
    const changes: any[] = [];
    proxy.on('configChanged', (evt: any) => {
      if (evt.dataId === listenDataId) {
        changes.push(evt);
      }
    });

    const crypto = require('crypto');
    const md5 = crypto.createHash('md5').update('initial=value').digest('hex');
    await proxy.addListener(listenDataId, group, md5);
    console.log('[TEST] listener added with md5:', md5);

    await sleep(1000);

    // Update config to trigger change notification
    await proxy.publishSingle(listenDataId, group, 'public', 'updated=value');
    console.log('[TEST] config updated, waiting for push...');

    await sleep(5000);

    console.log('[TEST] config changes received:', changes.length);
    assert(changes.length > 0, `Should receive at least 1 config change event, got: ${changes.length}`);
    assert(changes[0].dataId === listenDataId);

    // Cleanup
    await proxy.removeListener(listenDataId, group);
    await proxy.remove(listenDataId, group);
  });
});
