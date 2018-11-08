import { Snapshot } from './snapshot';
import { DiamondError, IServerListManager, serverListMgrOptions } from './interface';
import { CURRENT_UNIT } from './const';

const Base = require('sdk-base');
const debug = require('debug')('diamond-client');
const path = require('path');
const assert = require('assert');
const gather = require('co-gather');
const Constants = require('./const');
const { random } = require('utility');
const { sleep } = require('mz-modules');

const DEFAULT_OPTIONS = {
  endpoint: 'acm.aliyun.com',
  refreshInterval: 30 * 1000, // 30s
};

export class ServerListManager extends Base implements IServerListManager {

  private isSync;
  private isClosed;
  private serverListCache;
  private currentUnit;

  /**
   * 服务地址列表管理器
   *
   * @param {Object} options
   *   - {HttpClient} httpclient - http 客户端
   *   - {Snapshot} [snapshot] - 快照对象
   *   - {String} nameServerAddr - 命名服务器地址 `hostname:port`
   * @constructor
   */
  constructor(options: serverListMgrOptions) {
    assert(options.httpclient, '[diamond#ServerListManager] options.httpclient is required');
    options.snapshot = options.snapshot || new Snapshot(options);

    if (options.endpoint) {
      const temp = options.endpoint.split(':');
      options.endpoint = temp[ 0 ] + ':' + (temp[ 1 ] || '8080');
    }
    super(Object.assign({}, DEFAULT_OPTIONS, options));

    this.isSync = false;
    this.isClosed = false;
    this.currentUnit = CURRENT_UNIT;
    this.serverListCache = new Map(); // unit => { hosts: [ addr1, addr2 ], index }
    this.syncServers();
    this.ready(true);
  }

  get snapshot() {
    return this.options.snapshot;
  }

  get httpclient() {
    return this.options.httpclient;
  }

  get nameServerAddr() {
    if (this.options.endpoint) {
      return this.options.endpoint;
    }
    return this.options.nameServerAddr;
  }

  get refreshInterval() {
    return this.options.refreshInterval;
  }

  /**
   * 关闭地址列表服务
   */
  close() {
    this.isClosed = true;
  }

  private async request(url, options) {
    const res = await this.httpclient.request(url, options);
    const { status, data } = res;
    if (status !== 200) {
      const err: DiamondError = new Error(`[diamond#ServerListManager] request url: ${url} failed with statusCode: ${status}`);
      err.name = 'DiamondServerResponseError';
      err.url = url;
      err.params = options;
      err.body = res.data;
      throw err;
    }
    return data;
  }

  /*
   * 获取当前机器所在单元
   */
  async getCurrentUnit() {
    if (!this.currentUnit) {
      const url = `http://${this.nameServerAddr}/env`;
      const data = await this.request(url, {
        timeout: this.options.requestTimeout,
        dataType: 'text',
      });
      const unit = data && data.trim();
      this.currentUnit = unit;
    }
    return this.currentUnit;
  }

  /**
   * 获取某个单元的地址
   * @param {String} unit 单元名，默认为当前单元
   * @return {String} address
   */
  async getOne(unit = Constants.CURRENT_UNIT) {
    let serverData = this.serverListCache.get(unit);
    // 不存在则先尝试去更新一次
    if (!serverData) {
      serverData = await this.fetchServerList(unit);
    }
    // 如果还没有，则返回 null
    if (!serverData || !serverData.hosts.length) {
      return null;
    }
    const choosed = serverData.hosts[ serverData.index ];
    serverData.index += 1;
    if (serverData.index >= serverData.hosts.length) {
      serverData.index = 0;
    }
    return choosed;
  }

  /**
   * 同步服务器列表
   * @return {void}
   */
  syncServers() {
    if (this.isSync) {
      return;
    }
    (async () => {
      try {
        this.isSync = true;
        while (!this.isClosed) {
          await sleep(this.refreshInterval);
          const units = Array.from(this.serverListCache.keys());
          debug('syncServers for units: %j', units);
          const results = await gather(units.map(unit => this.fetchServerList(unit)));
          for (let i = 0, len = results.length; i < len; i++) {
            if (results[ i ].isError) {
              const err = new Error(results[ i ].error);
              err.name = 'DiamondUpdateServersError';
              this.emit('error', err);
            }
          }
        }
        this.isSync = false;
      } catch (err) {
        this.emit('error', err);
      }
    })();
  }

  // 获取某个单元的 diamond server 列表
  async fetchServerList(unit = Constants.CURRENT_UNIT) {
    const key = this.formatKey(unit);
    const url = this.getRequestUrl(unit);
    let hosts;
    try {
      let data = await this.request(url, {
        timeout: this.options.requestTimeout,
        dataType: 'text',
      });
      data = data || '';
      hosts = data.split('\n').map(host => host.trim()).filter(host => !!host);
      const length = hosts.length;
      debug('got %d hosts, the serverlist is: %j', length, hosts);
      if (!length) {
        const err: DiamondError = new Error('[diamond#ServerListManager] Diamond return empty hosts');
        err.name = 'DiamondServerHostEmptyError';
        err.unit = unit;
        throw err;
      }
      await this.snapshot.save(key, JSON.stringify(hosts));
    } catch (err) {
      this.emit('error', err);
      const data = await this.snapshot.get(key);
      if (data) {
        try {
          hosts = JSON.parse(data);
        } catch (err) {
          await this.snapshot.delete(key);
          err.name = 'ServerListSnapShotJSONParseError';
          err.unit = unit;
          err.data = data;
          this.emit('error', err);
        }
      }
    }
    if (!hosts || !hosts.length) {
      // 这里主要是为了让后面定时同步可以执行
      this.serverListCache.set(unit, null);
      return null;
    }
    const serverData = {
      hosts,
      index: random(hosts.length),
    };
    this.serverListCache.set(unit, serverData);
    return serverData;
  }

  formatKey(unit) {
    return path.join('server_list', unit);
  }

  // 获取请求 url
  private getRequestUrl(unit) {
    return unit === Constants.CURRENT_UNIT ?
      `http://${this.nameServerAddr}/diamond-server/diamond` :
      `http://${this.nameServerAddr}/diamond-server/diamond-unit-${unit}?nofix=1`;
  }

  /**
   * 获取单元列表
   * @return {Array} units
   */
  async fetchUnitLists() {
    return [ this.currentUnit ];
  }

  // for test
  hasServerInCache(serverName) {
    return this.serverListCache.has(serverName);
  }

  // for test
  clearaServerCache() {
    this.serverListCache.clear();
  }
}
