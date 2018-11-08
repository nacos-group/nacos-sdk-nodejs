import {
  BaseClient, DataClientOptions,
  DiamondEnvOptions,
  IDiamondEnv,
  IServerListManager,
  ISnapshot,
  serverListMgrOptions
} from './interface';
import { ServerListManager } from './server_list_mgr';
import { DiamondEnv } from './diamond_env';
import { Snapshot } from './snapshot';
import * as urllib from 'urllib';
import { CURRENT_UNIT } from './const';
import { checkParameters } from './utils';

const Base = require('sdk-base');
const path = require('path');
const osenv = require('osenv');
const assert = require('assert');

// 默认参数
const DEFAULT_OPTIONS = {
  appKey: '',
  serverPort: 8080,
  requestTimeout: 6000,
  refreshInterval: 30000,
  cacheDir: path.join(osenv.home(), '.node-diamond-client-cache'),
  httpclient: urllib,
  ssl: true,
};

export class DataClient extends Base implements BaseClient {

  private clients: Map<string, IDiamondEnv>;
  protected snapshot: ISnapshot;
  protected serverMgr: IServerListManager;

  constructor(options: DataClientOptions) {
    assert(options.endpoint, '[AcmClient] options.endpoint is required');
    assert(options.namespace, '[AcmClient] options.namespace is required');
    assert(options.accessKey, '[AcmClient] options.accessKey is required');
    assert(options.secretKey, '[AcmClient] options.secretKey is required');

    options = Object.assign({}, DEFAULT_OPTIONS, options);
    super(options);

    this.snapshot = this.getSnapshot(options);
    this.serverMgr = this.getServerListManager(options);

    this.clients = new Map();
    (<any>this.snapshot).on('error', err => this.throwError(err));
    (<any>this.serverMgr).on('error', err => this.throwError(err));
    this.ready(true);
  }

  /**
   * HTTP 请求客户端
   * @property {Urllib} DiamondClient#urllib
   */
  get httpclient() {
    return this.options.httpclient || urllib;
  }

  get appName() {
    return this.options.appName;
  }

  get appKey() {
    return this.options.appKey;
  }

  /**
   * 获取当前机器所在机房
   * @return {String} currentUnit
   */
  async getCurrentUnit() {
    return await this.serverMgr.getCurrentUnit();
  }

  /**
   * 获取所有单元信息
   * @return {Array} units
   */
  async getAllUnits() {
    return await this.serverMgr.fetchUnitLists();
  }

  /**
   * 订阅
   * @param {Object} info
   *   - {String} dataId - id of the data you want to subscribe
   *   - {String} [group] - group name of the data
   *   - {String} [unit] - which unit you want to connect, default is current unit
   * @param {Function} listener - listener
   * @return {DiamondClient} self
   */
  subscribe(info, listener) {
    const {dataId, group} = info;
    checkParameters(dataId, group);
    const client = this.getClient(info);
    client.subscribe({dataId, group}, listener);
    return this;
  }

  /**
   * 退订
   * @param {Object} info
   *   - {String} dataId - id of the data you want to subscribe
   *   - {String} [group] - group name of the data
   *   - {String} [unit] - which unit you want to connect, default is current unit
   * @param {Function} listener - listener
   * @return {DiamondClient} self
   */
  unSubscribe(info, listener) {
    const {dataId, group} = info;
    checkParameters(dataId, group);
    const client = this.getClient(info);
    client.unSubscribe({dataId, group}, listener);
    return this;
  }

  /**
   * 获取配置
   * @param {String} dataId - id of the data
   * @param {String} group - group name of the data
   * @param {Object} options
   *   - {Stirng} unit - which unit you want to connect, default is current unit
   * @return {String} value
   */
  async getConfig(dataId, group, options) {
    checkParameters(dataId, group);
    const client = this.getClient(options);
    return await client.getConfig(dataId, group);
  }

  /**
   * 查询租户下的所有的配置
   * @return {Array} config
   */
  async getConfigs() {
    const client = this.getClient();
    return await client.getConfigs();
  }


  /**
   * 发布配置
   * @param {String} dataId - id of the data
   * @param {String} group - group name of the data
   * @param {String} content - config value
   * @param {Object} options
   *   - {Stirng} unit - which unit you want to connect, default is current unit
   * @return {Boolean} success
   */
  async publishSingle(dataId, group, content, options) {
    checkParameters(dataId, group);
    const client = this.getClient(options);
    return await client.publishSingle(dataId, group, content);
  }

  /**
   * 删除配置
   * @param {String} dataId - id of the data
   * @param {String} group - group name of the data
   * @param {Object} options
   *   - {Stirng} unit - which unit you want to connect, default is current unit
   * @return {Boolean} success
   */
  async remove(dataId, group, options) {
    checkParameters(dataId, group);
    const client = this.getClient(options);
    return await client.remove(dataId, group);
  }

  /**
   * 批量获取配置
   * @param {Array} dataIds - data id array
   * @param {String} group - group name of the data
   * @param {Object} options
   *   - {Stirng} unit - which unit you want to connect, default is current unit
   * @return {Array} result
   */
  async batchGetConfig(dataIds, group, options) {
    checkParameters(dataIds, group);
    const client = this.getClient(options);
    return await client.batchGetConfig(dataIds, group);
  }

  /**
   * 批量查询
   * @param {Array} dataIds - data id array
   * @param {String} group - group name of the data
   * @param {Object} options
   *   - {Stirng} unit - which unit you want to connect, default is current unit
   * @return {Object} result
   */
  async batchQuery(dataIds, group, options) {
    checkParameters(dataIds, group);
    const client = this.getClient(options);
    return await client.batchQuery(dataIds, group);
  }

  /**
   * 将配置发布到所有单元
   * @param {String} dataId - id of the data
   * @param {String} group - group name of the data
   * @param {String} content - config value
   * @return {Boolean} success
   */
  async publishToAllUnit(dataId, group, content) {
    checkParameters(dataId, group);
    const units = await this.getAllUnits();
    await units.map(unit => this.getClient({unit}).publishSingle(dataId, group, content));
    return true;
  }

  /**
   * 将配置从所有单元中删除
   * @param {String} dataId - id of the data
   * @param {String} group - group name of the data
   * @return {Boolean} success
   */
  async removeToAllUnit(dataId, group) {
    checkParameters(dataId, group);
    const units = await this.getAllUnits();
    await units.map(unit => this.getClient({unit}).remove(dataId, group));
    return true;
  }

  async publishAggr(dataId, group, datumId, content, options) {
    checkParameters(dataId, group, datumId);
    const client = this.getClient(options);
    return await client.publishAggr(dataId, group, datumId, content);
  }

  async removeAggr(dataId, group, datumId, options) {
    checkParameters(dataId, group, datumId);
    const client = this.getClient(options);
    return await client.removeAggr(dataId, group, datumId);
  }

  close() {
    this.serverMgr.close();
    for (const client of this.clients.values()) {
      client.close();
    }
    this.clients.clear();
  }

  protected getClient(options: { unit?: string; group?; dataId? } = {}): IDiamondEnv {
    if (!options.unit) {
      options.unit = CURRENT_UNIT;
    }
    const {unit} = options;
    let client = this.clients.get(unit);
    if (!client) {
      client = this.getDiamondEnv(Object.assign({}, this.options, {
        unit,
        serverMgr: this.serverMgr,
        snapshot: this.snapshot,
      }));
      client.on('error', err => {
        this.throwError(err);
      });
      this.clients.set(unit, client);
    }
    return client;
  }

  /**
   * 默认异常处理
   * @param {Error} err - 异常
   * @return {void}
   * @private
   */
  private throwError(err) {
    if (err) {
      setImmediate(() => this.emit('error', err));
    }
  }

  /**
   * 供其他包覆盖
   * @param options
   */
  protected getDiamondEnv(options: DiamondEnvOptions): IDiamondEnv {
    return new DiamondEnv(options);
  }

  protected getServerListManager(options: serverListMgrOptions): IServerListManager {
    return new ServerListManager(options);
  }

  protected getSnapshot(options): ISnapshot {
    return new Snapshot(options);
  }
}
