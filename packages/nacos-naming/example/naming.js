'use strict';

const { NacosNamingClient } = require('../dist/naming/client');
const sleep = require('mz-modules/sleep');

const logger = console;

async function main() {
  // gRPC is the default transport. Use transport: 'http' to fall back to HTTP.
  const client = new NacosNamingClient({
    logger,
    serverList: '127.0.0.1:8848',
    namespace: 'public',
    username: 'nacos',
    password: 'nacos',
  });
  await client.ready();
  console.log('NacosNamingClient ready (gRPC mode)');

  const serviceName = 'example.nodejs.service';

  // 1. Subscribe to service changes
  client.subscribe(serviceName, hosts => {
    console.log('[Subscribe] hosts changed:', hosts.map(h => `${h.ip}:${h.port}`));
  });

  // 2. Register instances
  await client.registerInstance(serviceName, { ip: '1.1.1.1', port: 8080 });
  await client.registerInstance(serviceName, { ip: '2.2.2.2', port: 8080 });
  console.log('Registered 2 instances');

  await sleep(3000);

  // 3. Query all instances
  const hosts = await client.getAllInstances(serviceName);
  console.log('All instances:', hosts.map(h => `${h.ip}:${h.port} healthy=${h.healthy}`));

  // 4. Select healthy instances only
  const healthy = await client.selectInstances(serviceName);
  console.log('Healthy instances:', healthy.map(h => `${h.ip}:${h.port}`));

  // 5. Check server status
  const status = await client.getServerStatus();
  console.log('Server status:', status);

  // 6. Deregister one instance
  await client.deregisterInstance(serviceName, { ip: '1.1.1.1', port: 8080 });
  console.log('Deregistered 1.1.1.1:8080');

  await sleep(3000);

  // 7. Cleanup
  await client.deregisterInstance(serviceName, { ip: '2.2.2.2', port: 8080 });
  client.unSubscribe(serviceName);
  await client.close();
  console.log('Done');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
