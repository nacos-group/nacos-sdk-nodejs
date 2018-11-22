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
import { API_ROUTE, ClientOptionKeys, DiamondError, IClientWorker, IConfiguration, SnapShotData } from './interface';
import { LINE_SEPARATOR, WORD_SEPARATOR } from './const';
import { getMD5String } from './utils';

const Base = require('sdk-base');
const co = require('co');
const path = require('path');
const is = require('is-type-of');
const gather = require('co-gather');
const { sleep } = require('mz-modules');

export class ClientWorker extends Base implements IClientWorker {

  private uuid = (Math.random() * 1000).toFixed(0);
  private isClose = false;
  private isLongPulling = false;
  private subscriptions = new Map();
  protected loggerDomain = 'Nacos';
  private debug = require('debug')(`${this.loggerDomain}:${process.pid}:ins-${this.uuid}:client_worker`);
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
    this.ready(true);
    this.debug('client worker start');
  }

  get configuration(): IConfiguration {
    return this.options.configuration;
  }

  get appName() {
    return this.configuration.get(ClientOptionKeys.APPNAME);
  }

  get snapshot() {
    return this.configuration.get(ClientOptionKeys.SNAPSHOT);
  }

  get unit() {
    return this.configuration.get(ClientOptionKeys.UNIT);
  }

  get httpAgent() {
    return this.configuration.get(ClientOptionKeys.HTTP_AGENT);
  }

  get namespace() {
    return this.configuration.get(ClientOptionKeys.NAMESPACE);
  }

  close() {
    this.isClose = true;
    this.removeAllListeners();
  }

  /**
   * 订阅
   * @param {Object} info
   *   - {String} dataId - id of the data you want to subscribe
   *   - {String} [group] - group name of the data
   * @param {Function} listener - listener
   * @return {DiamondEnv} self
   */
  subscribe(info, listener) {
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
          this.startLongPulling();
        } catch (err) {
          this._error(err);
        }
      })();
    } else if (!is.nullOrUndefined(item.md5)) {
      process.nextTick(() => listener(item.content));
    }
    return this;
  }

  /**
   * 同步配置
   * @param {Array} list - 需要同步的配置列表
   * @return {void}
   */
  private async syncConfigs(list) {
    const tasks = list.map(({ dataId, group }) => this.getConfig(dataId, group));
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
        const err: DiamondError = new Error(`[DiamondEnv] getConfig failed for dataId: ${item.dataId}, group: ${item.group}, error: ${result.error}`);
        err.name = 'DiamondSyncConfigError';
        err.dataId = item.dataId;
        err.group = item.group;
        this._error(err);
        continue;
      }

      const content = result.value;
      const md5 = getMD5String(content);
      // 防止应用启动时，并发请求，导致同一个 key 重复触发
      if (item.md5 !== md5) {
        item.md5 = md5;
        item.content = content;
        // 异步化，避免处理逻辑异常影响到 diamond 内部
        setImmediate(() => this.emit(key, content));
      }
    }
  }

  /**
   * 开启长轮询
   * @return {void}
   * @private
   */
  private startLongPulling() {
    // 防止重入
    if (this.isLongPulling) {
      return;
    }
    this.isLongPulling = true;
    co(async () => {
      while (!this.isClose && this.subscriptions.size > 0) {
        try {
          await this.checkServerConfigInfo();
        } catch (err) {
          err.name = 'DiamondLongPullingError';
          this._error(err);
          await sleep(2000);
        }
      }
    }).then(() => {
      this.isLongPulling = false;
    }).catch(err => {
      this.isLongPulling = false;
      this._error(err);
    });
  }

  private async checkServerConfigInfo() {
    this.debug('start to check update config list');
    if (this.subscriptions.size === 0) {
      return;
    }

    const beginTime = Date.now();
    const tenant = this.namespace;
    const probeUpdate = [];
    for (const { dataId, group, md5 } of this.subscriptions.values()) {
      probeUpdate.push(dataId, WORD_SEPARATOR);
      probeUpdate.push(group, WORD_SEPARATOR);

      if (tenant) {
        probeUpdate.push(md5, WORD_SEPARATOR);
        probeUpdate.push(tenant, LINE_SEPARATOR);
      } else {
        probeUpdate.push(md5, LINE_SEPARATOR);
      }
    }

    const postData = {};
    postData[this.listenerDataKey] = probeUpdate.join('');

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
    if (updateList && updateList.length) {
      await this.syncConfigs(updateList);
    }
  }

  // 解析 diamond 返回的 long pulling 结果
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
   * @return {DiamondEnv} self
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

  private getSnapshotKey(dataId, group, tenant?) {
    tenant = tenant || this.namespace || 'default_tenant';
    return path.join('config', this.unit, tenant, group, dataId);
  }

  /**
   * 获取配置
   * @param {String} dataId - id of the data
   * @param {String} group - group name of the data
   * @return {String} value
   */
  async getConfig(dataId, group) {
    this.debug('calling getConfig, dataId: %s, group: %s', dataId, group);
    let content;
    const key = this.getSnapshotKey(dataId, group);

    // TODO 优先使用本地配置

    try {
      content = await this.httpAgent.request(this.apiRoutePath.GET, {
        data: {
          dataId,
          group,
          tenant: this.namespace,
        },
      });
    } catch (err) {
      const cache = await this.snapshot.get(key);
      if (cache) {
        this._error(err);
        return cache;
      }
      throw err;
    }
    await this.snapshot.save(key, content);
    return content;
  }

  /**
   * 查询租户下的所有的配置
   * @return {Array} config
   */
  async getConfigs() {
    const configInfoPage = await this.getAllConfigInfoByTenantInner(1, 1);
    const total = configInfoPage.totalCount;
    const pageSize = 200;
    let configs = [];
    for (let i = 0; i * pageSize < total; i++) {
      const configInfo = await this.getAllConfigInfoByTenantInner(i + 1, pageSize);
      configs = configs.concat(configInfo.pageItems);
    }
    return configs;
  }

  async getAllConfigInfoByTenantInner(pageNo, pageSize) {
    const ret = await this.httpAgent.request('/basestone.do', {
      data: {
        pageNo,
        pageSize,
        method: 'getAllConfigByTenant',
        tenant: this.namespace,
      },
    });
    return JSON.parse(ret);
  }


  /**
   * 发布配置
   * @param {String} dataId - id of the data
   * @param {String} group - group name of the data
   * @param {String} content - config value
   * @return {Boolean} success
   */
  async publishSingle(dataId, group, content) {
    await this.httpAgent.request(this.apiRoutePath.PUBLISH, {
      method: 'POST',
      encode: true,
      data: {
        dataId,
        group,
        content,
        tenant: this.namespace,
      },
    });
    return true;
  }

  /**
   * 删除配置
   * @param {String} dataId - id of the data
   * @param {String} group - group name of the data
   * @return {Boolean} success
   */
  async remove(dataId, group) {
    await this.httpAgent.request(this.apiRoutePath.REMOVE, {
      method: 'DELETE',
      data: {
        dataId,
        group,
        tenant: this.namespace,
      },
      dataAsQueryString: true,
    });
    return true;
  }

  async publishAggr(dataId, group, datumId, content) {
    const appName = this.appName;
    await this.httpAgent.request(this.apiRoutePath.PUBLISH_ALL, {
      method: 'POST',
      data: {
        dataId,
        group,
        datumId,
        content,
        appName,
        tenant: this.namespace,
      },
    });
    return true;
  }

  async removeAggr(dataId, group, datumId) {
    await this.httpAgent.request(this.apiRoutePath.REMOVE_ALL, {
      method: 'POST',
      data: {
        dataId,
        group,
        datumId,
        tenant: this.namespace,
      },
    });
    return true;
  }

  /**
   * 批量获取配置
   * @param {Array} dataIds - data id array
   * @param {String} group - group name of the data
   * @return {Array} result
   */
  async batchGetConfig(dataIds, group) {
    const dataIdStr = dataIds.join(WORD_SEPARATOR);
    const content = await this.httpAgent.request(this.apiRoutePath.BATCH_GET, {
      method: 'POST',
      data: {
        dataIds: dataIdStr,
        group,
        tenant: this.namespace,
      },
    });

    try {
      /**
       * data 结构
       * [{status: 1, group: "test-group", dataId: 'test-dataId3', content: 'test-content'}]
       */
      const data = JSON.parse(content);
      const savedData = data.filter(d => d.status === 1).map(d => {
        const r: SnapShotData = {};
        r.key = path.join(this.getSnapshotKey(d.dataId, d.group));
        r.value = d.content;
        return r;
      });
      await this.snapshot.batchSave(savedData);
      return data;
    } catch (err) {
      err.name = 'DiamondBatchDeserializeError';
      err.data = content;
      throw err;
    }
  }

  /**
   * 批量查询
   * @param {Array} dataIds - data id array
   * @param {String} group - group name of the data
   * @return {Object} result
   */
  async batchQuery(dataIds, group) {
    const dataIdStr = dataIds.join(WORD_SEPARATOR);
    const content = await this.httpAgent.request(this.apiRoutePath.BATCH_QUERY, {
      method: 'POST',
      data: {
        dataIds: dataIdStr,
        group,
        tenant: this.namespace,
      },
    });

    try {
      return JSON.parse(content);
    } catch (err) {
      err.name = 'DiamondBatchDeserializeError';
      err.data = content;
      throw err;
    }
  }

  // for test
  clearSubscriptions() {
    this.subscriptions.clear();
  }

}
