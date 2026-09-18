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
import { API_ROUTE, ClientOptionKeys, NacosHttpError, IClientWorker, IConfiguration, ISnapshot, UnitOptions } from './interface';
import { LINE_SEPARATOR, WORD_SEPARATOR } from './const';
import { getMD5String } from './utils';
import * as path from 'path';
import * as is from 'is-type-of';
import { HttpAgent } from './http_agent';
import { ConfigCipher, createConfigCipher, ENCRYPTED_DATA_KEY_HEADER, ENCRYPTED_DATA_KEY_PARAM } from './cipher';
import { readConfigWithFailover, withSnapshotLock } from './disaster_recovery';

const Base = require('sdk-base');
const gather = require('co-gather');
const { sleep } = require('mz-modules');

/** 服务端返回的原始配置（cipher dataId 为密文）以及随行的 encryptedDataKey。 */
interface ConfigFetchResult {
  content: string | null;
  encryptedDataKey?: string;
}

export class ClientWorker extends Base implements IClientWorker {

  private uuid = (Math.random() * 1000).toFixed(0);
  private isClose = false;
  private isLongPulling = false;
  private subscriptions = new Map();
  private cipher: ConfigCipher;
  protected loggerDomain = 'Nacos';
  private debugPrefix = this.loggerDomain.toLowerCase();
  private debug = require('debug')(`${this.debugPrefix}:${process.pid}:ins-${this.uuid}:client_worker`);
  protected apiRoutePath: API_ROUTE = {
    GET: `/v1/cs/configs`,
    BATCH_GET: `/v1/cs/configs`,
    BATCH_QUERY: `/v1/cs/configs`,
    PUBLISH: `/v1/cs/configs`,
    PUBLISH_ALL: `/v1/cs/configs`,
    REMOVE: `/v1/cs/configs`,
    REMOVE_ALL: `/v1/cs/configs`,
    LISTENER: '/v1/cs/configs/listener'
  };
  protected listenerDataKey = 'Listening-Configs';

  constructor(options) {
    super(options);
    // 同一个key可能会被多次订阅，避免不必要的 `warning`
    this.setMaxListeners(100);
    this.cipher = createConfigCipher(this.configuration);
    this.ready(true);
    this.debug('client worker start');
  }

  get configuration(): IConfiguration {
    return this.options.configuration;
  }

  get appName(): string {
    return this.configuration.get(ClientOptionKeys.APPNAME);
  }

  get snapshot(): ISnapshot {
    return this.configuration.get(ClientOptionKeys.SNAPSHOT);
  }

  get unit(): string {
    return this.configuration.get(ClientOptionKeys.UNIT);
  }

  get httpAgent(): HttpAgent {
    return this.configuration.get(ClientOptionKeys.HTTP_AGENT);
  }

  get namespace(): string {
    return this.configuration.get(ClientOptionKeys.NAMESPACE);
  }

  get defaultEncoding(): string {
    return this.configuration.get(ClientOptionKeys.DEFAULT_ENCODING) || 'utf8';
  }

  close() {
    this.debug('client worker closing, isClose: %s, subscriptions count: %d', this.isClose, this.subscriptions.size);
    this.isClose = true;
    this.removeAllListeners();
    this.subscriptions.clear();
    this.debug('client worker closed');
  }

  /**
   * 订阅
   * @param {Object} info
   *   - {String} dataId - id of the data you want to subscribe
   *   - {String} [group] - group name of the data
   * @param {Function} listener - listener
   */
  subscribe(info, listener) {
    this.debug('calling subscribe, dataId: %s, group: %s', info.dataId, info.group);
    const { dataId, group } = info;
    const key = this.formatKey(info);
    this.on(key, listener);

    let item = this.subscriptions.get(key);
    if (!item) {
      item = {
        dataId,
        group,
        md5: null,
        content: null,
      };
      this.subscriptions.set(key, item);

      (async () => {
        try {
          await this.syncConfigs([ item ]);
          await this.startLongPulling();
        } catch (err) {
          this._error(err);
        }
      })();
    } else if (!is.nullOrUndefined(item.md5)) {
      // 用户边界：缓存中为密文时先解密再回调监听器
      process.nextTick(async () => {
        try {
          listener(await this.cipher.decryptIfNeeded(item.dataId, item.content, item.encryptedDataKey));
        } catch (err) {
          this._error(err);
        }
      });
    }
    return this;
  }

  /**
   * 同步配置
   * @param {Array} list - 需要同步的配置列表
   * @return {void}
   */
  private async syncConfigs(list) {
    // 拉取原始内容（cipher dataId 为密文），md5 与缓存均基于密文，保证长轮询探针与服务端一致
    const tasks = list.map(({ dataId, group }) => this.getConfigInner(dataId, group));
    const results = await gather(tasks, 5);
    for (let i = 0, len = results.length; i < len; i++) {
      const key = this.formatKey(list[ i ]);
      const item = this.subscriptions.get(key);
      const result = results[ i ];
      if (!item) {
        this.debug('item %s not exist', key); // maybe removed by user
        continue;
      }
      if (result.isError) {
        const err: NacosHttpError = new Error(`[${this.loggerDomain}#ClientWorker] getConfig failed for dataId: ${item.dataId}, group: ${item.group}, error: ${result.error}`);
        err.name = `${this.loggerDomain}SyncConfigError`;
        err.dataId = item.dataId;
        err.group = item.group;
        this._error(err);
        continue;
      }

      const { content, encryptedDataKey } = result.value;
      const md5 = getMD5String(content, this.defaultEncoding);
      // 防止应用启动时，并发请求，导致同一个 key 重复触发
      if (item.md5 !== md5) {
        item.md5 = md5;
        item.content = content;
        item.encryptedDataKey = encryptedDataKey;
        // 异步化，避免处理逻辑异常影响到 nacos 内部
        // 这里将获取的数据直接事件的方式返回给 subscribe 一开始监听的地方
        this.debug('get new data and callback to listener', item);
        setImmediate(async () => {
          try {
            // 用户边界：密文解密后再回调监听器
            this.emit(key, await this.cipher.decryptIfNeeded(item.dataId, content, encryptedDataKey));
          } catch (err) {
            this._error(err);
          }
        });
      }
    }
  }

  /**
   * 开启长轮询
   * @return {void}
   * @private
   */
  private async startLongPulling() {
    // 防止重入
    if (this.isLongPulling) {
      return;
    }
    this.isLongPulling = true;

    (async () => {
      try {
        while (!this.isClose && this.subscriptions.size > 0) {
          try {
            await this.checkServerConfigInfo();
          } catch (err) {
            err.name = `${this.loggerDomain}LongPullingError`;
            this._error(err);
            await sleep(2000);
          }
        }
        this.isLongPulling = false;
      } catch (err) {
        this.isLongPulling = false;
        this._error(err);
      }
    })();
  }

  private async checkServerConfigInfo() {
    this.debug('start to check update config list');
    if (this.subscriptions.size === 0) {
      return;
    }

    // 每轮先检查本地 failover 文件的创建/删除/变更（对齐 Java SDK checkLocalConfig）
    await this.checkLocalFailover();

    const beginTime = Date.now();
    const tenant = this.namespace;
    const probeUpdate = [];
    for (const item of this.subscriptions.values()) {
      // 处于 failover 模式的 key 使用本地容灾内容，跳过服务端探测
      // （对齐 Java SDK executeConfigListen: if (cache.isUseLocalConfigInfo()) continue）
      if (item.useFailover) {
        continue;
      }
      const { dataId, group, md5 } = item;
      this.debug('calling startLongPulling(checkServerConfigInfo), dataId: %s, group: %s', dataId, group);
      probeUpdate.push(dataId, WORD_SEPARATOR);
      probeUpdate.push(group, WORD_SEPARATOR);

      if (tenant) {
        probeUpdate.push(md5, WORD_SEPARATOR);
        probeUpdate.push(tenant, LINE_SEPARATOR);
      } else {
        probeUpdate.push(md5, LINE_SEPARATOR);
      }
    }

    // 所有订阅项都处于本地 failover：本轮无服务端探针，跳过 HTTP listener API；
    // 但仍需 bounded delay，避免 startLongPulling while 循环空转占用 CPU（对齐 Java 无探针时不空转）
    if (probeUpdate.length === 0) {
      await this.waitBeforeNextLocalCheck();
      return;
    }

    const postData = {};
    // 开启权限验证后需要携带租户，否则没有权限
    if (tenant) {
      Object.assign(postData, { tenant })
    }
    postData[ this.listenerDataKey ] = probeUpdate.join('');
    const content = await this.httpAgent.request(this.apiRoutePath.LISTENER, {
      method: 'POST',
      data: postData,
      headers: {
        'Long-Pulling-Timeout': '30000',
      },
      timeout: 40000, // 超时时间比longPullingTimeout稍大一点，避免主动超时异常
    });
    this.debug('long pulling takes %ds', (Date.now() - beginTime) / 1000);
    const updateList = this.parseUpdateDataIdResponse(content);
    // 说明这个 id 列表有更新
    if (updateList && updateList.length) {
      this.debug('data has changed and will be sync', updateList);
      // 去同步这个 ip 列表的配置
      await this.syncConfigs(updateList);
    }
  }

  /**
   * failover 全量命中导致本轮无服务端探针时的兜底等待，
   * 防止 startLongPulling while 循环空转占用 CPU。抽成独立方法便于测试替换。
   * @private
   */
  private async waitBeforeNextLocalCheck(): Promise<void> {
    await sleep(2000);
  }

  /**
   * 检查所有订阅项的本地 failover 文件状态（对齐 Java SDK checkLocalConfig）：
   * - 文件新建 → 切换到 failover 内容并通知监听器
   * - 文件删除 → 切回服务端配置
   * - 文件变更（mtime 变化）→ 重新加载并通知监听器
   * @private
   */
  private async checkLocalFailover() {
    for (const [key, item] of this.subscriptions.entries()) {
      const failoverKey = this.getSnapshotKeyEncoded(item.dataId, item.group);
      const mtime = await this.snapshot.getFailoverMtime(failoverKey);

      if (mtime === null) {
        if (item.useFailover) {
          item.useFailover = false;
          item.failoverVersion = null;
          this.debug('[failover-change] failover file deleted, dataId: %s, group: %s', item.dataId, item.group);
        }
        continue;
      }

      if (!item.useFailover || item.failoverVersion !== mtime) {
        const content = await this.snapshot.getFailover(failoverKey);
        if (content === null) {
          continue;
        }
        const isNew = !item.useFailover;
        item.useFailover = true;
        item.failoverVersion = mtime;
        const md5 = getMD5String(content, this.defaultEncoding);
        if (item.md5 !== md5) {
          item.md5 = md5;
          item.content = content;
          this.debug('[failover-change] failover file %s, dataId: %s, group: %s, md5: %s',
            isNew ? 'created' : 'changed', item.dataId, item.group, md5);
          setImmediate(() => this.emit(key, content));
        }
      }
    }
  }

  // 解析 nacos 返回的 long pulling 结果
  private parseUpdateDataIdResponse(content) {
    const updateList = [];
    decodeURIComponent(content)
      .split(LINE_SEPARATOR)
      .forEach(dataIdAndGroup => {
        if (dataIdAndGroup) {
          const keyArr = dataIdAndGroup.split(WORD_SEPARATOR);
          if (keyArr.length >= 2) {
            const dataId = keyArr[ 0 ];
            const group = keyArr[ 1 ];
            updateList.push({
              dataId,
              group,
            });
          }
        }
      });
    return updateList;
  }

  /**
   * 退订
   * @param {Object} info
   *   - {String} dataId - id of the data you want to subscribe
   *   - {String} group - group name of the data
   * @param {Function} listener - listener
   */
  unSubscribe(info, listener?) {
    const key = this.formatKey(info);
    if (listener) {
      this.removeListener(key, listener);
    } else {
      this.removeAllListeners(key);
    }
    // 没有人订阅了，从长轮询里拿掉
    if (this.listeners(key).length === 0) {
      this.subscriptions.delete(key);
    }
    return this;
  }

  /**
   * 默认异常处理
   * @param {Error} err - 异常
   * @return {void}
   * @private
   */
  _error(err) {
    if (err) {
      setImmediate(() => this.emit('error', err));
    }
  }

  private formatKey(info) {
    return `${info.dataId}@${info.group}@${this.unit}`;
  }

  /**
   * Get snapshot key with URL encoding for cross-platform compatibility
   * Encodes special characters (especially ':' for Windows) in group/dataId/tenant/unit
   */
  private getSnapshotKeyEncoded(dataId: string, group: string, tenant?: string) {
    tenant = tenant || this.namespace || 'default_tenant';
    const encodedUnit = encodeURIComponent(this.unit);
    const encodedTenant = encodeURIComponent(tenant);
    const encodedGroup = encodeURIComponent(group);
    const encodedDataId = encodeURIComponent(dataId);
    return path.join('config', encodedUnit, encodedTenant, encodedGroup, encodedDataId);
  }

  /**
   * Get legacy snapshot key without URL encoding (for backward compatibility)
   * @deprecated Only used for migration fallback
   */
  private getSnapshotKeyLegacy(dataId: string, group: string, tenant?: string) {
    tenant = tenant || this.namespace || 'default_tenant';
    return path.join('config', this.unit, tenant, group, dataId);
  }

  /**
   * Get snapshot content with transparent backward compatibility
   * - Returns cached content from encoded path if exists
   * - Falls back to legacy path and auto-migrates if encoded path doesn't exist
   * - Subsequent calls will use encoded path directly
   * 
   * @param dataId - Configuration data ID
   * @param group - Configuration group name
   * @returns Cached content or null if not found
   */
  private async getSnapshot(dataId: string, group: string): Promise<string | null> {
    const encodedKey = this.getSnapshotKeyEncoded(dataId, group);
    const legacyKey = this.getSnapshotKeyLegacy(dataId, group);
    
    // 1. Try encoded path first
    let content = await this.snapshot.get(encodedKey);
    if (content !== null) {
      this.debug('got snapshot from encoded path: %s', encodedKey);
      return content;
    }
    
    // 2. Fallback to legacy path
    content = await this.snapshot.get(legacyKey);
    if (content !== null) {
      this.debug('got snapshot from legacy path: %s, migrating to encoded path', legacyKey);
      
      // 3. Migrate to encoded path (without deleting legacy)
      try {
        await this.snapshot.save(encodedKey, content);
        this.debug('migrated snapshot from legacy to encoded: %s -> %s', legacyKey, encodedKey);
      } catch (err) {
        this.debug('migration failed for key %s@%s: %s', dataId, group, err.message);
      }
      
      return content;
    }
    
    return null;
  }

  /**
   * encryptedDataKey 的本地持久化 key，与内容快照（'config/' 前缀）并行的独立命名空间（'edk/' 前缀）。
   * 仅保存 KMS 加密后的数据密钥，明文数据密钥只在内存、绝不落盘。
   */
  private getEncryptedDataKeySnapshotKey(dataId: string, group: string): string {
    return path.join('edk', this.getSnapshotKeyEncoded(dataId, group));
  }

  /** 从 HTTP 响应头读取 encryptedDataKey（头名大小写不敏感）。 */
  private readEncryptedDataKeyHeader(headers: any): string | undefined {
    if (!headers) {
      return undefined;
    }
    const target = ENCRYPTED_DATA_KEY_HEADER.toLowerCase();
    for (const name of Object.keys(headers)) {
      if (name.toLowerCase() === target) {
        return headers[ name ];
      }
    }
    return undefined;
  }

  /**
   * 获取配置（内部）：返回服务端/快照中的原始内容与 encryptedDataKey，不做解密。
   * cipher dataId 的内容为密文，缓存与长轮询 md5 均基于密文，解密只在用户边界（getConfig / 监听器）进行。
   *
   * 服务端 fetch、快照回退双读、content/EDK 双写或双删全部由 readConfigWithFailover
   * 在共享快照锁（cacheDir::snapshotKey 临界区）内串行执行，同 key 并发读/写/remove
   * 不会交错，content 与 edk 永远成对写入 / 成对删除。
   * @param {String} dataId - id of the data
   * @param {String} group - group name of the data
   * @return {ConfigFetchResult} 原始内容与 encryptedDataKey
   */
  private async getConfigInner(dataId, group): Promise<ConfigFetchResult> {
    this.debug('calling getConfig, dataId: %s, group: %s', dataId, group);
    const key = this.getSnapshotKeyEncoded(dataId, group);
    const encryptedDataKeySnapshotKey = this.getEncryptedDataKeySnapshotKey(dataId, group);
    const isCipher = this.cipher.isCipherDataId(dataId);
    const result = await readConfigWithFailover({
      snapshotKey: key,
      encryptedDataKeySnapshotKey,
      isCipher,
      snapshot: this.snapshot,
      fetchFromServer: async () => {
        // withHeaders 仅对 cipher dataId 启用，其余路径保持返回原始字符串（不改变既有行为）
        const response = await this.httpAgent.request(this.apiRoutePath.GET, {
          data: {
            dataId,
            group,
            tenant: this.namespace,
          },
          withHeaders: isCipher,
        });
        if (isCipher) {
          return {
            content: response ? response.data : null,
            encryptedDataKey: this.readEncryptedDataKeyHeader(response && response.headers),
          };
        }
        return { content: response };
      },
      readSnapshotFallback: () => this.getSnapshot(dataId, group),
      onServerError: err => this._error(err),
      clearSnapshot: async () => {
        // 同时清除 encoded 与 legacy 两种表示，避免 legacy 快照被 getSnapshot 迁回后复活已删除配置
        await this.snapshot.delete(key);
        await this.snapshot.delete(this.getSnapshotKeyLegacy(dataId, group));
        await this.snapshot.delete(encryptedDataKeySnapshotKey);
      },
    });
    // ClientWorker 对外只需内容与 encryptedDataKey，容灾来源（server/snapshot）不对外暴露
    return { content: result.content, encryptedDataKey: result.encryptedDataKey };
  }

  /**
   * 获取配置
   * @param {String} dataId - id of the data
   * @param {String} group - group name of the data
   * @return {String} value or null if config exists but is empty
   */
  async getConfig(dataId, group) {
    const { content, encryptedDataKey } = await this.getConfigInner(dataId, group);
    if (content === null) {
      return null;
    }
    // 用户边界：cipher dataId 解密后返回明文，其余原样返回
    return await this.cipher.decryptIfNeeded(dataId, content, encryptedDataKey);
  }

  /**
   * 查询租户下的所有的配置
   * @return {Array} config
   */
  async getConfigs() {
    return null;
  }

  /**
   * 发布配置
   * @param {String} dataId - id of the data
   * @param {String} group - group name of the data
   * @param {String} content - config value
   * @param {Object} [options]
   *   - {String} type - type of the data
   *   - {String} casMd5 - CAS md5 of the expected config content, publish fails when mismatched
   * @return {Boolean} success
   */
  async publishSingle(dataId, group, content, options?: UnitOptions) {
    // 用户边界：cipher dataId 先加密，密文与 encryptedDataKey 一并以表单参数发布
    const encryptResult = await this.cipher.encryptIfNeeded(dataId, content);
    const data: { [key: string]: string } = {
      dataId,
      group,
      content: encryptResult.content,
      tenant: this.namespace,
      type: options && options.type,
      appName: this.appName,
      ...(encryptResult.encryptedDataKey ? { [ENCRYPTED_DATA_KEY_PARAM]: encryptResult.encryptedDataKey } : {}),
    };
    // 服务端从请求头读取 casMd5（ConfigController: request.getHeader("casMd5")），
    // 放在表单参数里会被忽略，导致退化为无条件发布
    const headers: { [key: string]: string } = {};
    if (options && options.casMd5) {
      headers.casMd5 = options.casMd5;
    }
    await this.httpAgent.request(this.apiRoutePath.PUBLISH, {
      method: 'POST',
      encode: true,
      data,
      headers,
    });
    return true;
  }

  /**
   * 以 CAS 方式发布配置，仅当服务端当前配置的 md5 与 casMd5 一致时才发布成功
   * @param {String} dataId - id of the data
   * @param {String} group - group name of the data
   * @param {String} content - config value
   * @param {String} casMd5 - md5 of the expected current config content
   * @param {Object} [options]
   *   - {String} type - type of the data
   * @return {Boolean} success
   */
  async publishConfigCas(dataId, group, content, casMd5, options?: UnitOptions) {
    try {
      return await this.publishSingle(dataId, group, content, { ...options, casMd5 });
    } catch (err) {
      // casMd5 与服务端当前 md5 不一致时：
      // - 部分版本服务端返回 409 Conflict
      // - Nacos 2.x 返回 500，body 为 "Cas publish fail, server md5 may have changed"
      // 两种情况都属于 CAS 校验失败，与 gRPC 路径一致返回 false
      const isCasConflict = err && (
        /ServerConflictError$/.test(err.name) ||
        /cas publish fail/i.test(String(err.body || ''))
      );
      if (isCasConflict) {
        this.debug('publishConfigCas failed, casMd5 mismatched, dataId: %s, group: %s', dataId, group);
        return false;
      }
      throw err;
    }
  }

  /**
   * 删除配置
   * @param {String} dataId - id of the data
   * @param {String} group - group name of the data
   * @return {Boolean} success
   */
  async remove(dataId, group) {
    const encodedKey = this.getSnapshotKeyEncoded(dataId, group);
    // 与 getConfig 共用快照锁：远端 remove + 本地清理（content/legacy/edk）串行，避免在途 get 晚到后复活快照
    return await withSnapshotLock(this.snapshot, encodedKey, async () => {
      await this.httpAgent.request(this.apiRoutePath.REMOVE, {
        method: 'DELETE',
        data: {
          dataId,
          group,
          tenant: this.namespace,
        },
        dataAsQueryString: true,
      });
      // 同步清理本地快照（encoded + legacy + edk），避免服务端已删除的配置残留在缓存里复活
      await this.snapshot.delete(this.getSnapshotKeyEncoded(dataId, group));
      await this.snapshot.delete(this.getSnapshotKeyLegacy(dataId, group));
      await this.snapshot.delete(this.getEncryptedDataKeySnapshotKey(dataId, group));
      return true;
    });
  }

  /**
   * @deprecated This API is not implemented and will be removed in a future version
   */
  async publishAggr(dataId, group, datumId, content) {
    return true;
  }

  /**
   * @deprecated This API is not implemented and will be removed in a future version
   */
  async removeAggr(dataId, group, datumId) {
    return null;
  }

  /**
   * @deprecated This API is not implemented and will be removed in a future version.
   * Nacos server does not support batch configuration retrieval operations.
   * Please use individual getConfig() calls instead.
   * 批量获取配置
   * @param {Array} dataIds - data id array
   * @param {String} group - group name of the data
   * @return {Array} result
   */
  async batchGetConfig(dataIds, group) {
    return null;
  }

  /**
   * @deprecated This API is not implemented and will be removed in a future version.
   * Nacos server does not support batch query operations.
   * Please use individual query methods instead.
   * 批量查询
   * @param {Array} dataIds - data id array
   * @param {String} group - group name of the data
   * @return {Object} result
   */
  async batchQuery(dataIds, group) {
    return null;
  }

  // for test
  clearSubscriptions() {
    this.subscriptions.clear();
  }

}
