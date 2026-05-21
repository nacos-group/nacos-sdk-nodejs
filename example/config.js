'use strict';

/**
 * Nacos Config Example
 *
 * Prerequisites:
 *   - Nacos server running at 127.0.0.1:8848
 *
 * Usage:
 *   node config.js
 */

const { NacosConfigClient } = require('nacos');
const sleep = require('mz-modules/sleep');

async function main() {
  // Default transport is gRPC (recommended for Nacos 2.x/3.x).
  // For Nacos 2.x with HTTP, uncomment the transport line below.
  const configClient = new NacosConfigClient({
    serverAddr: '127.0.0.1:8848',
    namespace: 'public',
    // transport: 'http',  // use HTTP API (Nacos 2.x only, removed in 3.x)
    // username: 'nacos',
    // password: 'nacos',
  });
  await configClient.ready();
  console.log('NacosConfigClient ready\n');

  const dataId = 'example.nodejs.config';
  const group = 'DEFAULT_GROUP';

  // 1. Publish config
  const content = `server.port=3000\nserver.host=0.0.0.0`;
  await configClient.publishSingle(dataId, group, content);
  console.log('Published config');
  await sleep(1000);

  // 2. Get config
  const value = await configClient.getConfig(dataId, group);
  console.log('Config content:', value);

  // 3. Subscribe to changes
  configClient.subscribe({ dataId, group }, (newContent) => {
    console.log('[subscribe] config changed:', newContent);
  });
  console.log('Subscribed to config changes');
  await sleep(1000);

  // 4. Update config — should trigger subscription callback
  await configClient.publishSingle(dataId, group, 'server.port=8080');
  console.log('Updated config, waiting for notification...');
  await sleep(5000);

  // 5. Remove config
  await configClient.remove(dataId, group);
  console.log('Removed config');
  await sleep(1000);

  // Cleanup
  configClient.close();
  console.log('Done');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
