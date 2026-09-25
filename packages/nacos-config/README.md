# nacos-config

> Nacos config client for Node.js 客户端 https://help.aliyun.com/document_detail/60137.html

重新使用了 typescript 编码，使用 async/await 重构。

## Usage

```js
import {NacosConfigClient} from 'nacos';   // ts
const NacosConfigClient = require('nacos').NacosConfigClient; // js

// 下面的代码是寻址模式
const configClient = new NacosConfigClient({
  endpoint: 'acm.aliyun.com', // acm 控制台查看
  namespace: '***************', // acm 控制台查看
  accessKey: '***************', // acm 控制台查看
  secretKey: '***************', // acm 控制台查看
  requestTimeout: 6000, // 请求超时时间，默认6s
});

// 下面的代码是直连模式
const configClient = new NacosConfigClient({
  serverAddr: '127.0.0.1:8848', // 对端的 ip 和端口，其他参数同寻址模式
});

// 主动拉取配置
const content= await configClient.getConfig('test', 'DEFAULT_GROUP');
console.log('getConfig = ',content);

// 监听数据更新
configClient.subscribe({
  dataId: 'test',
  group: 'DEFAULT_GROUP',
}, content => {
  console.log(content);
});

// 发布配置接口
const content= await configClient.publishSingle('test', 'DEFAULT_GROUP', '测试');
console.log('getConfig = ',content);

// 删除配置
await configClient.remove('test', 'DEFAULT_GROUP');

### Error Events 异常处理

```js
configClient.on('error', function (err) {
  // 可以在这里统一进行日志的记录
  // 如果不监听错误事件，所有的异常都将会打印到 stderr
});
```

NacosConfigClient 的 options 定义见 [ClientOptions](https://github.com/nacos-group/nacos-sdk-nodejs/blob/master/packages/nacos-config/src/interface.ts#L247)

默认值见 [ClientOptions 默认值](https://github.com/nacos-group/nacos-sdk-nodejs/blob/6786534c023c9b5200960363ff6c541707f4d3bf/packages/nacos-config/src/const.ts#L34)

### API

#### 获取配置
* `async function getConfig(dataId, group)`
- {String} dataId - 配置id
- {String} group - 配置分组

#### 发布配置
* `async function publishSingle(dataId, group, content)`
- {String} dataId - 配置id
- {String} group - 配置分组
- {String} content - 发布内容

#### 删除配置
* `async function remove(dataId, group)`
- {String} dataId - 配置id
- {String} group - 配置分组

#### 订阅配置
* `function subscribe(info, listener)`
  - {Object} info
    - {String} dataId - 配置id
    - {String} group - 配置分组
  - {Function} listener - 回调函数

#### 取消订阅  
* `function unSubscribe(info, [listener])`
  - {Object} info
    - {String} dataId - 配置id
    - {String} group - 配置分组
  - {Function} listener - 回调函数（可选，不传就移除所有监听函数）

## 本地缓存与容灾 (Local Cache & Disaster Recovery)

配置读取内置本地缓存与容灾能力，行为对齐 Java SDK，HTTP 与 gRPC（默认传输，Nacos 3.x 唯一传输）两种模式一致生效。

**读取优先级**：本地容灾 (failover) > 服务端 > 本地快照 (snapshot)

- 服务端正常时返回服务端内容，并写入本地快照；
- 服务端异常时回退到最近的本地快照（若存在），同时上报 `error` 事件（见上文异常处理）；
- 存在容灾文件时直接返回容灾内容，不访问服务端。

### 本地快照 (snapshot)

- 每次成功从服务端读取后自动落盘；
- 配置被 `remove` 删除、或服务端返回空 / 不存在时，对应快照会被删除，避免故障回退时读到过期内容；
- 快照根目录由 `cacheDir` 选项决定，默认 `~/.node-diamond-client-cache`。

### 本地容灾 (failover)

用户可手工放置应急配置文件，优先级高于服务端，用于服务端不可用或需要强制覆盖时兜底。文件路径：

```text
<cacheDir>/failover/config/<unit>/<tenant>/<group>/<dataId>
```

其中 `tenant` 为 namespace（未设置时为 `default_tenant`），各路径段均做 URL 编码。

订阅期间 SDK 会自动探测容灾文件并热切换，无需重启：

- 新建 / 修改容灾文件 → 立即切换到容灾内容并通知监听器；
- 删除容灾文件 → 回退到服务端内容并通知监听器；
- 处于容灾模式时，服务端的变更推送会被忽略（容灾优先）。

> gRPC 模式下由后台定时器（默认每 10s）探测容灾文件；HTTP 模式下随长轮询探测。

对于 `cipher-` 加密配置：快照保存的是**密文**，并在平行的 `edk/` 条目中保存 `encryptedDataKey`（两者随配置删除一起清理）；容灾文件按约定是用户维护的**明文**，永远不会被送往 KMS 解密，可作为加密配置的应急覆盖手段。详见下文「配置加密 (KMS)」。

## 配置加密 (KMS)

dataId 以 `cipher-` 为前缀的配置会被透明加解密，线格式与 Java / Go / Python SDK 一致（信封加密：向 KMS 申请数据密钥，本地 AES/ECB/PKCS5Padding 加密内容，`encryptedDataKey` 随密文经 HTTP 或 gRPC 传输）。

支持三种 dataId 形态：

| dataId 形态 | 加密方式 |
|---|---|
| `cipher-kms-aes-128-<dataId>` | 信封加密，数据密钥 `AES_128` |
| `cipher-kms-aes-256-<dataId>` | 信封加密，数据密钥 `AES_256` |
| `cipher-<dataId>`（无算法段） | CMK 直接 Encrypt/Decrypt 整个配置值 |

> 仅支持上述 KMS 算法。第二段为其它算法名的 dataId（如 Java 加密插件的 `cipher-aes-...`）没有 Node.js 实现，会被当作直接 KMS 形态处理——请勿跨 SDK 共用此类 dataId。

内置客户端通过 `@alicloud/kms20160120`（**可选依赖**，懒加载，未安装/未使用 `cipher-` 配置时零开销）访问 KMS 公共网关；凭据复用 [Aliyun RAM 鉴权](../../README.md#aliyun-ram-authentication) 的全部方式。专有实例（ClientKey/DKMS）通过 `kmsClient` / `kmsClientFactory` 注入自定义适配器。

```js
const client = new NacosConfigClient({
  serverAddr: '127.0.0.1:8848',
  kmsRegionId: 'cn-hangzhou',
  // kmsKeyId: 'alias/acs/mse', // 默认 CMK，对齐 Java MSE 客户端
});

await client.publishSingle('cipher-kms-aes-256-app-secret', 'DEFAULT_GROUP', 'password=secret');
const plain = await client.getConfig('cipher-kms-aes-256-app-secret', 'DEFAULT_GROUP'); // 'password=secret'
```

主要选项：`kmsRegionId` / `kmsEndpoint` / `kmsKeyId`（默认 `alias/acs/mse`）、`kmsClient`、`kmsClientFactory`（配合 DKMS 透传选项 `kmsClientKeyContent` / `kmsClientKeyFilePath` / `kmsPassword` / `kmsCaFileContent` / `kmsCaFilePath`）、数据密钥缓存 `kmsCacheEnabled` / `kmsCacheMaxSize` / `kmsCacheAfterAccessSeconds` / `kmsCacheAfterWriteSeconds`。完整说明见根 [README](../../README.md#encrypted-configuration-aliyun-kms) 与示例 [example/kms-config.js](../../example/kms-config.js)。

行为要点（对齐 Java MSE 客户端）：

- 缓存 / 快照 / md5 / 长轮询比对全部基于**密文**，仅在用户边界（getConfig、监听回调、变更推送）解密；
- 发布 `cipher-` 配置会自动为 CMK 开启尽力而为的**删除保护**（按 keyId 去重，不阻塞、不失败发布）；
- KMS 调用带单请求超时与整体重试预算（默认 3 次 / 约 3s），网关挂起或限流不会拖死配置操作；
- 读取时解密失败通过客户端 `error` 事件上报，不会把不可信内容交给监听器；
- `close()` 会级联释放注入的 KMS 客户端（幂等）。

## Contacts

* [@Harry Chen](https://github.com/czy88840616)
