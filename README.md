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

// publish config with CAS (compare-and-set):
// succeeds only when the md5 of the current server-side config equals casMd5
const crypto = require('crypto');
const currentContent = await configClient.getConfig('test', 'DEFAULT_GROUP');
const casMd5 = crypto.createHash('md5').update(currentContent || '').digest('hex');
const published = await configClient.publishConfigCas('test', 'DEFAULT_GROUP', 'hello=nacos', casMd5);
console.log('cas publish:', published); // false when casMd5 mismatched

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
- `selectOneHealthyInstance(serviceName, [groupName], [clusters], [subscribe])` Select one healthy instance of service with weighted random load balancing (aligned with the Java SDK `NamingService#selectOneHealthyInstance`). Returns null when no healthy and enabled instance with a positive weight is available.
  - serviceName {String} Service name
  - [groupName] {String} group name, default is `DEFAULT_GROUP`
  - [clusters] {String} Cluster names
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
- `publishConfigCas(dataId, group, content, casMd5)` Publish config with CAS semantics, succeeds only when the md5 of the current server-side config equals `casMd5` (aligned with Java SDK `ConfigService#publishConfigCas`).
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

Alternatively, credentials can be pulled from an Aliyun KMS Secrets Manager secret: set `alibabaCloudSecretName` and supply a `secretManagerClient` — either a function `(secretName, options) => secret` or an object with a `getSecretValue(secretName)` method. The secret value is parsed as credentials and cached; when it carries no expiration, it is refreshed every `time.to.refresh.in.millisecond` (default 5 minutes).

```js
const clientOptions = {
  serverAddr: '127.0.0.1:8848',
  alibabaCloudSecretName: 'nacos-client-credentials',
  secretManagerClient: {
    async getSecretValue(name) {
      // e.g. backed by @alicloud/kms20160120 GetSecretValue, or the
      // Aliyun Secrets Manager cache client
      return { secretValue: '{"AccessKeyId":"...","AccessKeySecret":"..."}' };
    },
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

## Encrypted Configuration (Aliyun KMS)

`nacos-config` transparently encrypts and decrypts configurations whose dataId starts with the `cipher-` prefix, matching the wire format used by the Java / Go / Python SDKs (envelope encryption: the client obtains a data key from KMS, AES-encrypts the content with it, and ships the KMS-encrypted data key — `encryptedDataKey` — alongside the ciphertext over both HTTP and gRPC).

Supported dataId forms:

| dataId form | Encryption |
|---|---|
| `cipher-kms-aes-128-<dataId>` | Envelope encryption, KMS data key with `AES_128` spec |
| `cipher-kms-aes-256-<dataId>` | Envelope encryption, KMS data key with `AES_256` spec |
| `cipher-<dataId>` (no algorithm segment) | Direct KMS `Encrypt`/`Decrypt` of the whole value under the CMK |

> Only the KMS algorithms above are supported. A dataId whose second segment names another algorithm (e.g. `cipher-aes-...` backed by a Java encryption plugin) has no Node.js implementation and would be treated as the direct-KMS form — do not share such dataIds across SDKs.

The built-in client talks to the KMS public gateway through `@alicloud/kms20160120`, which is declared as an **optional dependency** and lazily required — installations without it (or users without `cipher-` dataIds) are unaffected. KMS credentials reuse the same Aliyun RAM options as request authentication (see [Aliyun RAM Authentication](#aliyun-ram-authentication)).

```js
const client = new NacosConfigClient({
  serverAddr: '127.0.0.1:8848',
  kmsRegionId: 'cn-hangzhou',   // resolves the KMS endpoint; or set kmsEndpoint directly
  // kmsKeyId: 'alias/acs/mse', // default CMK, aligned with the Java MSE client
});

// published encrypted, read back decrypted — no API differences
await client.publishSingle('cipher-kms-aes-256-app-secret', 'DEFAULT_GROUP', 'password=secret');
const plain = await client.getConfig('cipher-kms-aes-256-app-secret', 'DEFAULT_GROUP'); // 'password=secret'
client.subscribe({ dataId: 'cipher-kms-aes-256-app-secret', group: 'DEFAULT_GROUP' }, content => {
  // listeners always receive decrypted content
});
```

KMS-related client options:

| Option | Type | Default | Description |
|---|---|---|---|
| kmsRegionId | String | | Region used to resolve the KMS endpoint |
| kmsEndpoint | String | | KMS OpenAPI endpoint, e.g. `'kms.cn-hangzhou.aliyuncs.com'`; auto-resolved from `kmsRegionId` |
| kmsKeyId | String | `'alias/acs/mse'` | CMK used to generate data keys |
| kmsClient | Object | | Custom `IKmsClient` (`encrypt` / `generateDataKey` / `decrypt`, optional `describeKey` / `setDeletionProtection` / `close`); overrides the built-in gateway client |
| kmsClientFactory | Function | | `(configuration) => IKmsClient`, e.g. a ClientKey/DKMS adapter reading the `kmsClientKeyContent` / `kmsClientKeyFilePath` / `kmsPassword` / `kmsCaFileContent` / `kmsCaFilePath` passthrough options |
| kmsCacheEnabled | Boolean | `true` | In-memory data-key cache |
| kmsCacheMaxSize | Number | `1000` | Max cached data keys (FIFO eviction) |
| kmsCacheAfterAccessSeconds | Number | `3600` | Evict a data key this long after last access |
| kmsCacheAfterWriteSeconds | Number | `86400` | Evict a data key this long after it was cached |

Behavior notes (aligned with the Java MSE client):

- Caches, snapshots, md5 and long-poll/probe comparisons all operate on **ciphertext**; decryption happens only at user boundaries (`getConfig`, listeners, change notifications).
- Snapshots persist the ciphertext plus a parallel `edk/` entry holding the `encryptedDataKey`, so disaster recovery keeps working; both are removed together on `remove` / not-found.
- Failover files (`cacheDir/failover/...`) are user-maintained **plaintext** by contract and are never sent to KMS — they can be used as an emergency override for a `cipher-` dataId.
- Publishing a `cipher-` config schedules best-effort CMK **deletion protection** (deduplicated per key, never blocks or fails the publish).
- KMS calls carry per-request timeouts within an overall retry budget (3 attempts / ~3s by default), so a hung or throttling gateway cannot stall config operations.
- A decrypt failure at read time surfaces via the client `error` event instead of handing untrusted content to listeners.
- `close()` cascades to the cipher and releases an injected `kmsClient` (idempotent).

For a dedicated KMS instance (ClientKey/DKMS), inject an adapter — the SDK intentionally does not hard-depend on the DKMS SDK:

```js
const client = new NacosConfigClient({
  serverAddr: '127.0.0.1:8848',
  kmsClientFactory: configuration => createDkmsAdapter({
    clientKeyContent: configuration.get('kmsClientKeyContent'),
    password: configuration.get('kmsPassword'),
    caFileContent: configuration.get('kmsCaFileContent'),
    endpoint: configuration.get('kmsEndpoint'),
  }),
});
```

A runnable sample lives in [`example/kms-config.js`](./example/kms-config.js).

## Questions & Suggestions

Please let us know how can we help. Do check out [issues](https://github.com/nacos-group/nacos-sdk-nodejs/issues) for bug reports or suggestions first.

PR is welcome.

## License

[Apache License V2](LICENSE)
