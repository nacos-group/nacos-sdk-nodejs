# nacos-sdk-nodejs
=======

[![NPM version][npm-image]][npm-url]
[![build status][travis-image]][travis-url]
[![David deps][david-image]][david-url]

[npm-image]: https://img.shields.io/npm/v/ali-ons.svg?style=flat-square
[npm-url]: https://npmjs.org/package/ali-ons
[travis-image]: https://img.shields.io/travis/ali-sdk/ali-ons.svg?style=flat-square
[travis-url]: https://travis-ci.org/ali-sdk/ali-ons
[david-image]: https://img.shields.io/david/ali-sdk/ali-ons.svg?style=flat-square
[david-url]: https://david-dm.org/ali-sdk/ali-ons


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
  - info <Object>|<String> service info, if type is string, it's the serviceName
  - listener <Function> the listener function
- `unSubscribe(info, [listener])` Unsubscribe the instances of the service
  - info <Object>|<String> service info, if type is string, it's the serviceName
  - listener <Function> the listener function, if not provide, will unSubscribe all listeners under this service

## Questions & Suggestions

Please let us know how can we help. Do check out [issues](https://github.com/nacos-group/nacos-sdk-nodejs/issues) for bug reports or suggestions first.

PR is welcome.

## License

[Apache License V2](LICENSE)
