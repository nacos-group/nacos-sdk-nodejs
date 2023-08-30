/**
 * Licensed to the Apache Software Foundation (ASF) under one or more
 * contributor license agreements.  See the NOTICE file distributed with
 * this work for additional information regarding copyright ownership.
 * The ASF licenses this file to You under the Apache License, Version 2.0
 * (the "License"); you may not use this file except in compliance with
 * the License.  You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
// import { EventEmitter } from 'events';

interface ListenFunc {
  (): void;
}

/**
 * @description The subscribe listener
 */
interface Subscriber {
  (content: any): void;
}


/**
 * @description common options
 */
export interface CommonInputOptions {
  dataId: string;
  group?: string;
  unit?: string;
}

export interface UnitOptions {
  unit: string;
}

/**
 * @description Diamond client interface
 */
export interface BaseClient extends IClientWorker {
  /**
   * @description 获取当前机器所在机房
   * @returns {Promise<string>} currentUnit
   */
  getCurrentUnit(): Promise<string>;

  /**
   * @description 获取所有单元信息
   */
  getAllUnits(): Promise<string[]>;

  /**
   * 将配置发布到所有单元
   * @param {String} dataId - id of the data
   * @param {String} group - group name of the data
   * @param {String} content - config value
   * @returns {Promise<boolean>} true | false
   */
  publishToAllUnit(dataId: string, group: string, content: string): Promise<boolean>;

  /**
   * @description 将配置从所有单元中删除
   * @param {String} dataId - id of the data
   * @param {String} group - group name of the data
   * @returns {Promise<boolean>} true | false
   */
  removeToAllUnit(dataId: string, group: string): Promise<boolean>;

}

/**
 * 每个 diamond 环境实例
 */
export interface IClientWorker {
  /**
   * @description 获取配置
   * @param {String} dataId - id of the data
   * @param {String} group - group name of the data
   * @param {Object} [options]
   *   - {String} unit - which unit you want to connect, default is current unit
   * @returns {Promise<string>} value
   */
  getConfig(dataId: string, group: string, options?: UnitOptions): Promise<string>;

  /**
   * @description 发布配置
   * @param {String} dataId - id of the data
   * @param {String} group - group name of the data
   * @param {String} content - config value
   * @param {Object} [options]
   *   - {String} unit - which unit you want to connect, default is current unit
   * @returns {Promise<boolean>} true | false
   */
  publishSingle(dataId: string, group: string, content: string, options?: UnitOptions): Promise<boolean>;

  /**
   * @description 删除配置
   * @param {String} dataId - id of the data
   * @param {String} group - group name of the data
   * @param {Object} [options]
   *   - {String} unit - which unit you want to connect, default is current unit
   * @return {Promise<boolean>} true | false
   */
  remove(dataId: string, group: string, options?: UnitOptions): Promise<boolean>;

  /**
   * @description 推送聚合数据
   * @param {String} dataId - id of the data
   * @param {String} group - group name of the data
   * @param {String} datumId - id of datum
   * @param {String} content
   * @param {Object} [options]
   *  - {String} unit
   * @returns {Promise<boolean>} true | false
   */
  publishAggr(dataId: string, group: string, datumId: string, content: string, options?: UnitOptions): Promise<boolean>;

  /**
   * @description 删除聚合数据
   * @param {String} dataId - id of the data
   * @param {String} group - group name of the data
   * @param {String} datumId - id of datum
   * @param {Object} [options]
   *  - {String} unit
   * @returns {Promise<boolean>} true | false
   */
  removeAggr(dataId: string, group: string, datumId: string, options?: UnitOptions): Promise<boolean>;

  /**
   * @description 批量获取配置
   * @param {Array} dataIds - data id array
   * @param {String} group - group name of the data
   * @param {Object} [options]
   *   - {String} unit - which unit you want to connect, default is current unit
   * @returns {Promise<object>} result
   */
  batchGetConfig(dataIds: string[], group: string, options?: UnitOptions): Promise<object>;

  /**
   * @description 批量查询
   * @param {Array} dataIds - data id array
   * @param {String} group - group name of the data
   * @param {Object} [options]
   *   - {String} unit - which unit you want to connect, default is current unit
   * @returns {Promise<object>} result
   */
  batchQuery(dataIds: string[], group: string, options?: UnitOptions): Promise<object>;

  /**
   * @description 订阅
   * @param {Object} reg
   *   - {String} dataId - id of the data you want to subscribe
   *   - {String} [group] - group name of the data
   *   - {String} [unit] - which unit you want to connect, default is current unit
   * @param {Function} listener - listener(content: string)
   * @returns {InstanceType} DiamondClient
   */
  subscribe(reg: CommonInputOptions, listener: Subscriber);

  /**
   * @description 取消订阅
   * @param {Object} reg
   *  - {String} dataId - id of the data you want to unsubscribe
   *  - {String} [group] - group name of the data
   *  - {String} [unit] - which unit you want to connect, default is current unit
   * @param {Function} [listener]
   *  - listener(content: string)
   * @returns {InstanceType} DiamondClient
   */
  unSubscribe(reg: CommonInputOptions, listener?: ListenFunc);

  /**
   * @description 查询租户下的所有的配置
   */
  getConfigs(): Promise<Array<string>>;

  /**
   * @description close connection
   */
  close(): void;

  on?(evt: string, fn: (err: Error) => void): void;
}

/**
 * 服务列表管理器
 */
export interface IServerListManager {
  /**
   * 获取当前单元
   */
  getCurrentUnit(): Promise<string>;

  /**
   * 获取单元列表
   */
  fetchUnitLists(): Promise<Array<string>>;

  /**
   * 更新当前服务器
   */
  updateCurrentServer(unit?: string): Promise<void>;

  /**
   * 获取一个服务器地址
   * @param unit
   */
  getCurrentServerAddr(unit?: string): Promise<string>;

  /**
   * @description close connection
   */
  close();

  // on(evt: string, fn: (err: Error) => void): void;
}

export interface ISnapshot {
  cacheDir;
  get(key: string): any;
  save(key: string, value: any);
  delete(key: string);
  batchSave(arr: Array<SnapShotData>);
}

export interface NacosHttpError extends Error {
  url?: string;
  params?: any;
  body?: any;
  unit?: string;
  dataId?: string;
  group?: string;
}

export interface SnapShotData {
  key?: string;
  value?: string;
}

export interface ClientOptions {
  endpoint?: string;          // 寻址模式下的对端 host
  serverPort?: number;        // 对端端口
  namespace?: string;         // 阿里云的 namespace
  accessKey?: string;         // 阿里云的 accessKey
  secretKey?: string;         // 阿里云的 secretKey
  httpclient?: any;           // http 请求客户端，默认为 urllib
  httpAgent?: any;            // httpAgent
  appName?: string;           // 应用名，可选
  ssl?: boolean;              // 是否为 https 请求
  refreshInterval?: number;   // 重新拉取地址列表的间隔时间
  contextPath?: string;       // 请求的 contextPath
  clusterName?: string;       // 请求的 path
  requestTimeout?: number;    // 请求超时时间
  defaultEncoding?: string;   // 请求编码
  serverAddr?: string;        // 用于直连，包含端口
  unit?: string;              // 内部单元化用
  nameServerAddr?: string;    // 老的兼容参数，逐步废弃，同 endpoint
  username?: string;          // 认证的用户名
  password?: string;          // 认证的密码
  cacheDir?: string;          // 缓存文件的路径
  identityKey?: string;       // Identity Key
  identityValue?: string;     // Identity Value
  endpointQueryParams?: string; // endPoint 查询参数 e.g: param_1=1&param_2=2
  decodeRes?: (res: any, method?: string, encoding?: string) => any
}

export enum ClientOptionKeys {
  ENDPOINT = 'endpoint',
  SERVER_PORT = 'serverPort',
  NAMESPACE = 'namespace',
  ACCESSKEY = 'accessKey',
  SECRETKEY = 'secretKey',
  HTTPCLIENT = 'httpclient',
  APPNAME = 'appName',
  SSL = 'ssl',
  SNAPSHOT = 'snapshot',
  CACHE_DIR = 'cacheDir',
  NAMESERVERADDR = 'nameServerAddr',
  SERVERADDR = 'serverAddr',
  UNIT = 'unit',
  REFRESH_INTERVAL = 'refreshInterval',
  CONTEXTPATH = 'contextPath',
  CLUSTER_NAME = 'clusterName',
  REQUEST_TIMEOUT = 'requestTimeout',
  HTTP_AGENT = 'httpAgent',
  SERVER_MGR = 'serverMgr',
  DEFAULT_ENCODING = 'defaultEncoding',
  IDENTITY_KEY = 'identityKey',
  IDENTITY_VALUE = 'identityValue',
  DECODE_RES = 'decodeRes',
  ENDPOINT_QUERY_PARAMS = 'endpointQueryParams'
}

export interface IConfiguration {
  merge(config: any): IConfiguration;
  attach(config: any): IConfiguration;
  get(configKey?: ClientOptionKeys): any;
  has(configKey: ClientOptionKeys): boolean;
  set(configKey: ClientOptionKeys, target: any): IConfiguration;
  modify(configKey: ClientOptionKeys, changeHandler: (target: any) => any): IConfiguration;
}

export interface API_ROUTE {
  GET: string;
  BATCH_GET: string;
  BATCH_QUERY: string;
  PUBLISH: string;
  PUBLISH_ALL: string;
  REMOVE: string;
  REMOVE_ALL: string;
  LISTENER: string;
}
