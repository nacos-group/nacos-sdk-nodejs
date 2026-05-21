# nacos-sdk-nodejs

[![NPM version][npm-image]][npm-url]
[![lerna](https://img.shields.io/badge/maintained%20with-lerna-cc00ff.svg)](https://lernajs.io/)

[npm-image]: https://img.shields.io/npm/v/nacos.svg?style=flat-square
[npm-url]: https://npmjs.org/package/nacos

[Nacos](https://nacos.io/en-us/) Node.js SDK

## Install

```bash
npm install nacos --save
```

## Compatibility

| Node.js SDK | Nacos Server | Transport |
|---|---|---|
| 3.x | 3.x | gRPC (default) |
| 3.x | 2.x | gRPC (default) / HTTP (opt-in) |
| 2.x | 2.x / 1.x | HTTP |

> **Note:** Nacos 3.x has removed HTTP API support. When connecting to Nacos 3.x, gRPC is the only available transport.

## Usage

### Service Discovery

```js
const { NacosNamingClient } = require('nacos');

const client = new NacosNamingClient({
  logger: console,
  serverList: '127.0.0.1:8848',
  namespace: 'public',
  // transport: 'http',  // use HTTP API (Nacos 2.x only, removed in 3.x)
  // username: 'nacos',
  // password: 'nacos',
});
await client.ready();

const serviceName = 'nodejs.test.domain';

// register instance
await client.registerInstance(serviceName, {
  ip: '1.1.1.1',
  port: 8080,
});

// subscribe to instance changes (push notification)
client.subscribe(serviceName, hosts => {
  console.log(hosts);
});

// query all instances
const hosts = await client.getAllInstances(serviceName);
console.log(hosts);

// select healthy instances only
const healthy = await client.selectInstances(serviceName);
console.log(healthy);

// deregister instance
await client.deregisterInstance(serviceName, {
  ip: '1.1.1.1',
  port: 8080,
});
```

### Config Service

```js
const { NacosConfigClient } = require('nacos');

const configClient = new NacosConfigClient({
  serverAddr: '127.0.0.1:8848',
  namespace: 'public',
  // transport: 'http',  // use HTTP API (Nacos 2.x only, removed in 3.x)
  // username: 'nacos',
  // password: 'nacos',
});
await configClient.ready();

// publish config
await configClient.publishSingle('test', 'DEFAULT_GROUP', 'hello=world');

// get config
const content = await configClient.getConfig('test', 'DEFAULT_GROUP');
console.log('content:', content);

// subscribe to config changes (push notification)
configClient.subscribe({ dataId: 'test', group: 'DEFAULT_GROUP' }, content => {
  console.log('config changed:', content);
});

// remove config
await configClient.remove('test', 'DEFAULT_GROUP');
```

## Transport

The SDK supports two transport protocols:

| Transport | Protocol | Server Version | Description |
|---|---|---|---|
| `grpc` (default) | gRPC + Protobuf | Nacos 2.x / 3.x | Bidirectional streaming, server push, connection-based heartbeat |
| `http` | HTTP REST API | Nacos 2.x only | Long-polling, UDP push, explicit heartbeat |

gRPC advantages over HTTP:
- **Real-time push** — server pushes service/config changes instantly via bidirectional streaming
- **No UDP dependency** — service discovery push works without UDP port
- **Connection heartbeat** — no explicit beat API needed for ephemeral instances
- **Auto reconnect** — exponential backoff with automatic re-registration and re-subscription

## APIs

### Service Discovery

- `registerInstance(serviceName, instance, [groupName])` Register an instance to service.
  - serviceName {String} Service name
  - instance {Instance}
    - ip {String} IP of instance
    - port {Number} Port of instance
    - [weight] {Number} weight of the instance, default is 1.0
    - [ephemeral] {Boolean} active until the client is alive, default is true
    - [clusterName] {String} Virtual cluster name
    - [metadata] {Object} Metadata of instance
  - [groupName] {String} group name, default is `DEFAULT_GROUP`
- `deregisterInstance(serviceName, instance, [groupName])` Delete instance from service.
  - serviceName {String} Service name
  - instance {Instance}
    - ip {String} IP of instance
    - port {Number} Port of instance
  - [groupName] {String} group name, default is `DEFAULT_GROUP`
- `getAllInstances(serviceName, [groupName], [clusters], [subscribe])` Query instance list of service.
  - serviceName {String} Service name
  - [groupName] {String} group name, default is `DEFAULT_GROUP`
  - [clusters] {String} Cluster names
  - [subscribe] {Boolean} whether subscribe the service, default is true
- `selectInstances(serviceName, [groupName], [clusters], [healthy], [subscribe])` Select healthy instances of service.
  - serviceName {String} Service name
  - [groupName] {String} group name, default is `DEFAULT_GROUP`
  - [clusters] {String} Cluster names
  - [healthy] {Boolean} filter healthy instances, default is true
  - [subscribe] {Boolean} whether subscribe the service, default is true
- `getServerStatus()` Get the status of nacos server, 'UP' or 'DOWN'.
- `subscribe(info, listener)` Subscribe the instances of the service
  - info {Object|String} service info, if type is string, it's the serviceName
  - listener {Function} the listener function
- `unSubscribe(info, [listener])` Unsubscribe the instances of the service
  - info {Object|String} service info, if type is string, it's the serviceName
  - listener {Function} the listener function, if not provided, will unsubscribe all listeners

### Config Service

- `getConfig(dataId, group)` Get config content.
  - dataId {String} data id
  - group {String} group name
- `publishSingle(dataId, group, content)` Publish config.
  - dataId {String} data id
  - group {String} group name
  - content {String} content to publish
- `remove(dataId, group)` Remove config.
  - dataId {String} data id
  - group {String} group name
- `subscribe(info, listener)` Subscribe to config changes.
  - info {Object} `{ dataId, group }`
  - listener {Function} callback with new content
- `unSubscribe(info, [listener])` Unsubscribe from config changes.
  - info {Object} `{ dataId, group }`
  - listener {Function} optional, remove all listeners when null

### Client Options

#### NacosNamingClient

| Option | Type | Default | Description |
|---|---|---|---|
| logger | Object | *required* | Logger instance |
| serverList | String/String[] | *required* | Nacos server addresses, e.g. `'127.0.0.1:8848'` |
| namespace | String | `'public'` | Namespace ID |
| transport | String | `'grpc'` | Transport protocol: `'grpc'` or `'http'` |
| username | String | | Authentication username |
| password | String | | Authentication password |
| ssl | Boolean | `false` | Use TLS/SSL |

#### NacosConfigClient

| Option | Type | Default | Description |
|---|---|---|---|
| serverAddr | String/String[] | *required* | Nacos server addresses |
| namespace | String | `'public'` | Namespace ID |
| transport | String | `'grpc'` | Transport protocol: `'grpc'` or `'http'` |
| username | String | | Authentication username |
| password | String | | Authentication password |
| ssl | Boolean | `false` | Use TLS/SSL |

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

## License

[Apache License V2](LICENSE)
