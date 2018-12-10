'use strict';

const NacosConfigClient = require('nacos').NacosConfigClient;

const configClient = new NacosConfigClient({
  endpoint: 'acm.aliyun.com',
  namespace: '81597370-5076-4216-9df5-538a2b55bac3',
  accessKey: '4c796a4dcd0d4f5895d4ba83a296b489',    // this accessKey just for testing and unstable，please put your key in application
  secretKey: 'UjLemP8inirhjMg1NZyY0faOk1E=',
  requestTimeout: 6000,
});

function sleep(time){
  return new Promise((resolve) => {
    setTimeout(() => {
      resolve();
    }, time);
  })
}

(async () => {
  await configClient.ready();

  const dataId = 'nacos.test.1';
  const group = 'DEFAULT_GROUP';
  const str = `example_test_${Math.random()}_${Date.now()}`;

  console.log('---------ready to publish------------');
  await configClient.publishSingle(dataId, group, str);
  await sleep(2000);
  console.log('---------publish complete------------');
  await sleep(2000);
  console.log('---------ready to getConfig----------');
  await sleep(2000);
  let content = await configClient.getConfig(dataId, group);
  console.log('---------getConfig complete----------');
  console.log('current content => ' + content);
  await sleep(2000);
  console.log('---------ready to remove config------');
  await configClient.remove(dataId, group);
  console.log('---------remove config complete------');
  await sleep(2000);
  content = await configClient.getConfig(dataId, group);
  console.log('---------getConfig complete----------');
  console.log('current content => ' + content);
  await sleep(2000);
  console.log('---------remove config success-------');
  configClient.close();
  process.exit(0);
})();
