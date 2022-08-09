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

## Version Mapping

Node.js SDK \ Nacos Server | 0.x.0 | 1.0.0 |
---                        |  ---  |  ---  |
1.x                        |   √   |       |
2.x                        |       |   √   |

## Usage

### Service Discovery

```js
'use strict';

const NacosNamingClient = require('nacos').NacosNamingClient;
const logger = console;

const client = new NacosNamingClient({
  logger,
  serverList: '127.0.0.1:8848', // replace to real nacos serverList
  namespace: 'public',
});
await client.ready();

const serviceName = 'nodejs.test.domain';

// registry instance
await client.registerInstance(serviceName, {
  ip: '1.1.1.1',
  port: 8080,
});
await client.registerInstance(serviceName, {
  ip: '2.2.2.2',
  port: 8080,
});

// subscribe instance
client.subscribe(serviceName, hosts => {
  console.log(hosts);
});

// deregister instance
await client.deregisterInstance(serviceName, {
  ip: '1.1.1.1',
  port: 8080,
});
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

- `registerInstance(serviceName, instance, [groupName])`  Register an instance to service.
  - serviceName {String} Service name
  - instance {Instance}
    - ip {String} IP of instance
    - port {Number} Port of instance
    - [weight] {Number} weight of the instance, default is 1.0
    - [ephemeral] {Boolean} active until the client is alive, default is true
    - [clusterName] {String} Virtual cluster name
  - [groupName] {String} group name, default is `DEFAULT_GROUP`
- `deregisterInstance(serviceName, ip, port, [cluster])`  Delete instance from service.
  - serviceName {String} Service name
  - instance {Instance}
    - ip {String} IP of instance
    - port {Number} Port of instance
    - [weight] {Number} weight of the instance, default is 1.0
    - [ephemeral] {Boolean} active until the client is alive, default is true
    - [clusterName] {String} Virtual cluster name
  - [groupName] {String} group name, default is `DEFAULT_GROUP`
- `getAllInstances(serviceName, [groupName], [clusters], [subscribe])`  Query instance list of service.
  - serviceName {String} Service name
  - [groupName] {String} group name, default is `DEFAULT_GROUP`
  - [clusters] {String} Cluster names
  - [subscribe] {Boolean} whether subscribe the service, default is true
- `getServerStatus()` Get the status of nacos server, 'UP' or 'DOWN'.
- `subscribe(info, listener)` Subscribe the instances of the service
  - info {Object}|{String} service info, if type is string, it's the serviceName
  - listener {Function} the listener function
- `unSubscribe(info, [listener])` Unsubscribe the instances of the service
  - info {Object}|{String} service info, if type is string, it's the serviceName
  - listener {Function} the listener function, if not provide, will unSubscribe all listeners under this service

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

nacos-sdk-nodejs ding group ： 44654232
![image](https://user-images.githubusercontent.com/17695352/172582005-c661e2a0-49fa-425c-bf99-785bb7cd4dc1.png)


## License

[Apache License V2](LICENSE)
