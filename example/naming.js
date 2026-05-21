'use strict';

/**
 * Nacos Naming (Service Discovery) Example
 *
 * Prerequisites:
 *   - Nacos server running at 127.0.0.1:8848
 *
 * Usage:
 *   node naming.js
 */

const { NacosNamingClient } = require('nacos');
const sleep = require('mz-modules/sleep');

const logger = console;

async function main() {
  // Default transport is gRPC (recommended for Nacos 2.x/3.x).
  // For Nacos 2.x with HTTP, uncomment the transport line below.
  const client = new NacosNamingClient({
    logger,
    serverList: '127.0.0.1:8848',
    namespace: 'public',
    // transport: 'http',  // use HTTP API (Nacos 2.x only, removed in 3.x)
    // username: 'nacos',
    // password: 'nacos',
  });
  await client.ready();
  console.log('NacosNamingClient ready\n');

  const serviceName = 'example.nodejs.service';

  // 1. Subscribe — receive push notifications when instances change
  client.subscribe(serviceName, hosts => {
    console.log('[subscribe] instances changed:',
      hosts.map(h => `${h.ip}:${h.port} (healthy=${h.healthy})`));
  });

  // 2. Register instances
  await client.registerInstance(serviceName, { ip: '1.1.1.1', port: 8080 });
  await client.registerInstance(serviceName, { ip: '2.2.2.2', port: 8080 });
  console.log('Registered 2 instances');
  await sleep(3000);

  // 3. Query all instances
  const all = await client.getAllInstances(serviceName);
  console.log('All instances:', all.map(h => `${h.ip}:${h.port}`));

  // 4. Select healthy instances only
  const healthy = await client.selectInstances(serviceName);
  console.log('Healthy instances:', healthy.map(h => `${h.ip}:${h.port}`));

  // 5. Server status
  console.log('Server status:', await client.getServerStatus());

  // 6. Deregister
  await client.deregisterInstance(serviceName, { ip: '1.1.1.1', port: 8080 });
  console.log('Deregistered 1.1.1.1:8080');
  await sleep(3000);

  // Cleanup
  await client.deregisterInstance(serviceName, { ip: '2.2.2.2', port: 8080 });
  client.unSubscribe(serviceName);
  await client.close();
  console.log('Done');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
