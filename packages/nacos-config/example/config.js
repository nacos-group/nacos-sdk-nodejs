'use strict';

const { GrpcConnection, GrpcTransportClient } = require('nacos-common');
const { GrpcConfigProxy } = require('../dist/grpc_config_proxy');
const sleep = require('mz-modules/sleep');

const logger = console;

async function main() {
  // Create gRPC connection
  const connection = new GrpcConnection({
    serverList: ['127.0.0.1:8848'],
    namespace: 'public',
    username: 'nacos',
    password: 'nacos',
    logger,
    labels: { source: 'sdk', module: 'config' },
  });
  await connection.connect();

  const transportClient = new GrpcTransportClient(connection);
  const configProxy = new GrpcConfigProxy({
    transportClient,
    namespace: 'public',
    logger,
  });

  const dataId = 'example.nodejs.config';
  const group = 'DEFAULT_GROUP';

  // 1. Publish a config
  const published = await configProxy.publishSingle(dataId, group, 'public', 'server.port=3000\nserver.host=0.0.0.0');
  console.log('Published:', published);

  await sleep(500);

  // 2. Get config
  const content = await configProxy.getConfig(dataId, group);
  console.log('Config content:', content);

  // 3. Listen for changes
  configProxy.on('configChanged', async (evt) => {
    console.log('[Listen] config changed:', evt.dataId);
    const newContent = await configProxy.getConfig(evt.dataId, evt.group);
    console.log('[Listen] new content:', newContent);
  });

  const crypto = require('crypto');
  const md5 = crypto.createHash('md5').update(content).digest('hex');
  await configProxy.addListener(dataId, group, md5);
  console.log('Listener added, waiting for changes...');

  // 4. Update config to trigger notification
  await sleep(1000);
  await configProxy.publishSingle(dataId, group, 'public', 'server.port=8080\nserver.host=localhost');
  console.log('Config updated, waiting for push...');

  await sleep(3000);

  // 5. Cleanup
  await configProxy.removeListener(dataId, group);
  await configProxy.remove(dataId, group);
  configProxy.close();
  connection.close();
  console.log('Done');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
