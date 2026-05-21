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
});
