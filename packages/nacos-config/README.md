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

## Contacts

* [@Harry Chen](https://github.com/czy88840616)
