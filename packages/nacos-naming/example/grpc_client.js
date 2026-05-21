const { GrpcConnection, GrpcTransportClient } = require('nacos-common');
const { GrpcNamingProxy } = require('../dist/naming/grpc_proxy');
const { Instance } = require('../dist/naming/instance');

async function main() {
  const conn = new GrpcConnection({
    serverList: ['127.0.0.1:8848'],
    namespace: 'public',
    logger: console,
    username: 'nacos',
    password: 'nacos',
    labels: { source: 'sdk', module: 'naming' },
  });

  await conn.connect();
  const tc = new GrpcTransportClient(conn);
  const proxy = new GrpcNamingProxy({
    transportClient: tc,
    namespace: 'public',
    logger: console,
  });

  const serviceName = 'demo.grpc.service';
  const instance = new Instance({ ip: '10.10.10.10', port: 8080 });

  await proxy.registerService(serviceName, 'DEFAULT_GROUP', instance);
  console.log('Instance registered. Check Nacos console now.');
  console.log('Press Ctrl+C to deregister and exit.');

  process.on('SIGINT', async () => {
    await proxy.deregisterService('DEFAULT_GROUP@@' + serviceName, instance);
    conn.close();
    console.log('Deregistered and disconnected.');
    process.exit(0);
  });
}

main().catch(e => { console.error(e); process.exit(1); });
