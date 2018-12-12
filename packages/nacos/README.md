# nacos-sdk-nodejs

[![NPM version][npm-image]][npm-url]
[![build status][travis-image]][travis-url]
[![David deps][david-image]][david-url]
[![lerna](https://img.shields.io/badge/maintained%20with-lerna-cc00ff.svg)](https://lernajs.io/)

[npm-image]: https://img.shields.io/npm/v/nacos.svg?style=flat-square
[npm-url]: https://npmjs.org/package/nacos
[travis-image]: https://img.shields.io/travis/nacos-group/nacos-sdk-nodejs.svg?style=flat-square
[travis-url]: https://travis-ci.org/nacos-group/nacos-sdk-nodejs
[david-image]: https://img.shields.io/david/nacos-group/nacos-sdk-nodejs.svg?style=flat-square
[david-url]: https://david-dm.org/nacos-group/nacos-sdk-nodejs


[Nacos](https://nacos.io/en-us/) Node.js SDK

## Install

```bash
npm install nacos --save
```

## Usage

### Service Discovery

```js
'use strict';

const NacosNamingClient = require('nacos').NacosNamingClient;
const logger = console;

const client = new NacosNamingClient({
  logger,
  serverList: '127.0.0.1:8848', // replace to real nacos serverList
});
await client.ready();

const serviceName = 'nodejs.test.domain';

// registry instance
await client.registerInstance(serviceName, '1.1.1.1', 8080, 'NODEJS');
await client.registerInstance(serviceName, '2.2.2.2', 8080, 'NODEJS');

// subscribe instance
client.subscribe(serviceName, hosts => {
  console.log(hosts);
});

// deregister instance
await client.deregisterInstance(serviceName, '1.1.1.1', 8080, 'NODEJS');
```

### Config Service

```js
import {NacosConfigClient} from 'nacos';   // ts
const NacosConfigClient = require('nacos').NacosConfigClient; // js

// for find address mode
const configClient = new NacosConfigClient({
  endpoint: 'acm.aliyun.com',
  namespace: '***************',
  accessKey: '***************',
  secretKey: '***************',
  requestTimeout: 6000,
});

// for direct mode
const configClient = new NacosConfigClient({
  serverAddr: '127.0.0.1:8848',
});

// get config once
const content= await configClient.getConfig('test', 'DEFAULT_GROUP');
console.log('getConfig = ',content);

// listen data changed
configClient.subscribe({
  dataId: 'test',
  group: 'DEFAULT_GROUP',
}, content => {
  console.log(content);
});

// publish config
const content= await configClient.publishSingle('test', 'DEFAULT_GROUP', '测试');
console.log('getConfig = ',content);

// remove config
await configClient.remove('test', 'DEFAULT_GROUP');
```

NacosConfigClient options: [ClientOptions](https://github.com/nacos-group/nacos-sdk-nodejs/blob/master/packages/nacos-config/src/interface.ts#L247)

default value: [ClientOptions default value](https://github.com/nacos-group/nacos-sdk-nodejs/blob/master/packages/nacos-config/src/const.ts#L34)

## APIs

### Service Discovery

- `registerInstance(serviceName, ip, port, [cluster])`  Register an instance to service.
  - serviceName <String> Service name
  - ip <String> IP of instance
  - port <Number> Port of instance
  - cluster <String> Virtual cluster name
- `deregisterInstance(serviceName, ip, port, [cluster])`  Delete instance from service.
  - serviceName <String> Service name
  - ip <String> IP of instance
  - port <Number> Port of instance
  - cluster <String> Virtual cluster name
- `getAllInstances(serviceName, [clusters])`  Query instance list of service.
  - serviceName <String> Service name
  - clusters <Array> Cluster names
- `getServerStatus()` Get the status of nacos server, 'UP' or 'DOWN'.
- `subscribe(info, listener)` Subscribe the instances of the service
  - info <Object | String> service info, if type is string, it's the serviceName
  - listener <Function> the listener function
- unSubscribe(info, [listener]) Unsubscribe the instances of the service
  - info <Object | String> service info, if type is string, it's the serviceName
  - listener <Function> the listener function, if not provide, will unSubscribe all listeners under this service


### Config Service

- `async function getConfig(dataId, group)`
  - {String} dataId - data id
  - {String} group - group name
- `async function publishSingle(dataId, group, content)`
  - {String} dataId - data id
  - {String} group - group name
  - {String} content - content you want to publish
- `async function remove(dataId, group)`
  - {String} dataId - data id
  - {String} group - group name
- `function subscribe(info, listener)`
  - {Object} info
    - {String} dataId - data id
    - {String} group - group name
  - {Function} listener - callback handler
- `function unSubscribe(info, [listener])`
  - {Object} info
    - {String} dataId - data id
    - {String} group - group
  - {Function} listener - callback handler（optional，remove all listener when it is null）

## Questions & Suggestions

Please let us know how can we help. Do check out [issues](https://github.com/nacos-group/nacos-sdk-nodejs/issues) for bug reports or suggestions first.

PR is welcome.

## License

[Apache License V2](LICENSE)
