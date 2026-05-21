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
  /**
   * Configuration type, e.g., 'text', 'json', 'xml', 'html', 'properties', 'yaml', etc.
   */
  type?: string;
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
   *   - {String} type - config type, e.g., 'text', 'json', 'xml', 'html', 'properties', 'yaml', etc.
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
   * @deprecated This API is not implemented and will be removed in a future version
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
   * @deprecated This API is not implemented and will be removed in a future version
   */
  removeAggr(dataId: string, group: string, datumId: string, options?: UnitOptions): Promise<boolean>;

  /**
   * @description 批量获取配置
   * @param {Array} dataIds - data id array
   * @param {String} group - group name of the data
   * @param {Object} [options]
   *   - {String} unit - which unit you want to connect, default is current unit
   * @returns {Promise<object>} result
   * @deprecated This API is not implemented and will be removed in a future version.
   * Nacos server does not support batch configuration retrieval operations.
   * Please use individual getConfig() calls instead.
   */
  batchGetConfig(dataIds: string[], group: string, options?: UnitOptions): Promise<object>;

  /**
   * @description 批量查询
   * @param {Array} dataIds - data id array
   * @param {String} group - group name of the data
   * @param {Object} [options]
   *   - {String} unit - which unit you want to connect, default is current unit
   * @returns {Promise<object>} result
   * @deprecated This API is not implemented and will be removed in a future version.
   * Nacos server does not support batch query operations.
   * Please use individual query methods instead.
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
  /** Endpoint host for address discovery mode */
  endpoint?: string;
  /** Server port (default: 8848) */
  serverPort?: number;
  /** Alibaba Cloud namespace */
  namespace?: string;
  /** Alibaba Cloud access key */
  accessKey?: string;
  /** Alibaba Cloud secret key */
  secretKey?: string;
  /** Alibaba Cloud STS security token */
  securityToken?: string;
  /** Alibaba Cloud extended auth AccessKeyId */
  alibabaCloudAccessKeyId?: string;
  /** Alibaba Cloud extended auth AccessKeySecret */
  alibabaCloudAccessKeySecret?: string;
  /** Alibaba Cloud extended auth SecurityToken */
  alibabaCloudSecurityToken?: string;
  /** Alibaba Cloud extended auth Credentials URI */
  alibabaCloudCredentialsUri?: string;
  /** STS temporary credentials JSON */
  securityCredentials?: string | object;
  /** STS temporary credentials fetch URL */
  securityCredentialsUrl?: string;
  /** ECS RAM role name */
  ramRoleName?: string;
  /** Whether to cache STS temporary credentials */
  cacheSecurityCredentials?: boolean;
  /** Refresh-ahead time (ms) for STS temporary credentials */
  timeToRefreshInMillisecond?: number;
  /** Custom Alibaba Cloud credential provider */
  aliyunCredentialsProvider?: any;
  /** Custom Alibaba Cloud extended credential provider */
  alibabaCloudCredentialsProvider?: any;
  /** Alibaba Cloud v4 signature region ID */
  signatureRegionId?: string;
  /** HTTP request client, defaults to urllib */
  httpclient?: any;
  /** HTTP agent */
  httpAgent?: any;
  /** Application name (optional) */
  appName?: string;
  /** Whether to use HTTPS */
  ssl?: boolean;
  /** Interval (ms) to re-fetch the server address list */
  refreshInterval?: number;
  /** Request context path */
  contextPath?: string;
  /** Server list cluster name */
  clusterName?: string;
  /** Request timeout in milliseconds */
  requestTimeout?: number;
  /** Request encoding (default: utf8) */
  defaultEncoding?: string;
  /** Direct server address (with port); supports a single address or an array of addresses */
  serverAddr?: string | string[];
  /** Internal unit identifier */
  unit?: string;
  /** Legacy alias for endpoint; will be deprecated */
  nameServerAddr?: string;
  /** Authentication username */
  username?: string;
  /** Authentication password */
  password?: string;
  /** Directory path for local snapshot cache */
  cacheDir?: string;
  /** Custom identity header key */
  identityKey?: string;
  /** Custom identity header value */
  identityValue?: string;
  /** Extra query parameters appended to the endpoint URL, e.g. "param_1=1&param_2=2" */
  endpointQueryParams?: string;
  /** Custom response decoder */
  decodeRes?: (res: any, method?: string, encoding?: string) => any;
  /** Transport protocol: 'grpc' uses gRPC, 'http' uses HTTP long-polling (default: 'http') */
  transport?: 'grpc' | 'http';
}

export enum ClientOptionKeys {
  ENDPOINT = 'endpoint',
  SERVER_PORT = 'serverPort',
  NAMESPACE = 'namespace',
  ACCESSKEY = 'accessKey',
  SECRETKEY = 'secretKey',
  SECURITY_TOKEN = 'securityToken',
  ALIBABA_CLOUD_ACCESS_KEY_ID = 'alibabaCloudAccessKeyId',
  ALIBABA_CLOUD_ACCESS_KEY_SECRET = 'alibabaCloudAccessKeySecret',
  ALIBABA_CLOUD_SECURITY_TOKEN = 'alibabaCloudSecurityToken',
  ALIBABA_CLOUD_CREDENTIALS_URI = 'alibabaCloudCredentialsUri',
  SECURITY_CREDENTIALS = 'securityCredentials',
  SECURITY_CREDENTIALS_URL = 'securityCredentialsUrl',
  RAM_ROLE_NAME = 'ramRoleName',
  CACHE_SECURITY_CREDENTIALS = 'cacheSecurityCredentials',
  TIME_TO_REFRESH_IN_MILLISECOND = 'timeToRefreshInMillisecond',
  ALIYUN_CREDENTIALS_PROVIDER = 'aliyunCredentialsProvider',
  ALIBABA_CLOUD_CREDENTIALS_PROVIDER = 'alibabaCloudCredentialsProvider',
  SIGNATURE_REGION_ID = 'signatureRegionId',
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
