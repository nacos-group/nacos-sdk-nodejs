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
import { ConfigQueryResult } from './grpc_config_proxy';
import { GrpcConnection, GrpcTransportClient } from 'nacos-common';
import { createConfigCipher, ConfigCipher } from './cipher';
import { resolveAliyunCredentialsAsync } from './aliyun_auth';
import { KeyedAsyncQueue } from './keyed_queue';
import { withSnapshotLock } from './disaster_recovery';
import * as path from 'path';
import * as crypto from 'crypto';
import * as assert from 'assert';

const Base = require('sdk-base');

interface GrpcFailoverState {
  dataId: string;
  group: string;
  useFailover: boolean;
  failoverVersion: number | null;
  content: string | null;
  md5: string;
}


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
  private _cipher: ConfigCipher;
  private _grpcFailoverState: Map<string, GrpcFailoverState>;
  private _grpcOpQueue: KeyedAsyncQueue;
  private _failoverWatcher: any;
  private _closed: boolean;

  constructor(options: ClientOptions) {
    if(!options.endpoint && !options.serverAddr) {
      assert(options.endpoint, '[Client] options.endpoint or options.serverAddr is required');
    }

    options = Object.assign({}, DEFAULT_OPTIONS, options);
    super(options);
    this.configuration = this.options.configuration = new Configuration(options);
    this._cipher = createConfigCipher({
      kmsClient: options.kmsClient,
      kmsClientFactory: options.kmsClientFactory,
      kmsEndpoint: options.kmsEndpoint,
      kmsRegionId: options.kmsRegionId,
      kmsKeyId: options.kmsKeyId,
      kmsCacheEnabled: options.kmsCacheEnabled,
      kmsCacheMaxSize: options.kmsCacheMaxSize,
      kmsCacheAfterAccessSeconds: options.kmsCacheAfterAccessSeconds,
      kmsCacheAfterWriteSeconds: options.kmsCacheAfterWriteSeconds,
      credentials: options,
      credentialsProvider: () => resolveAliyunCredentialsAsync(this.configuration),
      kmsClientKeyContent: options.kmsClientKeyContent,
      kmsClientKeyFilePath: options.kmsClientKeyFilePath,
      kmsPassword: options.kmsPassword,
      kmsCaFileContent: options.kmsCaFileContent,
      kmsCaFilePath: options.kmsCaFilePath,
      openSSL: options.openSSL,
    });
    this.configuration.merge({ cipher: this._cipher });
    this._cipher.protectKey().catch(() => {});
    this._transport = (options.transport === 'http') ? 'http' : 'grpc';
    this._grpcConnection = null;
    this._grpcTransportClient = null;
    this._grpcConfigProxy = null;
    this._grpcSubscribers = null;
    this._grpcFailoverState = new Map();
    this._grpcOpQueue = new KeyedAsyncQueue();
    this._failoverWatcher = null;
    this._closed = false;

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
        cipher: this._cipher,
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
        this._grpcConfigProxy.on('configChanged', evt => this._handleGrpcConfigChanged(evt));
      }
      const listeners = this._grpcSubscribers.get(key) || [];
      listeners.push(listener);
      this._grpcSubscribers.set(key, listeners);
      if (!this._grpcFailoverState.has(key)) {
        this._grpcFailoverState.set(key, { dataId, group, useFailover: false, failoverVersion: null, content: null, md5: '' });
      }
      this._startFailoverWatcher();
      const state = this._grpcFailoverState.get(key)!;
      this._grpcOpQueue.run(key, async () => {
        if (this._closed || !this._hasGrpcListener(key, listener)) return;
        const content = await this._getGrpcConfig(dataId, group, state);
        if (!this._hasGrpcListener(key, listener)) return;
        if (content) listener(content);
        await this._grpcConfigProxy!.addListener(dataId, group, state.useFailover ? '' : (state.md5 || ''));
      }).catch(err => this.throwError(err));
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
            this._grpcFailoverState.delete(key);
            this._grpcOpQueue.run(key, () => this._grpcConfigProxy!.removeListener(dataId, group)).catch(() => {});
          }
        } else {
          this._grpcSubscribers.delete(key);
          this._grpcFailoverState.delete(key);
          this._grpcOpQueue.run(key, () => this._grpcConfigProxy!.removeListener(dataId, group)).catch(() => {});
        }
        if (this._grpcSubscribers.size === 0) this._stopFailoverWatcher();
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
      const key = `${dataId}@@${group}`;
      const state = this._grpcFailoverState.get(key) ||
        { dataId, group, useFailover: false, failoverVersion: null, content: null, md5: '' };
      return await this._getGrpcConfig(dataId, group, state);
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
   * 以 CAS 方式发布配置，仅当服务端当前配置的 md5 与 casMd5 一致时才发布成功
   * @param {String} dataId - id of the data
   * @param {String} group - group name of the data
   * @param {String} content - config value
   * @param {String} casMd5 - md5 of the expected current config content
   * @param {Object} options
   *   - {Stirng} unit - which unit you want to connect, default is current unit
   *   - {String} type - config type, e.g., 'text', 'json', 'xml', 'html', 'properties', 'yaml', etc.
   * @return {Boolean} success, false when casMd5 mismatched (gRPC transport)
   */
  async publishConfigCas(dataId, group, content, casMd5, options?: UnitOptions) {
    checkParameters(dataId, group);
    if (!casMd5) {
      throw new Error('[DataClient] publishConfigCas requires casMd5, use getConfig to fetch the current md5');
    }
    if (this._grpcConfigProxy) {
      return await this._grpcConfigProxy.publishSingle(
        dataId, group,
        this.configuration.get(ClientOptionKeys.NAMESPACE),
        content,
        options && options.type,
        casMd5
      );
    }
    const client = this.getClient(options);
    return await client.publishConfigCas(dataId, group, content, casMd5, options);
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
    this._closed = true;
    this._stopFailoverWatcher();
    this._grpcSubscribers && this._grpcSubscribers.clear();
    this._grpcFailoverState.clear();
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
    if (this._cipher) {
      this._cipher.close().catch(() => {});
    }
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

  private getGrpcSnapshotKey(dataId: string, group: string): string {
    const namespace = this.configuration.get(ClientOptionKeys.NAMESPACE) || 'default_tenant';
    const unit = this.configuration.get(ClientOptionKeys.UNIT) || CURRENT_UNIT;
    return path.join('config', encodeURIComponent(unit), encodeURIComponent(namespace),
      encodeURIComponent(group), encodeURIComponent(dataId));
  }

  private getGrpcSnapshotEncryptedDataKey(dataId: string, group: string): string {
    return this.getGrpcSnapshotKey(dataId, group) + '.encryptedDataKey';
  }

  private async getFailover(key: string): Promise<string | null> {
    const snapshot: any = this.snapshot as any;
    return typeof snapshot.getFailover === 'function' ? snapshot.getFailover(key) : null;
  }

  private async getFailoverMtime(key: string): Promise<number | null> {
    const snapshot: any = this.snapshot as any;
    return typeof snapshot.getFailoverMtime === 'function' ? snapshot.getFailoverMtime(key) : null;
  }

  private async _getGrpcConfig(dataId: string, group: string, state: GrpcFailoverState): Promise<string> {
    const key = this.getGrpcSnapshotKey(dataId, group);
    const failover = await this.getFailover(key);
    if (failover !== null) {
      state.useFailover = true;
      state.failoverVersion = await this.getFailoverMtime(key);
      state.content = failover;
      state.md5 = crypto.createHash('md5').update(failover).digest('hex');
      return failover;
    }

    return withSnapshotLock(this.snapshot, key, async () => {
      const lockedFailover = await this.getFailover(key);
      if (lockedFailover !== null) {
        state.useFailover = true;
        state.failoverVersion = await this.getFailoverMtime(key);
        state.content = lockedFailover;
        state.md5 = crypto.createHash('md5').update(lockedFailover).digest('hex');
        return lockedFailover;
      }

      state.useFailover = false;
      let raw: ConfigQueryResult;
      try {
        raw = await this._grpcConfigProxy!.getConfigRaw(dataId, group, this.configuration.get(ClientOptionKeys.NAMESPACE));
      } catch (err) {
        const cached = await this.snapshot.get(key);
        if (cached === null) throw err;
        const edk = await this.snapshot.get(this.getGrpcSnapshotEncryptedDataKey(dataId, group));
        const plaintext = await this._cipher.decrypt(dataId, group, cached, edk || undefined);
        this.throwError(err);
        state.content = plaintext;
        state.md5 = crypto.createHash('md5').update(cached).digest('hex');
        return plaintext;
      }

      state.md5 = raw.content ? crypto.createHash('md5').update(raw.content).digest('hex') : '';
      if (!raw.content) {
        await this.snapshot.delete(key);
        await this.snapshot.delete(this.getGrpcSnapshotEncryptedDataKey(dataId, group));
        state.content = '';
        return '';
      }
      await this.snapshot.save(key, raw.content);
      const edkKey = this.getGrpcSnapshotEncryptedDataKey(dataId, group);
      if (raw.encryptedDataKey) await this.snapshot.save(edkKey, raw.encryptedDataKey);
      else await this.snapshot.delete(edkKey);
      const plaintext = await this._cipher.decrypt(dataId, group, raw.content, raw.encryptedDataKey);
      state.content = plaintext;
      return plaintext;
    });
  }

  private _hasGrpcListener(key: string, listener: Function): boolean {
    const listeners = this._grpcSubscribers && this._grpcSubscribers.get(key);
    return !!listeners && listeners.indexOf(listener) >= 0 && !this._closed;
  }

  private _handleGrpcConfigChanged(evt: { dataId: string; group: string }): void {
    const key = `${evt.dataId}@@${evt.group}`;
    this._grpcOpQueue.run(key, async () => {
      const state = this._grpcFailoverState.get(key);
      const listeners = this._grpcSubscribers && this._grpcSubscribers.get(key);
      if (!state || !listeners || listeners.length === 0 || state.useFailover) return;
      const previous = state.content;
      const content = await this._getGrpcConfig(evt.dataId, evt.group, state);
      const current = this._grpcSubscribers && this._grpcSubscribers.get(key);
      if (!current || current.length === 0 || state.useFailover) return;
      if (content !== previous) {
        state.content = content;
        for (const fn of current) fn(content);
      }
    }).catch(err => this.throwError(err));
  }

  private _startFailoverWatcher(): void {
    if (this._failoverWatcher || !this._grpcSubscribers) return;
    this._failoverWatcher = setInterval(() => this._checkGrpcFailover().catch(err => this.throwError(err)), 10000);
  }

  private _stopFailoverWatcher(): void {
    if (this._failoverWatcher) clearInterval(this._failoverWatcher);
    this._failoverWatcher = null;
  }

  private async _checkGrpcFailover(): Promise<void> {
    if (this._closed || !this._grpcSubscribers) return;
    for (const [key, state] of this._grpcFailoverState.entries()) {
      const snapshotKey = this.getGrpcSnapshotKey(state.dataId, state.group);
      const mtime = await this.getFailoverMtime(snapshotKey);
      if (mtime !== null) {
        if (!state.useFailover || state.failoverVersion !== mtime) {
          const content = await this.getFailover(snapshotKey);
          if (content === null) continue;
          this._grpcOpQueue.run(key, async () => {
            const current = this._grpcSubscribers && this._grpcSubscribers.get(key);
            if (!current || current.length === 0) return;
            state.useFailover = true;
            state.failoverVersion = mtime;
            if (state.content !== content) {
              state.content = content;
              state.md5 = crypto.createHash('md5').update(content).digest('hex');
              for (const fn of current) fn(content);
            }
          }).catch(err => this.throwError(err));
        }
      } else if (state.useFailover) {
        this._grpcOpQueue.run(key, async () => {
          state.useFailover = false;
          state.failoverVersion = null;
          const current = this._grpcSubscribers && this._grpcSubscribers.get(key);
          if (!current || current.length === 0) return;
          const previous = state.content;
          const content = await this._getGrpcConfig(state.dataId, state.group, state);
          if (previous !== content) {
            state.content = content;
            for (const fn of current) fn(content);
          }
        }).catch(err => this.throwError(err));
      }
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
