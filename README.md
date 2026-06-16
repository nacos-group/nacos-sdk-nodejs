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

## Aliyun RAM Authentication

Starting from version `2.6.3`, the SDK supports more Aliyun RAM identity configuration methods. All methods are finally resolved to `AccessKeyId`, `AccessKeySecret`, and optional `SecurityToken`, then the SDK generates the same Nacos authentication fields as before:

- Config client: `Spas-AccessKey`, `timeStamp`, `Spas-Signature`, and optional `Spas-SecurityToken`.
- Naming client: `signature`, `data`, `ak`, `app`, and optional `Spas-SecurityToken`.

Legacy AK/SK configuration is still supported and keeps the same behavior:

```js
const configClient = new NacosConfigClient({
  serverAddr: '127.0.0.1:8848',
  accessKey: 'AccessKeyId',
  secretKey: 'AccessKeySecret',
});

const namingClient = new NacosNamingClient({
  logger,
  serverList: '127.0.0.1:8848',
  ak: 'AccessKeyId',
  sk: 'AccessKeySecret',
  appName: 'appName',
});
```

Static STS credentials can be configured directly:

```js
const clientOptions = {
  serverAddr: '127.0.0.1:8848',
  alibabaCloudAccessKeyId: 'AccessKeyId',
  alibabaCloudAccessKeySecret: 'AccessKeySecret',
  alibabaCloudSecurityToken: 'SecurityToken',
};
```

You can also use environment variables:

```bash
export ALIBABA_CLOUD_ACCESS_KEY_ID=AccessKeyId
export ALIBABA_CLOUD_ACCESS_KEY_SECRET=AccessKeySecret
export ALIBABA_CLOUD_SECURITY_TOKEN=SecurityToken
```

Credentials URI can be used when credentials are provided by a local or remote HTTP endpoint. The endpoint should return JSON containing `AccessKeyId`, `AccessKeySecret`, optional `SecurityToken`, and optional `Expiration`.

```js
const clientOptions = {
  serverAddr: '127.0.0.1:8848',
  alibabaCloudCredentialsUri: 'http://127.0.0.1:8080/credentials',
};
```

Static security credentials JSON is supported with the Java client compatible key:

```js
const clientOptions = {
  serverAddr: '127.0.0.1:8848',
  securityCredentials: JSON.stringify({
    AccessKeyId: 'AccessKeyId',
    AccessKeySecret: 'AccessKeySecret',
    SecurityToken: 'SecurityToken',
  }),
};
```

Security credentials URL and ECS RAM role name are also supported:

```js
const clientOptions = {
  serverAddr: '127.0.0.1:8848',
  securityCredentialsUrl: 'http://127.0.0.1:8080/security-credentials',
  cacheSecurityCredentials: true,
  timeToRefreshInMillisecond: 3 * 60 * 1000,
};

const ecsRoleOptions = {
  serverAddr: '127.0.0.1:8848',
  ramRoleName: 'example-role-name',
};
```

Java-style property names are accepted as aliases:

```js
const clientOptions = {
  serverAddr: '127.0.0.1:8848',
  'security.credentials.url': 'http://127.0.0.1:8080/security-credentials',
  'ram.role.name': 'example-role-name',
  'cache.security.credentials': true,
  'time.to.refresh.in.millisecond': 3 * 60 * 1000,
};
```

For v4 signing, configure `signatureRegionId`. When this option is set, the SDK derives the v4 signing key and adds `signatureVersion: 'v4'`.

```js
const clientOptions = {
  serverAddr: '127.0.0.1:8848',
  accessKey: 'AccessKeyId',
  secretKey: 'AccessKeySecret',
  signatureRegionId: 'cn-hangzhou',
};
```

For RoleArn, OIDC/RRSA, KMS secret rotation, or other custom credential sources, provide `aliyunCredentialsProvider` or `alibabaCloudCredentialsProvider`. The provider is responsible for obtaining temporary credentials from Aliyun STS or another credential source. The SDK only consumes the returned three credential elements and then signs Nacos requests.

```js
const clientOptions = {
  serverAddr: '127.0.0.1:8848',
  aliyunCredentialsProvider: async () => {
    return {
      AccessKeyId: 'AccessKeyId',
      AccessKeySecret: 'AccessKeySecret',
      SecurityToken: 'SecurityToken',
    };
  },
};
```

RoleArn AssumeRole example:

```js
const clientOptions = {
  serverAddr: '127.0.0.1:8848',
  aliyunCredentialsProvider: createRoleArnProvider({
    accessKeyId: 'AccessKeyId',
    accessKeySecret: 'AccessKeySecret',
    securityToken: 'OptionalSecurityToken',
    roleArn: 'acs:ram::123456789012****:role/example-role',
    roleSessionName: 'nacos-nodejs-sdk',
    policy: '{"Version":"1","Statement":[]}',
    roleSessionExpiration: 3600,
  }),
};

function createRoleArnProvider(options) {
  let cachedCredentials;
  return async () => {
    if (cachedCredentials && Date.parse(cachedCredentials.Expiration) - Date.now() > 3 * 60 * 1000) {
      return cachedCredentials;
    }
    // Call Aliyun STS AssumeRole with options.roleArn, options.roleSessionName,
    // options.policy, options.roleSessionExpiration, and the source AK/SK.
    cachedCredentials = await assumeRoleByAliyunSdk(options);
    return {
      AccessKeyId: cachedCredentials.AccessKeyId,
      AccessKeySecret: cachedCredentials.AccessKeySecret,
      SecurityToken: cachedCredentials.SecurityToken,
      Expiration: cachedCredentials.Expiration,
    };
  };
}
```

OIDC/RRSA example:

```js
const clientOptions = {
  serverAddr: '127.0.0.1:8848',
  aliyunCredentialsProvider: createOidcRoleArnProvider({
    roleArn: process.env.ALIBABA_CLOUD_ROLE_ARN,
    roleSessionName: process.env.ALIBABA_CLOUD_ROLE_SESSION_NAME || 'nacos-nodejs-sdk',
    oidcProviderArn: process.env.ALIBABA_CLOUD_OIDC_PROVIDER_ARN,
    oidcTokenFile: process.env.ALIBABA_CLOUD_OIDC_TOKEN_FILE,
    policy: process.env.ALIBABA_CLOUD_POLICY,
    roleSessionExpiration: Number(process.env.ALIBABA_CLOUD_ROLE_SESSION_EXPIRATION || 3600),
  }),
};

function createOidcRoleArnProvider(options) {
  let cachedCredentials;
  return async () => {
    if (cachedCredentials && Date.parse(cachedCredentials.Expiration) - Date.now() > 3 * 60 * 1000) {
      return cachedCredentials;
    }
    // Read options.oidcTokenFile, then call Aliyun STS AssumeRoleWithOIDC
    // with options.roleArn, options.roleSessionName, options.oidcProviderArn,
    // options.policy, and options.roleSessionExpiration.
    cachedCredentials = await assumeRoleWithOidcByAliyunSdk(options);
    return {
      AccessKeyId: cachedCredentials.AccessKeyId,
      AccessKeySecret: cachedCredentials.AccessKeySecret,
      SecurityToken: cachedCredentials.SecurityToken,
      Expiration: cachedCredentials.Expiration,
    };
  };
}
```

## Questions & Suggestions

Please let us know how can we help. Do check out [issues](https://github.com/nacos-group/nacos-sdk-nodejs/issues) for bug reports or suggestions first.

PR is welcome.

nacos-sdk-nodejs ding group ： 44654232
![image](https://user-images.githubusercontent.com/17695352/172582005-c661e2a0-49fa-425c-bf99-785bb7cd4dc1.png)


## License

[Apache License V2](LICENSE)
