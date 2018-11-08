import { DataClient } from './client';
import { checkParameters } from './utils';
import { BaseClient } from './interface';

const APIClientBase = require('cluster-client').APIClientBase;

export class ACMClient extends APIClientBase implements BaseClient {

  /**
   * cluster-client wrapper client
   * set after constructor
   */
  constructor(options = {}) {
    super(options);
  }

  get DataClient() {
    return DataClient;
  }

  get clusterOptions() {
    const host = this.options.endpoint;
    return {
      name: `DiamondClient@${host}`,
    };
  }

  /**
   * 订阅
   * @param {Object} reg
   *   - {String} dataId - id of the data you want to subscribe
   *   - {String} [group] - group name of the data
   *   - {String} [unit] - which unit you want to connect, default is current unit
   * @param {Function} listener - listener
   * @return {DiamondClient} self
   */
  subscribe(reg, listener) {
    const {dataId, group} = reg;
    checkParameters(dataId, group);
    this._client.subscribe(reg, listener);
    return this;
  }

  /**
   * 退订
   * @param {Object} reg
   *   - {String} dataId - id of the data you want to subscribe
   *   - {String} [group] - group name of the data
   *   - {String} [unit] - which unit you want to connect, default is current unit
   * @param {Function} listener - listener
   * @return {DiamondClient} self
   */
  unSubscribe(reg, listener) {
    const {dataId, group} = reg;
    checkParameters(dataId, group);
    this._client.unSubscribe(reg, listener);
    return this;
  }

  /**
   * 获取当前机器所在机房
   * @return {String} currentUnit
   */
  async getCurrentUnit() {
    return await this._client.getCurrentUnit();
  }

  /**
   * 获取所有单元信息
   * @return {Array} units
   */
  async getAllUnits() {
    return await this._client.getAllUnits();
  }

  /**
   * 查询租户下的所有的配置
   * @return {Array} config
   */
  async getConfigs() {
    return await this._client.getConfigs();
  }

  /**
   * 获取配置
   * @param {String} dataId - id of the data
   * @param {String} group - group name of the data
   * @param {Object} options
   *   - {Stirng} unit - which unit you want to connect, default is current unit
   * @return {String} value
   */
  async getConfig(dataId, group, options?) {
    checkParameters(dataId, group);
    return await this._client.getConfig(dataId, group, options);
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
  async publishSingle(dataId, group, content, options?) {
    checkParameters(dataId, group);
    return await this._client.publishSingle(dataId, group, content, options);
  }

  /**
   * 删除配置
   * @param {String} dataId - id of the data
   * @param {String} group - group name of the data
   * @param {Object} options
   *   - {Stirng} unit - which unit you want to connect, default is current unit
   * @return {Boolean} success
   */
  async remove(dataId, group, options?) {
    checkParameters(dataId, group);
    return await this._client.remove(dataId, group, options);
  }

  /**
   * 批量获取配置
   * @param {Array} dataIds - data id array
   * @param {String} group - group name of the data
   * @param {Object} options
   *   - {Stirng} unit - which unit you want to connect, default is current unit
   * @return {Array} result
   */
  async batchGetConfig(dataIds, group, options?) {
    checkParameters(dataIds, group);
    return await this._client.batchGetConfig(dataIds, group, options);
  }

  /**
   * 批量查询
   * @param {Array} dataIds - data id array
   * @param {String} group - group name of the data
   * @param {Object} options
   *   - {Stirng} unit - which unit you want to connect, default is current unit
   * @return {Object} result
   */
  async batchQuery(dataIds, group, options?) {
    checkParameters(dataIds, group);
    return await this._client.batchQuery(dataIds, group, options);
  }

  /**
   * 将配置发布到所有单元
   * @param {String} dataId - id of the data
   * @param {String} group - group name of the data
   * @param {String} content - config value
   * @return {Boolean} success
   */
  async publishToAllUnit(dataId, group, content?) {
    checkParameters(dataId, group);
    return await this._client.publishToAllUnit(dataId, group, content);
  }

  /**
   * 将配置从所有单元中删除
   * @param {String} dataId - id of the data
   * @param {String} group - group name of the data
   * @return {Boolean} success
   */
  async removeToAllUnit(dataId, group) {
    checkParameters(dataId, group);
    return await this._client.removeToAllUnit(dataId, group);
  }

  async publishAggr(dataId, group, datumId, content, options) {
    checkParameters(dataId, group, datumId);
    return await this._client.publishAggr(dataId, group, datumId, content, options);
  }

  async removeAggr(dataId, group, datumId, options) {
    checkParameters(dataId, group, datumId);
    return await this._client.removeAggr(dataId, group, datumId, options);
  }

  close() {
    return this._client.close();
  }

  static get DataClient() {
    return DataClient;
  }
}
