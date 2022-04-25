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
import { Snapshot } from './snapshot';
import { ClientOptionKeys, NacosHttpError, IConfiguration, IServerListManager, ISnapshot } from './interface';
import { CURRENT_UNIT } from './const';
import * as path from 'path';

const Base = require('sdk-base');
const gather = require('co-gather');
const { random } = require('utility');
const { sleep } = require('mz-modules');

interface ServerCacheData {
  hosts: [ string ];
  index: number;
}

export class ServerListManager extends Base implements IServerListManager {

  private isSync = false;
  private isClosed = false;
  private serverListCache: Map<string, ServerCacheData> = new Map(); // unit => { hosts: [ addr1, addr2 ], index }
  private currentUnit = CURRENT_UNIT;
  private isDirectMode = false;
  protected loggerDomain = 'Nacos';
  private debugPrefix = this.loggerDomain.toLowerCase();
  protected debug = require('debug')(`${this.debugPrefix}:${process.pid}:mgr`);
  private currentServerAddrMap = new Map();

  /**
   * 服务地址列表管理器
   *
   * @param {Object} options
   *   - {HttpClient} httpclient - http 客户端
   *   - {Snapshot} [snapshot] - 快照对象
   *   - {String} nameServerAddr - 命名服务器地址 `hostname:port`
   * @constructor
   */
  constructor(options) {
    super(options);
    this.formatOptions();
    this.syncServers();
    this.ready(true);
  }

  formatOptions() {
    if (this.configuration.has(ClientOptionKeys.ENDPOINT)) {
      this.configuration.modify(ClientOptionKeys.ENDPOINT, (endpoint) => {
        const temp = endpoint.split(':');
        return temp[ 0 ] + ':' + (temp[ 1 ] || '8080');
      });
    }

    if (this.configuration.has(ClientOptionKeys.SERVERADDR)) {
      this.isDirectMode = true;
      this.serverListCache.set(CURRENT_UNIT, {
        hosts: [ this.configuration.get(ClientOptionKeys.SERVERADDR) ],
        index: 0
      });
    }
  }

  get configuration(): IConfiguration {
    return this.options.configuration;
  }

  get snapshot(): ISnapshot {
    if(!this.configuration.has(ClientOptionKeys.SNAPSHOT)) {
      this.configuration.set(ClientOptionKeys.SNAPSHOT, new Snapshot(this.options));
    }
    return this.configuration.get(ClientOptionKeys.SNAPSHOT);
  }

  get httpclient() {
    return this.configuration.get(ClientOptionKeys.HTTPCLIENT);
  }

  get nameServerAddr(): string {
    if (this.configuration.has(ClientOptionKeys.ENDPOINT)) {
      return this.configuration.get(ClientOptionKeys.ENDPOINT);
    }
    return this.configuration.get(ClientOptionKeys.NAMESERVERADDR);
  }

  get refreshInterval(): number {
    return this.configuration.get(ClientOptionKeys.REFRESH_INTERVAL);
  }

  get contextPath(): string {
    return this.configuration.get(ClientOptionKeys.CONTEXTPATH) || 'nacos';
  }

  get clusterName(): string {
    return this.configuration.get(ClientOptionKeys.CLUSTER_NAME) || 'serverlist';
  }

  get endpointQueryParams() {
    return this.configuration.get(ClientOptionKeys.ENDPOINT_QUERY_PARAMS)
  }

  get requestTimeout(): number {
    return this.configuration.get(ClientOptionKeys.REQUEST_TIMEOUT);
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
      const err: NacosHttpError = new Error(`[${this.loggerDomain}#ServerListManager] request url: ${url} failed with statusCode: ${status}`);
      err.name = `${this.loggerDomain}ServerResponseError`;
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
    return this.currentUnit;
  }

  /**
   * 同步服务器列表
   * @return {void}
   */
  syncServers() {
    if (this.isSync || this.isDirectMode) {
      return;
    }
    (async () => {
      try {
        this.isSync = true;
        while (!this.isClosed) {
          await sleep(this.refreshInterval);
          const units = Array.from(this.serverListCache.keys());
          this.debug('syncServers for units: %j', units);
          const results = await gather(units.map(unit => this.fetchServerList(unit)));
          for (let i = 0, len = results.length; i < len; i++) {
            if (results[ i ].isError) {
              const err = new Error(results[ i ].error);
              err.name = `${this.loggerDomain}UpdateServersError`;
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

  // 获取某个单元的 server 列表
  async fetchServerList(unit = CURRENT_UNIT) {
    const key = this.formatKey(unit);
    const url = this.getRequestUrl(unit);
    let hosts;
    try {
      let data = await this.request(url, {
        timeout: this.requestTimeout,
        dataType: 'text',
      });
      data = data || '';
      hosts = data.split('\n').map(host => host.trim()).filter(host => !!host);
      const length = hosts.length;
      this.debug('got %d hosts, the serverlist is: %j', length, hosts);
      if (!length) {
        const err: NacosHttpError = new Error(`[${this.loggerDomain}#ServerListManager] ${this.loggerDomain} return empty hosts`);
        err.name = `${this.loggerDomain}ServerHostEmptyError`;
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
  protected getRequestUrl(unit) {
    const endpointQueryParams = !!this.endpointQueryParams ? `?${this.endpointQueryParams}` : '';
    return `http://${this.nameServerAddr}/${this.contextPath}/${this.clusterName}${endpointQueryParams}`;
  }

  /**
   * 获取单元列表
   * @return {Array} units
   */
  async fetchUnitLists() {
    return [ this.currentUnit ];
  }

  async updateCurrentServer(unit = CURRENT_UNIT) {
    if (!this.serverListCache.has(unit)) {
      await this.fetchServerList(unit);
    }
    let serverData = this.serverListCache.get(unit);
    if (serverData) {
      let currentHostIndex = serverData.index;
      if (currentHostIndex >= serverData.hosts.length) {
        // 超出序号，重头开始循环
        currentHostIndex = 0;
      }
      const currentServer = serverData.hosts[ currentHostIndex++ ];
      this.currentServerAddrMap.set(unit, currentServer);
    }
  }

  /**
   * 获取某个单元的地址
   * @param {String} unit 单元名，默认为当前单元
   * @return {String} address
   */
  async getCurrentServerAddr(unit = CURRENT_UNIT) {
    if (!this.currentServerAddrMap.has(unit)) {
      await this.updateCurrentServer(unit);
    }
    return this.currentServerAddrMap.get(unit);
  }

  // for test
  hasServerInCache(serverName) {
    return this.serverListCache.has(serverName);
  }

  // for test
  getServerInCache(unit = CURRENT_UNIT) {
    return this.serverListCache.get(unit);
  }

  // for test
  clearServerCache() {
    this.serverListCache.clear();
  }
}
