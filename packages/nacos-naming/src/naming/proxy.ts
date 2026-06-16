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

/* tslint:disable:no-var-requires */
declare function require(module: string): any;
const uuid = require('uuid/v4');
const Base = require('sdk-base');
const assert = require('assert');
const utility = require('utility');
const localIp = require('address').ip();
const sleep = require('mz-modules/sleep');
/* tslint:enable:no-var-requires */

import { parseServerAddress } from 'nacos-common';
import { resolveAliyunCredentialsAsync, buildNamingAuthParams, getNamingSignData } from '../aliyun_auth';
import {
  BeatInfo,
  ServiceListResult,
  NacosNamingClientOptions,
} from '../interface';
import {
  VERSION,
  NACOS_URL_BASE,
  NACOS_URL_INSTANCE,
  SERVER_ADDR_IP_SPLITER,
  REQUEST_DOMAIN_RETRY_COUNT,
  DEFAULT_DELAY,
} from '../const';

const DEFAULT_SERVER_PORT = 8848;

const defaultOptions = {
  namespace: 'public',
  httpclient: require('urllib'),
  ssl: false,
  ak: null,
  sk: null,
  appName: '',
  endpoint: null,
  vipSrvRefInterMillis: 30000,
};

export class NamingProxy extends Base {
  serverList: string[];
  nacosDomain: string | null;
  serversFromEndpoint: string[];
  lastSrvRefTime: number;
  private _closed: boolean;

  constructor(options: NacosNamingClientOptions = {} as NacosNamingClientOptions) {
    assert(options.logger, '[NameProxy] options.logger is required');
    if (typeof options.serverList === 'string' && options.serverList) {
      options.serverList = (options.serverList as string).split(',');
    }
    super(Object.assign({}, defaultOptions, options, { initMethod: '_init' }));

    const rawList: string[] = (options.serverList as string[]) || [];
    this.serverList = rawList.map((addr: string) => {
      const parsed = parseServerAddress(addr, DEFAULT_SERVER_PORT);
      return parsed.host + ':' + parsed.port;
    });

    // Single server treated as load-balancing domain
    this.nacosDomain = this.serverList.length === 1 ? this.serverList[0] : null;
    this.serversFromEndpoint = [];
    this.lastSrvRefTime = 0;
    this._closed = false;
  }

  get logger(): any {
    return this.options.logger;
  }

  get endpoint(): string | null {
    return this.options.endpoint;
  }

  get namespace(): string {
    return this.options.namespace;
  }

  get httpclient(): any {
    return this.options.httpclient;
  }

  async _getServerListFromEndpoint(): Promise<string[]> {
    const urlString = 'http://' + this.endpoint + '/nacos/serverlist';
    const headers = this._builderHeaders();

    const result = await this.httpclient.request(urlString, {
      method: 'GET',
      headers,
      dataType: 'text',
    });
    if (result.status !== 200) {
      throw new Error('Error while requesting: ' + urlString + ', Server returned: ' + result.status);
    }
    const content: string = result.data;
    return content.split('\r\n');
  }

  async _refreshSrvIfNeed(): Promise<void> {
    if (this.serverList.length !== 0) {
      return;
    }

    if (Date.now() - this.lastSrvRefTime < this.options.vipSrvRefInterMillis) {
      return;
    }

    try {
      const list = await this._getServerListFromEndpoint();
      if (!list || !list.length) {
        throw new Error('Can not acquire Nacos list');
      }

      this.serversFromEndpoint = list;
      this.lastSrvRefTime = Date.now();
    } catch (err) {
      this.logger.warn(err);
    }
  }

  async _init(): Promise<void> {
    if (!this.endpoint) return;

    await this._refreshSrvIfNeed();
    this._refreshLoop();
  }

  async _refreshLoop(): Promise<void> {
    while (!this._closed) {
      await sleep(this.options.vipSrvRefInterMillis);
      await this._refreshSrvIfNeed();
    }
  }

  _getSignData(serviceName?: string): string {
    return getNamingSignData(serviceName);
  }

  async _checkSignature(params: Record<string, any>): Promise<void> {
    const credentials = await resolveAliyunCredentialsAsync(this.options);
    const authParams = buildNamingAuthParams(params.serviceName, credentials);
    if (!authParams) return;
    Object.assign(params, authParams);
  }

  _builderHeaders(): Record<string, string> {
    return {
      'User-Agent': VERSION,
      'Client-Version': VERSION,
      'Accept-Encoding': 'gzip,deflate,sdch',
      'Request-Module': 'Naming',
      Connection: 'Keep-Alive',
      RequestId: uuid(),
    };
  }

  async _callServer(serverAddr: string, method: string, api: string, params: Record<string, any> = {}): Promise<string> {
    await this._checkSignature(params);
    params.namespaceId = this.namespace;
    const headers = this._builderHeaders();

    if (!serverAddr.includes(SERVER_ADDR_IP_SPLITER)) {
      serverAddr = serverAddr + SERVER_ADDR_IP_SPLITER + DEFAULT_SERVER_PORT;
    }

    const url = (this.options.ssl ? 'https://' : 'http://') + serverAddr + api;
    if (this.options.username && this.options.password) {
      params.username = this.options.username;
      params.password = this.options.password;
    }
    const result = await this.httpclient.request(url, {
      method,
      headers,
      data: params,
      dataType: 'text',
      dataAsQueryString: true,
    });

    if (result.status === 200) {
      return result.data;
    }
    if (result.status === 304) {
      return '';
    }
    const err: any = new Error('failed to req API: ' + url + '. code: ' + result.status + ' msg: ' + result.data);
    err.name = 'NacosException';
    err.status = result.status;
    throw err;
  }

  async _reqAPI(api: string, params: Record<string, any>, method: string): Promise<string> {
    const servers = this.serverList.length ? this.serverList : this.serversFromEndpoint;
    const size = servers.length;

    if (size === 0 && !this.nacosDomain) {
      throw new Error('[NameProxy] no server available');
    }

    if (size > 0) {
      let index = utility.random(size);
      for (let i = 0; i < size; i++) {
        const server = servers[index];
        try {
          return await this._callServer(server, method, api, params);
        } catch (err) {
          this.logger.warn(err);
        }
        index = (index + 1) % size;
      }
      throw new Error('failed to req API: ' + api + ' after all servers(' + servers.join(',') + ') tried');
    }

    for (let i = 0; i < REQUEST_DOMAIN_RETRY_COUNT; i++) {
      try {
        return await this._callServer(this.nacosDomain!, method, api, params);
      } catch (err) {
        this.logger.warn(err);
      }
    }
    throw new Error('failed to req API: ' + api + ' after all servers(' + this.nacosDomain + ') tried');
  }

  async registerService(serviceName: string, groupName: string, instance: any): Promise<string> {
    this.logger.info('[NameProxy][REGISTER-SERVICE] %s registering service: %s with instance:%j', this.namespace, serviceName, instance);

    const params: Record<string, string> = {
      namespaceId: this.namespace,
      serviceName,
      groupName,
      clusterName: instance.clusterName,
      ip: instance.ip,
      port: instance.port + '',
      weight: instance.weight + '',
      enable: instance.enabled ? 'true' : 'false',
      healthy: instance.healthy ? 'true' : 'false',
      ephemeral: instance.ephemeral ? 'true' : 'false',
      metadata: JSON.stringify(instance.metadata),
    };
    return await this._reqAPI(NACOS_URL_INSTANCE, params, 'POST');
  }

  async deregisterService(serviceName: string, instance: any): Promise<string> {
    this.logger.info('[NameProxy][DEREGISTER-SERVICE] %s deregistering service: %s with instance:%j', this.namespace, serviceName, instance);

    const params: Record<string, string> = {
      namespaceId: this.namespace,
      serviceName,
      clusterName: instance.clusterName,
      ip: instance.ip,
      port: instance.port + '',
      ephemeral: instance.ephemeral !== false ? 'true' : 'false',
    };
    return await this._reqAPI(NACOS_URL_INSTANCE, params, 'DELETE');
  }

  async queryList(serviceName: string, clusters: string, udpPort: number, healthyOnly: boolean): Promise<string> {
    const params: Record<string, string> = {
      namespaceId: this.namespace,
      serviceName,
      clusters,
      udpPort: udpPort + '',
      clientIP: localIp,
      healthyOnly: healthyOnly ? 'true' : 'false',
    };
    return await this._reqAPI(NACOS_URL_BASE + '/instance/list', params, 'GET');
  }

  async serverHealthy(): Promise<boolean> {
    try {
      const str = await this._reqAPI(NACOS_URL_BASE + '/operator/metrics', {}, 'GET');
      const result = JSON.parse(str);
      return result && result.status === 'UP';
    } catch (_) {
      return false;
    }
  }

  async sendBeat(beatInfo: BeatInfo): Promise<number> {
    try {
      const params: Record<string, string> = {
        beat: JSON.stringify(beatInfo),
        namespaceId: this.namespace,
        serviceName: beatInfo.serviceName,
      };
      const jsonStr = await this._reqAPI(NACOS_URL_BASE + '/instance/beat', params, 'PUT');
      const result = JSON.parse(jsonStr);
      if (result && result.clientBeatInterval) {
        return Number(result.clientBeatInterval);
      }
    } catch (err) {
      (err as any).message = `[CLIENT-BEAT] failed to send beat: ${JSON.stringify(beatInfo)}, caused by ${(err as any).message}`;
      this.logger.error(err);
    }
    return DEFAULT_DELAY;
  }

  async getServiceList(pageNo: number, pageSize: number, groupName?: string): Promise<ServiceListResult> {
    const params: Record<string, string> = {
      pageNo: pageNo + '',
      pageSize: pageSize + '',
      namespaceId: this.namespace,
      groupName: groupName || '',
    };
    // TODO: selector
    const result = await this._reqAPI(NACOS_URL_BASE + '/service/list', params, 'GET');
    const json = JSON.parse(result);
    return {
      count: Number(json.count),
      data: json.doms,
    };
  }

  async _close(): Promise<void> {
    this._closed = true;
  }
}
