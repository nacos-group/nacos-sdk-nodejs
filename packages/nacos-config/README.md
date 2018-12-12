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

## Contacts

* [@Harry Chen](https://github.com/czy88840616)
