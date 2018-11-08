import { DiamondEnvOptions, DiamondError, IDiamondEnv, SnapShotData } from './interface';
import { CURRENT_UNIT, HTTP_CONFLICT, HTTP_NOT_FOUND, HTTP_OK, LINE_SEPARATOR, VERSION, WORD_SEPARATOR } from './const';
import { encodingParams, getMD5String } from './utils';

const Base = require('sdk-base');
const debug = require('debug')('diamond-client:diamond_env');
const co = require('co');
const path = require('path');
const is = require('is-type-of');
const gather = require('co-gather');
const {sleep} = require('mz-modules');
const crypto = require('crypto');

const DEFAULT_OPTIONS = {
  serverPort: 8080,
  refreshInterval: 30 * 1000, // 30s
  requestTimeout: 5000,
  unit: CURRENT_UNIT,
  ssl: true,
};

export class DiamondEnv extends Base implements IDiamondEnv {

  private uuid = Math.random();
  private isClose = false;
  private isLongPulling = false;
  private subscriptions = new Map();
  private currentServer = null;

  /**
   * Diamond Client.
   *
   * @param {Object} options
   *  - {Number} [refreshInterval] data refresh interval time, default is 30000 ms
   *  - {Number} [requestTimeout] diamond request timeout, default is 5000 ms
   *  - {String} [unit] unit name
   *  - {HttpClient} httpclient http request client
   *  - {Snapshot} snapshot snapshot instance
   * @constructor
   */
  constructor(options: DiamondEnvOptions = {unit: CURRENT_UNIT}) {
    super(Object.assign({}, DEFAULT_OPTIONS, options));
    // 同一个key可能会被多次订阅，避免不必要的 `warning`
    this.setMaxListeners(100);
    this.ready(true);
    debug(this.uuid);
  }

  get appName() {
    return this.options.appName;
  }

  get appKey() {
    return this.options.appKey;
  }

  get secretKey() {
    return this.options.secretKey;
  }

  get snapshot() {
    return this.options.snapshot;
  }

  get serverMgr() {
    return this.options.serverMgr;
  }

  get unit() {
    return this.options.unit;
  }

  /**
   * HTTP 请求客户端
   * @property {HttpClient} DiamondEnv#httpclient
   */
  get httpclient() {
    return this.options.httpclient;
  }

  close() {
    this.isClose = true;
    this.removeAllListeners();
  }

  /**
   * 更新 当前服务器
   */
  async updateCurrentServer() {
    this.currentServer = await this.serverMgr.getOne(this.unit);
    if (!this.currentServer) {
      const err: DiamondError = new Error('[DiamondEnv] Diamond server unavailable');
      err.name = 'DiamondServerUnavailableError';
      err.unit = this.unit;
      throw err;
    }
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
    const {dataId, group} = info;
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
    const tasks = list.map(({dataId, group}) => this.getConfig(dataId, group));
    const results = await gather(tasks, 5);
    for (let i = 0, len = results.length; i < len; i++) {
      const key = this.formatKey(list[ i ]);
      const item = this.subscriptions.get(key);
      const result = results[ i ];
      if (!item) {
        debug('item %s not exist', key); // maybe removed by user
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
   * 请求
   * @param {String} path - 请求 path
   * @param {Object} [options] - 参数
   * @return {String} value
   */
  async request(path, options: {
    encode?: boolean;
    method?: string;
    data?: any;
    timeout?: number;
    headers?: any;
  } = {}) {
    // 默认为当前单元
    const unit = this.unit;
    const ts = String(Date.now());
    const {encode = false, method = 'GET', data, timeout = this.options.requestTimeout, headers = {}} = options;

    if (!this.currentServer) {
      await this.updateCurrentServer();
    }

    let url = `http://${this.currentServer}:${8080}/diamond-server${path}`;

    if (this.options.ssl) {
      url = `https://${this.currentServer}:${443}/diamond-server${path}`;
    }

    debug('request unit: [%s] with url: %s', unit, url);
    let signStr = data.tenant;
    if (data.group && data.tenant) {
      signStr = data.tenant + '+' + data.group;
    } else if (data.group) {
      signStr = data.group;
    }

    const signature = crypto.createHmac('sha1', this.secretKey)
      .update(signStr + '+' + ts).digest()
      .toString('base64');
    // 携带统一的头部信息
    Object.assign(headers, {
      'Client-Version': VERSION,
      'Content-Type': 'application/x-www-form-urlencoded; charset=GBK',
      'Spas-AccessKey': this.options.accessKey,
      timeStamp: ts,
      exConfigInfo: 'true',
      'Spas-Signature': signature,
    });

    let requestData = data;
    if (encode) {
      requestData = encodingParams(data);
    }
    try {
      const res = await this.httpclient.request(url, {
        rejectUnauthorized: false,
        httpsAgent: false,
        method,
        data: requestData,
        dataType: 'text',
        headers,
        timeout,
        secureProtocol: 'TLSv1_2_method',
      });

      let err;
      const resData = res.data;
      debug('%s %s, got %s, body: %j', method, url, res.status, resData);
      switch (res.status) {
        case HTTP_OK:
          return resData;
        case HTTP_NOT_FOUND:
          return null;
        case HTTP_CONFLICT:
          err = new Error(`[DiamondEnv] Diamond server config being modified concurrently, data: ${JSON.stringify(data)}`);
          err.name = 'DiamondServerConflictError';
          throw err;
        default:
          err = new Error(`Diamond Server Error Status: ${res.status}, url: ${url}, request data: ${JSON.stringify(data)}, response data: ${resData && resData.toString()}`);
          err.name = 'DiamondServerResponseError';
          err.body = res.data;
          throw err;
      }
    } catch (err) {
      err.url = `${method} ${url}`;
      err.data = data;
      err.headers = headers;
      await this.updateCurrentServer();
      throw err;
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
    debug('start to check update config list');
    if (this.subscriptions.size === 0) {
      return;
    }

    const beginTime = Date.now();
    const tenant = this.options.namespace;
    const probeUpdate = [];
    for (const {dataId, group, md5} of this.subscriptions.values()) {
      probeUpdate.push(dataId, WORD_SEPARATOR);
      probeUpdate.push(group, WORD_SEPARATOR);

      if (tenant) {
        probeUpdate.push(md5, WORD_SEPARATOR);
        probeUpdate.push(tenant, LINE_SEPARATOR);
      } else {
        probeUpdate.push(md5, LINE_SEPARATOR);
      }
    }
    const content = await this.request('/config.co', {
      method: 'POST',
      data: {
        'Probe-Modify-Request': probeUpdate.join(''),
      },
      headers: {
        longPullingTimeout: '30000',
      },
      timeout: 40000, // 超时时间比longPullingTimeout稍大一点，避免主动超时异常
    });
    debug('long pulling takes %ds', (Date.now() - beginTime) / 1000);
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
    tenant = tenant || this.options.namespace || 'default_tenant';
    return path.join('config', this.unit, tenant, group, dataId);
  }

  /**
   * 获取配置
   * @param {String} dataId - id of the data
   * @param {String} group - group name of the data
   * @return {String} value
   */
  async getConfig(dataId, group) {
    debug('calling getConfig, dataId: %s, group: %s', dataId, group);
    let content;
    const key = this.getSnapshotKey(dataId, group);
    try {
      content = await this.request('/config.co', {
        data: {
          dataId,
          group,
          tenant: this.options.namespace,
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
    const ret = await this.request('/basestone.do', {
      data: {
        pageNo,
        pageSize,
        method: 'getAllConfigByTenant',
        tenant: this.options.namespace,
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
    await this.request('/basestone.do?method=syncUpdateAll', {
      method: 'POST',
      encode: true,
      data: {
        dataId,
        group,
        content,
        tenant: this.options.namespace,
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
    await this.request('/datum.do?method=deleteAllDatums', {
      method: 'POST',
      data: {
        dataId,
        group,
        tenant: this.options.namespace,
      },
    });
    return true;
  }

  async publishAggr(dataId, group, datumId, content) {
    const appName = this.appName;
    await this.request('/datum.do?method=addDatum', {
      method: 'POST',
      data: {
        dataId,
        group,
        datumId,
        content,
        appName,
        tenant: this.options.namespace,
      },
    });
    return true;
  }

  async removeAggr(dataId, group, datumId) {
    await this.request('/datum.do?method=deleteDatum', {
      method: 'POST',
      data: {
        dataId,
        group,
        datumId,
        tenant: this.options.namespace,
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
    const content = await this.request('/config.co?method=batchGetConfig', {
      method: 'POST',
      data: {
        dataIds: dataIdStr,
        group,
        tenant: this.options.namespace,
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
    const content = await this.request('/admin.do?method=batchQuery', {
      method: 'POST',
      data: {
        dataIds: dataIdStr,
        group,
        tenant: this.options.namespace,
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
}
