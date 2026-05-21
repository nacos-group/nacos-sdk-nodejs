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
  UnitOptions,
} from './interface';
import { ServerListManager } from './server_list_mgr';
import { ClientWorker } from './client_worker';
import { Snapshot } from './snapshot';
import { CURRENT_UNIT, DEFAULT_OPTIONS } from './const';
import { checkParameters } from './utils';
import { HttpAgent } from './http_agent';
import { Configuration } from './configuration';
import { GrpcConfigProxy } from './grpc_config_proxy';
import { GrpcConnection, GrpcTransportClient } from 'nacos-common';
import * as assert from 'assert';

const Base = require('sdk-base');


export class DataClient extends Base implements BaseClient {

  private clients: Map<string, IClientWorker>;
  private configuration: IConfiguration;
  protected snapshot: ISnapshot;
  protected serverMgr: IServerListManager | null;
  protected httpAgent;
  private _transport: 'grpc' | 'http';
  private _grpcConnection: GrpcConnection | null;
  private _grpcTransportClient: GrpcTransportClient | null;
  private _grpcConfigProxy: GrpcConfigProxy | null;
  private _grpcSubscribers: Map<string, Function[]> | null;

  constructor(options: ClientOptions) {
    if(!options.endpoint && !options.serverAddr) {
      assert(options.endpoint, '[Client] options.endpoint or options.serverAddr is required');
    }

    options = Object.assign({}, DEFAULT_OPTIONS, options);
    super(options);
    this.configuration = this.options.configuration = new Configuration(options);
    this._transport = (options.transport === 'http') ? 'http' : 'grpc';
    this._grpcConnection = null;
    this._grpcTransportClient = null;
    this._grpcConfigProxy = null;
    this._grpcSubscribers = null;

    this.snapshot = this.getSnapshot();
    (<any>this.snapshot).on('error', err => this.throwError(err));

    if (this._transport === 'grpc') {
      // gRPC mode: skip ServerListManager and HttpAgent; set up gRPC stack
      this.serverMgr = null;
      this.httpAgent = null;

      this.configuration.merge({
        snapshot: this.snapshot,
      });

      // Normalise serverAddr to a string array
      const rawAddr = options.serverAddr;
      let serverList: string[];
      if (Array.isArray(rawAddr)) {
        serverList = rawAddr;
      } else if (rawAddr) {
        serverList = [ rawAddr ];
      } else {
        serverList = [ `${options.endpoint || 'localhost'}:8848` ];
      }

      const logger = (this.options as any).logger || console;
      this._grpcConnection = new GrpcConnection({
        serverList,
        namespace: options.namespace || 'public',
        ssl: options.ssl,
        logger,
        accessKey: options.accessKey,
        secretKey: options.secretKey,
        username: options.username,
        password: options.password,
        labels: { source: 'sdk', module: 'config' },
      });

      this._grpcTransportClient = new GrpcTransportClient(this._grpcConnection);

      this._grpcConfigProxy = new GrpcConfigProxy({
        transportClient: this._grpcTransportClient,
        namespace: options.namespace,
        logger,
      });

      this._grpcConfigProxy.on('configChanged', ({ dataId, group, tenant }) => {
        // Emit so subscribers can be notified
        this.emit('configChanged', { dataId, group, tenant });
      });
    } else {
      // HTTP mode: original initialization
      this.serverMgr = this.getServerListManager();
      (<any>this.serverMgr).on('error', err => this.throwError(err));

      const CustomHttpAgent = this.configuration.get(ClientOptionKeys.HTTP_AGENT);
      this.httpAgent = CustomHttpAgent ? new CustomHttpAgent({ configuration: this.configuration }) : new HttpAgent({ configuration: this.configuration });

      this.configuration.merge({
        snapshot: this.snapshot,
        serverMgr: this.serverMgr,
        httpAgent: this.httpAgent,
      });
    }

    this.clients = new Map();

    if (this._transport === 'grpc') {
      this._grpcConnection!.connect().then(() => {
        this.ready(true);
      }).catch(err => {
        this.throwError(err);
        this.ready(true);
      });
    } else {
      this.ready(true);
    }
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
    if (!this.serverMgr) {
      return 'gRPC';
    }
    return await this.serverMgr.getCurrentUnit();
  }

  /**
   * 获取所有单元信息
   * @return {Array} units
   */
  async getAllUnits() {
    if (!this.serverMgr) {
      return [];
    }
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

    if (this._grpcConfigProxy) {
      const key = `${dataId}@@${group}`;
      if (!this._grpcSubscribers) {
        this._grpcSubscribers = new Map();
        this._grpcConfigProxy.on('configChanged', async (evt) => {
          const evtKey = `${evt.dataId}@@${evt.group}`;
          const listeners = this._grpcSubscribers!.get(evtKey);
          if (listeners && listeners.length > 0) {
            try {
              const content = await this._grpcConfigProxy!.getConfig(evt.dataId, evt.group);
              for (const fn of listeners) { fn(content); }
            } catch (err) {
              this.throwError(err);
            }
          }
        });
      }
      const listeners = this._grpcSubscribers.get(key) || [];
      listeners.push(listener);
      this._grpcSubscribers.set(key, listeners);
      // Get current content and call listener immediately
      this._grpcConfigProxy.getConfig(dataId, group).then(content => {
        if (content) listener(content);
      }).catch(() => {});
      // Register gRPC listen (need MD5 of current content)
      this._grpcConfigProxy.getConfig(dataId, group).then(content => {
        const crypto = require('crypto');
        const md5 = content ? crypto.createHash('md5').update(content).digest('hex') : '';
        this._grpcConfigProxy!.addListener(dataId, group, md5).catch(() => {});
      }).catch(() => {});
      return this;
    }

    const client = this.getClient(info);
    client.subscribe({ dataId, group }, listener);
    return this;
  }

  unSubscribe(info, listener) {
    const { dataId, group } = info;
    checkParameters(dataId, group);

    if (this._grpcConfigProxy) {
      const key = `${dataId}@@${group}`;
      if (this._grpcSubscribers) {
        if (listener) {
          const listeners = this._grpcSubscribers.get(key) || [];
          const idx = listeners.indexOf(listener);
          if (idx >= 0) listeners.splice(idx, 1);
          if (listeners.length === 0) {
            this._grpcSubscribers.delete(key);
            this._grpcConfigProxy.removeListener(dataId, group).catch(() => {});
          }
        } else {
          this._grpcSubscribers.delete(key);
          this._grpcConfigProxy.removeListener(dataId, group).catch(() => {});
        }
      }
      return this;
    }

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
  async getConfig(dataId, group, options?) {
    checkParameters(dataId, group);
    if (this._grpcConfigProxy) {
      return await this._grpcConfigProxy.getConfig(dataId, group, this.configuration.get(ClientOptionKeys.NAMESPACE));
    }
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
   *   - {String} type - config type, e.g., 'text', 'json', 'xml', 'html', 'properties', 'yaml', etc.
   * @return {Boolean} success
   */
  async publishSingle(dataId, group, content, options?: UnitOptions) {
    checkParameters(dataId, group);
    if (this._grpcConfigProxy) {
      return await this._grpcConfigProxy.publishSingle(
        dataId, group,
        this.configuration.get(ClientOptionKeys.NAMESPACE),
        content,
        options && options.type
      );
    }
    const client = this.getClient(options);
    return await client.publishSingle(dataId, group, content, options);
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
    if (this._grpcConfigProxy) {
      return await this._grpcConfigProxy.remove(dataId, group, this.configuration.get(ClientOptionKeys.NAMESPACE));
    }
    const client = this.getClient(options);
    return await client.remove(dataId, group);
  }

  /**
   * @deprecated This API is not implemented and will be removed in a future version.
   * Nacos server does not support batch configuration retrieval operations.
   * Please use individual getConfig() calls instead.
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
   * @deprecated This API is not implemented and will be removed in a future version.
   * Nacos server does not support batch query operations.
   * Please use individual query methods instead.
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

  /**
   * @deprecated This API is not implemented and will be removed in a future version
   */
  async publishAggr(dataId, group, datumId, content, options) {
    checkParameters(dataId, group, datumId);
    const client = this.getClient(options);
    return await client.publishAggr(dataId, group, datumId, content);
  }

  /**
   * @deprecated This API is not implemented and will be removed in a future version
   */
  async removeAggr(dataId, group, datumId, options) {
    checkParameters(dataId, group, datumId);
    const client = this.getClient(options);
    return await client.removeAggr(dataId, group, datumId);
  }

  close() {
    if (this._grpcConfigProxy) {
      this._grpcConfigProxy.close();
    }
    if (this._grpcConnection) {
      this._grpcConnection.close();
    }
    if (this.serverMgr) {
      this.serverMgr.close();
    }
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
