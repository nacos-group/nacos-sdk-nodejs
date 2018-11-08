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
export interface BaseClient extends IDiamondEnv {
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
export interface IDiamondEnv {
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
   * @description close connection
   */
  close();

  // on(evt: string, fn: (err: Error) => void): void;
}

export interface ISnapshot {
  // on(evt: string, fn: (err: Error) => void): void;
}

export interface DiamondEnvOptions {
  httpclient?: any;
  snapshot?: ISnapshot;
  serverMgr?: IServerListManager;
  unit?: string;
}

export interface serverListMgrOptions {
  httpclient?: any;
  snapshot?: ISnapshot;
  endpoint?: string;
  cacheDir?: string;
}

export interface DiamondError extends Error {
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

export interface DataClientOptions {
  endpoint: string;
  namespace: string;
  accessKey: string;
  secretKey: string;
  httpclient?: any;
  appName?: string;
  ssl?: boolean;
}
