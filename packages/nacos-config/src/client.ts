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
import {
  BaseClient,
  ClientOptionKeys,
  ClientOptions,
  IClientWorker,
  IConfiguration,
  IServerListManager,
  ISnapshot,
} from './interface';
import { ServerListManager } from './server_list_mgr';
import { ClientWorker } from './client_worker';
import { Snapshot } from './snapshot';
import { CURRENT_UNIT, DEFAULT_OPTIONS } from './const';
import { checkParameters } from './utils';
import { HttpAgent } from './http_agent';
import { Configuration } from './configuration';
import * as assert from 'assert';

const Base = require('sdk-base');


export class DataClient extends Base implements BaseClient {

  private clients: Map<string, IClientWorker>;
  private configuration: IConfiguration;
  protected snapshot: ISnapshot;
  protected serverMgr: IServerListManager;
  protected httpAgent;

  constructor(options: ClientOptions) {
    if(!options.endpoint && !options.serverAddr) {
      assert(options.endpoint, '[Client] options.endpoint or options.serverAddr is required');
    }

    options = Object.assign({}, DEFAULT_OPTIONS, options);
    super(options);
    this.configuration = this.options.configuration = new Configuration(options);

    this.snapshot = this.getSnapshot();
    this.serverMgr = this.getServerListManager();
    const CustomHttpAgent = this.configuration.get(ClientOptionKeys.HTTP_AGENT);
    this.httpAgent = CustomHttpAgent ? new CustomHttpAgent({ configuration: this.configuration }) : new HttpAgent({ configuration: this.configuration });

    this.configuration.merge({
      snapshot: this.snapshot,
      serverMgr: this.serverMgr,
      httpAgent: this.httpAgent,
    });

    this.clients = new Map();
    (<any>this.snapshot).on('error', err => this.throwError(err));
    (<any>this.serverMgr).on('error', err => this.throwError(err));
    this.ready(true);
  }

  get appName() {
    return this.configuration.get(ClientOptionKeys.APPNAME);
  }

  get httpclient() {
    return this.configuration.get(ClientOptionKeys.HTTPCLIENT);
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
   * @return {DataClient} self
   */
  subscribe(info, listener) {
    const { dataId, group } = info;
    checkParameters(dataId, group);
    const client = this.getClient(info);
    client.subscribe({ dataId, group }, listener);
    return this;
  }

  /**
   * 退订
   * @param {Object} info
   *   - {String} dataId - id of the data you want to subscribe
   *   - {String} [group] - group name of the data
   *   - {String} [unit] - which unit you want to connect, default is current unit
   * @param {Function} listener - listener
   * @return {DataClient} self
   */
  unSubscribe(info, listener) {
    const { dataId, group } = info;
    checkParameters(dataId, group);
    const client = this.getClient(info);
    client.unSubscribe({ dataId, group }, listener);
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
    return await client.publishSingle(dataId, group, content, options && options.type);
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
    await units.map(unit => this.getClient({ unit }).publishSingle(dataId, group, content));
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
    await units.map(unit => this.getClient({ unit }).remove(dataId, group));
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

  protected getClient(options: { unit?: string; group?; dataId? } = {}): IClientWorker {
    if (!options.unit) {
      options.unit = CURRENT_UNIT;
    }
    const { unit } = options;
    let client = this.clients.get(unit);
    if (!client) {
      client = this.getClientWorker(Object.assign({}, {
        configuration: this.configuration.attach({ unit })
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
  protected getClientWorker(options): IClientWorker {
    return new ClientWorker(options);
  }

  protected getServerListManager(): IServerListManager {
    return new ServerListManager(this.options);
  }

  protected getSnapshot(): ISnapshot {
    return new Snapshot(this.options);
  }

}
