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
import { ConfigCipher, createConfigCipher } from './cipher';
import { readConfigWithFailover, withSnapshotLock, ConfigReadResult } from './disaster_recovery';
import { KeyedAsyncQueue } from './keyed_queue';
import { GrpcConnection, GrpcTransportClient } from 'nacos-common';
import * as assert from 'assert';
import * as path from 'path';

const Base = require('sdk-base');

/** gRPC 模式下本地容灾文件的轮询检查间隔（毫秒）。 */
const FAILOVER_CHECK_INTERVAL = 10000;

/** gRPC 订阅项的本地容灾状态（对齐 Java SDK CacheData 的 isUseLocalConfigInfo / localConfigLastModified）。 */
interface GrpcFailoverState {
  dataId: string;
  group: string;
  useFailover: boolean;
  failoverVersion: number | null;
  content: string | null;
  listenerRegistered: boolean;
  // 远端监听注册所需的 md5（服务端原文/密文计算）；注册失败后由 watcher 据此重试 addListener
  listenerMd5: string | null;
}

export class DataClient extends Base implements BaseClient {

  private clients: Map<string, IClientWorker>;
  private configuration: IConfiguration;
  private cipher: ConfigCipher;
  protected snapshot: ISnapshot;
  protected serverMgr: IServerListManager | null;
  protected httpAgent;
  private _transport: 'grpc' | 'http';
  private _grpcConnection: GrpcConnection | null;
  private _grpcTransportClient: GrpcTransportClient | null;
  private _grpcConfigProxy: GrpcConfigProxy | null;
  private _grpcSubscribers: Map<string, Function[]> | null;
  private _grpcFailoverState: Map<string, GrpcFailoverState> | null;
  private _failoverWatcher: any;
  private _grpcOpQueue: KeyedAsyncQueue | null;
  private _closed: boolean;
  private _failoverChecking: boolean;

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
    this._grpcFailoverState = null;
    this._failoverWatcher = null;
    this._grpcOpQueue = null;
    this._closed = false;
    this._failoverChecking = false;

    this.snapshot = this.getSnapshot();
    (<any>this.snapshot).on('error', err => this.throwError(err));

    if (this._transport === 'grpc') {
      // gRPC mode: skip ServerListManager and HttpAgent; set up gRPC stack
      this.serverMgr = null;
      this.httpAgent = null;
      // gRPC 模式下 KMS 信封加解密由 DataClient 直接负责（HTTP 模式在 ClientWorker 内部完成）
      this.cipher = createConfigCipher(this.configuration);

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

      this._grpcOpQueue = new KeyedAsyncQueue();

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
    // 已关闭：subscribe 直接 no-op —— 不新增 listener / 不启动 watcher / 不发起 get / addListener
    if (this._closed) {
      return this;
    }

    if (this._grpcConfigProxy) {
      const key = `${dataId}@@${group}`;
      if (!this._grpcSubscribers) {
        this._grpcSubscribers = new Map();
        this._grpcConfigProxy.on('configChanged', (evt) => {
          this._onGrpcConfigChanged(evt);
        });
      }
      const listeners = this._grpcSubscribers.get(key) || [];
      listeners.push(listener);
      this._grpcSubscribers.set(key, listeners);
      // 登记本地容灾状态并启动 failover 文件热切换轮询（对齐 Java checkLocalConfig）
      if (!this._grpcFailoverState) {
        this._grpcFailoverState = new Map();
      }
      if (!this._grpcFailoverState.has(key)) {
        // listenerMd5 初始置空串（''）而非 null：空 md5 是 Nacos 监听注册的合法语义（本地无内容），
        // 使初始 fetch 失败（服务端异常且无快照、未走到 addListener）时 watcher 仍能据此重试注册，
        // 服务端恢复后即可收到变更推送；初始 fetch 成功后再替换为服务端原文计算的真实 md5。
        this._grpcFailoverState.set(key, { dataId, group, useFailover: false, failoverVersion: null, content: null, listenerRegistered: false, listenerMd5: '' });
      }
      this._startFailoverWatcher();
      // 初始化订阅（带容灾拉取 + 单飞注册远端监听）全程走 per-key operation queue，
      // await 后校验状态身份与监听器，退订 / 关闭后不回调、不残留远端监听
      const state = this._grpcFailoverState.get(key)!;
      this._grpcOpQueue!.run(key, () => this._initGrpcSubscription(key, state, listener)).catch(() => {});
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
            if (this._grpcFailoverState) { this._grpcFailoverState.delete(key); }
            // 同步失活已完成；远端 remove 入队，排在旧 init 的 add 之后、新 subscribe 的 init 之前
            if (this._grpcOpQueue) {
              this._grpcOpQueue.run(key, () => this._grpcConfigProxy!.removeListener(dataId, group)).catch(() => {});
            }
          }
        } else {
          this._grpcSubscribers.delete(key);
          if (this._grpcFailoverState) { this._grpcFailoverState.delete(key); }
          // 远端 remove 入队，保持同 key add/remove FIFO 顺序
          if (this._grpcOpQueue) {
            this._grpcOpQueue.run(key, () => this._grpcConfigProxy!.removeListener(dataId, group)).catch(() => {});
          }
        }
        // 没有订阅项后停止 failover 文件轮询
        if (this._grpcSubscribers.size === 0) {
          this._stopFailoverWatcher();
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
      // 带本地容灾读取：failover > 服务端 > 快照（对齐 Java SDK 读优先级）
      const { content, encryptedDataKey, source } = await this._getConfigWithCache(dataId, group, this.configuration.get(ClientOptionKeys.NAMESPACE));
      if (content === null) {
        return '';
      }
      // 用户边界：cipher dataId 解密后返回明文；failover 明文直接透传不解密
      return await this.cipher.decryptIfNeeded(dataId, content, encryptedDataKey, source === 'failover');
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
      // 用户边界：cipher dataId 先加密，密文与 encryptedDataKey 经 additionMap 发布
      const encryptResult = await this.cipher.encryptIfNeeded(dataId, content);
      return await this._grpcConfigProxy.publishSingle(
        dataId, group,
        this.configuration.get(ClientOptionKeys.NAMESPACE),
        encryptResult.content,
        options && options.type,
        undefined,
        encryptResult.encryptedDataKey
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
      // 用户边界：cipher dataId 先加密，密文与 encryptedDataKey 经 additionMap 发布（与 publishSingle 一致）
      const encryptResult = await this.cipher.encryptIfNeeded(dataId, content);
      return await this._grpcConfigProxy.publishSingle(
        dataId, group,
        this.configuration.get(ClientOptionKeys.NAMESPACE),
        encryptResult.content,
        options && options.type,
        casMd5,
        encryptResult.encryptedDataKey
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
      const key = this._getSnapshotKey(dataId, group);
      // 与 getConfig 共用快照锁：远端 remove + 本地清理（content + edk）串行，避免在途 get 晚到后复活快照
      return await withSnapshotLock(this.snapshot, key, async () => {
        const removed = await this._grpcConfigProxy!.remove(dataId, group, this.configuration.get(ClientOptionKeys.NAMESPACE));
        // 仅当服务端确认删除成功（true）才清理本地快照；失败（false）保留快照，避免误删本地容灾数据
        if (removed !== true) {
          return false;
        }
        // 同步清理本地快照与 encryptedDataKey 缓存，避免服务端已删除的配置残留在缓存里（与 HTTP 模式一致）
        await this.snapshot.delete(key);
        await this.snapshot.delete(this._getEncryptedDataKeySnapshotKey(dataId, group));
        return removed;
      });
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
    if (this._closed) {
      return;
    }
    this._closed = true;
    this._stopFailoverWatcher();
    if (this._grpcSubscribers) {
      this._grpcSubscribers.clear();
    }
    if (this._grpcFailoverState) {
      this._grpcFailoverState.clear();
    }
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
   * 逐个通知 gRPC 监听器：单个监听器抛异常不得影响其余监听器，也不得阻断 SDK
   * 内部后续流程（如初始回调抛错后仍需完成远端 listener 注册）。异常统一经
   * throwError 以 'error' 事件上报，避免被上层 .catch(() => {}) 静默吞掉。
   * @param listeners - 当前 key 的监听器列表
   * @param content - 通知内容
   * @private
   */
  private _notifyGrpcListeners(listeners: Function[], content: string): void {
    for (const fn of listeners) {
      try {
        const ret: any = fn(content);
        // 监听器可能是 async：其返回的 rejected promise 不会被 try/catch 捕获，
        // 需显式挂 rejection 分支路由到 throwError，避免泄漏为 unhandledRejection 而击垮进程
        if (ret && typeof ret.then === 'function') {
          ret.then(undefined, (err: Error) => this.throwError(err));
        }
      } catch (err) {
        this.throwError(err);
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

  /**
   * 与 ClientWorker.getSnapshotKeyEncoded 一致的快照 key 编码，
   * 保证 HTTP / gRPC 两种传输共享同一份本地缓存与容灾文件。
   */
  private _getSnapshotKey(dataId: string, group: string): string {
    const tenant = this.configuration.get(ClientOptionKeys.NAMESPACE) || 'default_tenant';
    const unit = this.configuration.get(ClientOptionKeys.UNIT) || CURRENT_UNIT;
    return path.join(
      'config',
      encodeURIComponent(unit),
      encodeURIComponent(tenant),
      encodeURIComponent(group),
      encodeURIComponent(dataId)
    );
  }

  /**
   * encryptedDataKey 的本地持久化 key，与内容快照（'config/' 前缀）并行的独立命名空间
   * （'edk/' 前缀），与 ClientWorker.getEncryptedDataKeySnapshotKey 保持一致，HTTP / gRPC 共享。
   */
  private _getEncryptedDataKeySnapshotKey(dataId: string, group: string): string {
    return path.join('edk', this._getSnapshotKey(dataId, group));
  }

  /**
   * gRPC 模式带本地容灾的读取（对齐 Java SDK 读优先级 failover > server > snapshot）：
   * - 用户手工维护的 failover 文件存在时优先返回；
   * - 否则查询服务端，成功后落快照（空/缺失内容由 Snapshot.save 统一按删除处理，等价 Java saveSnapshot(null)）；
   * - 服务端异常时回退本地快照，快照也没有才抛错。
   * 返回原始内容（cipher dataId 为密文）与随行 encryptedDataKey，解密只在用户边界进行；
   * content/EDK 的读写全部由 readConfigWithFailover 在共享快照锁内串行执行，成对写入 / 成对删除。
   */
  private async _getConfigWithCache(dataId: string, group: string, tenant?: string): Promise<ConfigReadResult> {
    const key = this._getSnapshotKey(dataId, group);
    const edkKey = this._getEncryptedDataKeySnapshotKey(dataId, group);
    return await readConfigWithFailover({
      snapshotKey: key,
      encryptedDataKeySnapshotKey: edkKey,
      isCipher: this.cipher.isCipherDataId(dataId),
      snapshot: this.snapshot,
      fetchFromServer: () => this._grpcConfigProxy!.getConfig(dataId, group, tenant),
      readSnapshotFallback: () => this.snapshot.get(key),
      onServerError: err => this.throwError(err),
      clearSnapshot: async () => {
        await this.snapshot.delete(key);
        await this.snapshot.delete(edkKey);
      },
    });
  }

  /**
   * gRPC 服务端变更推送处理（对齐 Java CacheData：同 key 串行、旧响应不覆盖新值）。
   * 每个事件按到达顺序进入 per-key operation queue，await 后重新校验状态身份与监听器。
   */
  private _onGrpcConfigChanged(evt: { dataId: string; group: string; tenant?: string }): void {
    const key = `${evt.dataId}@@${evt.group}`;
    if (!this._grpcOpQueue) {
      return;
    }
    this._grpcOpQueue.run(key, async () => {
      const state = this._grpcFailoverState ? this._grpcFailoverState.get(key) : undefined;
      const listeners = this._grpcSubscribers ? this._grpcSubscribers.get(key) : undefined;
      if (this._closed || !state || !listeners || listeners.length === 0) {
        return;
      }
      // 本地容灾模式下忽略服务端推送（local config wins）
      if (state.useFailover) {
        return;
      }
      let rawContent = '';
      let encryptedDataKey: string | undefined;
      let isFailover = false;
      try {
        const result = await this._getConfigWithCache(evt.dataId, evt.group);
        rawContent = result.content === null ? '' : result.content;
        encryptedDataKey = result.encryptedDataKey;
        isFailover = result.source === 'failover';
      } catch (err) {
        this.throwError(err);
        return;
      }
      // await 期间可能已关闭 / 退订 / 切入 failover：重新校验后再提交
      if (!this._isGrpcStateActive(key, state) || state.useFailover) {
        return;
      }
      // 用户边界：密文解密后再回调监听器（解密可能触发 KMS，异步）
      let plainContent = '';
      try {
        plainContent = await this.cipher.decryptIfNeeded(evt.dataId, rawContent, encryptedDataKey, isFailover);
      } catch (err) {
        // 解密失败（KMS 不可用 / content 与 edk 错配）：经 throwError 上报为 'error' 事件，
        // 避免被外层 op queue 的 .catch(() => {}) 静默吞掉；不回调监听器以免下发不可信内容
        this.throwError(err);
        return;
      }
      if (!this._isGrpcStateActive(key, state) || state.useFailover) {
        return;
      }
      const current = this._grpcSubscribers ? this._grpcSubscribers.get(key) : undefined;
      if (!current || current.length === 0) {
        return;
      }
      state.content = plainContent;
      this._notifyGrpcListeners(current, plainContent);
    }).catch(() => {});
  }

  /**
   * subscribe 初始化：带容灾拉取当前内容并单飞注册远端监听。
   * 全程在 per-key operation queue 内执行，await 后校验状态身份与监听器是否仍注册；
   * 关闭或退订后不得回调，远端 add/remove 也按同 key FIFO 串行。
   */
  private async _initGrpcSubscription(key: string, state: GrpcFailoverState, listener: Function): Promise<void> {
    if (!this._isGrpcStateActive(key, state) || !this._hasGrpcListener(key, listener)) {
      return;
    }
    let rawContent = '';
    let encryptedDataKey: string | undefined;
    let isFailover = false;
    try {
      const result = await this._getConfigWithCache(state.dataId, state.group);
      rawContent = result.content === null ? '' : result.content;
      encryptedDataKey = result.encryptedDataKey;
      isFailover = result.source === 'failover';
    } catch (err) {
      this.throwError(err);
      return;
    }
    if (!this._isGrpcStateActive(key, state) || !this._hasGrpcListener(key, listener)) {
      return;
    }
    // 用户边界：初始内容解密后再回调监听器（解密可能触发 KMS，异步）
    let plainContent = '';
    try {
      plainContent = await this.cipher.decryptIfNeeded(state.dataId, rawContent, encryptedDataKey, isFailover);
    } catch (err) {
      // 解密失败（KMS 不可用 / content 与 edk 错配）：经 throwError 上报为可观测错误，
      // 不用不可信内容回调监听器；仍继续注册远端监听，待服务端 / KMS 恢复后经推送重试
      this.throwError(err);
    }
    if (!this._isGrpcStateActive(key, state) || !this._hasGrpcListener(key, listener)) {
      return;
    }
    if (plainContent) {
      state.content = plainContent;
      this._notifyGrpcListeners([ listener ], plainContent);
    }
    // 存在容灾文件则读取其内容并进入 failover 模式；仅当与已读内容不同才再次通知（去重）
    const snapshotKey = this._getSnapshotKey(state.dataId, state.group);
    const mtime = await this.snapshot.getFailoverMtime(snapshotKey);
    if (!this._isGrpcStateActive(key, state) || !this._hasGrpcListener(key, listener)) {
      return;
    }
    if (mtime !== null) {
      const failoverContent = await this.snapshot.getFailover(snapshotKey);
      if (!this._isGrpcStateActive(key, state) || !this._hasGrpcListener(key, listener)) {
        return;
      }
      if (failoverContent !== null) {
        state.useFailover = true;
        state.failoverVersion = mtime;
        if (failoverContent !== state.content) {
          state.content = failoverContent;
          this._notifyGrpcListeners([ listener ], failoverContent);
        }
      }
    }
    // 单飞注册远端监听：同 key 只注册一次；md5 基于服务端原始内容（cipher 为密文），与服务端探针一致。
    // 失败保留 listenerMd5 与 listenerRegistered=false，交由 watcher 每轮重试；
    // 失活补偿 remove 由 unSubscribe/close 经 op queue 处理，避免同 key 双重 remove。
    if (!state.listenerRegistered) {
      const crypto = require('crypto');
      const md5 = rawContent ? crypto.createHash('md5').update(rawContent).digest('hex') : '';
      state.listenerMd5 = md5;
      state.listenerRegistered = true;
      try {
        await this._grpcConfigProxy!.addListener(state.dataId, state.group, md5);
      } catch (err) {
        state.listenerRegistered = false;
      }
    }
  }

  /** 当前 state 是否仍然"活跃"：未关闭且仍是该 key 登记的同一对象（lifecycle identity）。 */
  private _isGrpcStateActive(key: string, state: GrpcFailoverState): boolean {
    return !this._closed && !!this._grpcFailoverState && this._grpcFailoverState.get(key) === state;
  }

  /** 指定 listener 是否仍在该 key 的订阅列表中。 */
  private _hasGrpcListener(key: string, listener: Function): boolean {
    if (!this._grpcSubscribers) {
      return false;
    }
    const listeners = this._grpcSubscribers.get(key);
    return !!listeners && listeners.indexOf(listener) >= 0;
  }

  /**
   * gRPC 模式下的本地容灾文件热切换（对齐 Java SDK ClientWorker.checkLocalConfig）：
   * - 文件新建/变更 → 切到容灾内容并通知监听器；
   * - 文件删除 → 回退服务端内容并通知监听器。
   * gRPC 无长轮询循环，由 _failoverWatcher 定时驱动。
   */
  private async _checkGrpcLocalFailover(): Promise<void> {
    if (!this._grpcSubscribers || !this._grpcFailoverState || this._closed) {
      return;
    }
    // 防重入：上一轮未结束时直接跳过（对齐 Java 单线程 listenExecutor）
    if (this._failoverChecking) {
      return;
    }
    this._failoverChecking = true;
    try {
      const keys = Array.from(this._grpcSubscribers.keys());
      for (const key of keys) {
        if (!this._grpcOpQueue) {
          break;
        }
        // 每个 key 的状态读取 / 服务端 fetch / 状态提交 / 回调整体串行
        await this._grpcOpQueue.run(key, () => this._checkGrpcFailoverForKey(key));
      }
    } finally {
      this._failoverChecking = false;
    }
  }

  /**
   * 单个 key 的容灾文件热切换检查；各 await 后重新校验 state identity，
   * 关闭 / 退订后不得晚到回调。
   */
  private async _checkGrpcFailoverForKey(key: string): Promise<void> {
    if (this._closed || !this._grpcSubscribers || !this._grpcFailoverState) {
      return;
    }
    const listeners = this._grpcSubscribers.get(key);
    const state = this._grpcFailoverState.get(key);
    if (!state || !listeners || listeners.length === 0) {
      return;
    }
    // addListener 失败重试：active 且有监听但尚未注册成功的 key 每轮重试一次；
    // 幂等覆盖 _listenContexts 并重发，成功置 true，失败保持 false 待下一轮。
    if (!state.listenerRegistered && state.listenerMd5 !== null) {
      state.listenerRegistered = true;
      try {
        await this._grpcConfigProxy!.addListener(state.dataId, state.group, state.listenerMd5);
      } catch (err) {
        state.listenerRegistered = false;
      }
    }
    const snapshotKey = this._getSnapshotKey(state.dataId, state.group);
    const mtime = await this.snapshot.getFailoverMtime(snapshotKey);
    if (!this._isGrpcStateActive(key, state)) {
      return;
    }

    if (mtime === null) {
      // 容灾文件被删除：切回服务端内容——仅在成功拉取后清除 failover 标记，
      // 失败则保留 useFailover 以便下一轮 watcher 重试恢复
      if (state.useFailover) {
        try {
          const result = await this._getConfigWithCache(state.dataId, state.group);
          const encryptedDataKey = result.encryptedDataKey;
          if (!this._isGrpcStateActive(key, state)) {
            return;
          }
          // 仅在服务端确实恢复（source==='server'）时清除 failover 并通知；
          // 快照回退（source==='snapshot'）保持 failover 状态，交由下一轮 watcher 继续请求服务端
          if (result.source !== 'server') {
            return;
          }
          const content = result.content === null ? '' : result.content;
          state.useFailover = false;
          state.failoverVersion = null;
          // 用户边界：切回服务端内容需解密后再对比 / 通知
          const plainContent = await this.cipher.decryptIfNeeded(state.dataId, content, encryptedDataKey);
          if (!this._isGrpcStateActive(key, state)) {
            return;
          }
          if (plainContent !== state.content) {
            state.content = plainContent;
            const current = this._grpcSubscribers.get(key) || [];
            this._notifyGrpcListeners(current, plainContent);
          }
        } catch (err) {
          this.throwError(err);
        }
      }
      return;
    }

    if (!state.useFailover || state.failoverVersion !== mtime) {
      const content = await this.snapshot.getFailover(snapshotKey);
      if (!this._isGrpcStateActive(key, state)) {
        return;
      }
      if (content === null) {
        return;
      }
      state.useFailover = true;
      state.failoverVersion = mtime;
      if (content !== state.content) {
        state.content = content;
        const current = this._grpcSubscribers.get(key) || [];
        this._notifyGrpcListeners(current, content);
      }
    }
  }

  private _startFailoverWatcher(): void {
    if (this._closed || this._failoverWatcher || this._transport !== 'grpc') {
      return;
    }
    this._failoverWatcher = setInterval(() => {
      this._checkGrpcLocalFailover().catch(err => this.throwError(err));
    }, FAILOVER_CHECK_INTERVAL);
    // 不阻止进程正常退出
    if (this._failoverWatcher.unref) {
      this._failoverWatcher.unref();
    }
  }

  private _stopFailoverWatcher(): void {
    if (this._failoverWatcher) {
      clearInterval(this._failoverWatcher);
      this._failoverWatcher = null;
    }
  }

}
