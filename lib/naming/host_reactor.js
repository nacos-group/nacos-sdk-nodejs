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

'use strict';

const assert = require('assert');
const Base = require('sdk-base');
const Constants = require('../const');
const ServiceInfo = require('./service_info');
const PushReceiver = require('./push_receiver');
const localIp = require('address').ip();

class HostReactor extends Base {
  constructor(options = {}) {
    assert(options.logger, '[HostReactor] options.logger is required');
    assert(options.serverProxy, '[HostReactor] options.serverProxy is required');
    super(Object.assign({}, options, { initMethod: '_init' }));

    this._serviceInfoMap = new Map();
    this._updatingSet = new Set();
    this._futureMap = new Map();
    this._pushReceiver = new PushReceiver(this);
  }

  get logger() {
    return this.options.logger;
  }

  get serverProxy() {
    return this.options.serverProxy;
  }

  get getServiceInfoMap() {
    const map = {};
    for (const key of this._serviceInfoMap.keys()) {
      map[key] = this._serviceInfoMap.get(key);
    }
    return map;
  }

  async _init() {
    await this._pushReceiver.ready();
  }

  processServiceJSON(json) {
    const data = JSON.parse(json);
    const serviceInfo = new ServiceInfo(data);
    const oldService = this._serviceInfoMap.get(serviceInfo.getKey());
    if (!serviceInfo.isValid) {
      return oldService;
    }

    serviceInfo.jsonFromServer = json;
    if (oldService) {
      if (oldService.lastRefTime > serviceInfo.lastRefTime) {
        this.logger.warn('[HostReactor] out of date data received, old-t: %s, new-t: ', oldService.lastRefTime, serviceInfo.lastRefTime);
      }

      this._serviceInfoMap.set(serviceInfo.getKey(), serviceInfo);

      const oldHostMap = new Map();
      for (const host of oldService.hosts) {
        const key = host.ip + ':' + host.port;
        oldHostMap.set(key, host);
      }

      const modHosts = [];
      const newHosts = [];
      const remvHosts = [];

      const newHostMap = new Map();
      for (const host of serviceInfo.hosts) {
        const key = host.ip + ':' + host.port;
        newHostMap.set(key, host);

        if (oldHostMap.has(key) && JSON.stringify(host) !== JSON.stringify(oldHostMap.get(key))) {
          modHosts.push(host);
          continue;
        }

        if (!oldHostMap.has(key)) {
          newHosts.push(host);
          continue;
        }
      }

      for (const key of oldHostMap.keys()) {
        if (newHostMap.has(key)) continue;

        if (!newHostMap.has(key)) {
          remvHosts.push(oldHostMap.get(key));
          continue;
        }
      }

      if (newHosts.length) {
        this.logger.info('[HostReactor] new ips(%d) service: %s -> %j', newHosts.length, serviceInfo.name, newHosts);
      }
      if (remvHosts.length) {
        this.logger.info('[HostReactor] removed ips(%d) service: %s -> %j', remvHosts.length, serviceInfo.name, remvHosts);
      }
      if (modHosts.length) {
        this.logger.info('[HostReactor] modified ips(%d) service: %s -> %j', modHosts.length, serviceInfo.name, modHosts);
      }

      if (newHosts.length || remvHosts.length || modHosts.length) {
        this.emit(`${serviceInfo.getKey()}_changed`, serviceInfo.hosts, serviceInfo);
        // TODO: 本地缓存
      } else if (oldHostMap.size === 0) {
        this.emit(`${serviceInfo.getKey()}_changed`, serviceInfo.hosts, serviceInfo);
      }
    } else {
      this._serviceInfoMap.set(serviceInfo.getKey(), serviceInfo);
      this.emit(`${serviceInfo.getKey()}_changed`, serviceInfo.hosts, serviceInfo);
      // TODO: 本地缓存
    }
    this.logger.info('[HostReactor] current ips(%d) service: %s -> %s', serviceInfo.ipCount, serviceInfo.name, JSON.stringify(serviceInfo.hosts));
    return serviceInfo;
  }

  _getKey(param) {
    const serviceName = param.serviceName;
    const clusters = (param.clusters || []).join(',');
    const env = param.env || '';
    const allIPs = param.allIPs || false;
    return ServiceInfo.getKey(serviceName, clusters, env, allIPs);
  }

  subscribe(param, listener) {
    const key = this._getKey(param);
    const serviceInfo = this._serviceInfoMap.get(key);
    if (serviceInfo) {
      setImmediate(() => { listener(serviceInfo.hosts); });
    } else {
      this.getServiceInfo(param);
    }
    this.on(key + '_changed', listener);
  }

  unSubscribe(param, listener) {
    const key = this._getKey(param);
    if (listener) {
      this.removeListener(key + '_changed', listener);
    } else {
      this.removeAllListeners(key + '_changed');
    }
  }

  async getServiceInfo(param) {
    const serviceName = param.serviceName;
    const clusters = (param.clusters || []).join(',');
    const env = param.env || '';
    const allIPs = param.allIPs || false;
    const key = ServiceInfo.getKey(serviceName, clusters, env, allIPs);
    // TODO: failover

    let serviceInfo = this._serviceInfoMap.get(key);
    if (!serviceInfo) {
      serviceInfo = new ServiceInfo({
        name: serviceName,
        clusters,
        env,
        allIPs,
        hosts: [],
      });
      this._serviceInfoMap.set(key, serviceInfo);
      this._updatingSet.add(key);

      if (allIPs) {
        await this.updateService4AllIPNow(serviceName, clusters, env);
      } else {
        await this.updateServiceNow(serviceName, clusters, env);
      }

      this._updatingSet.delete(key);
    } else if (this._updatingSet.has(key)) {
      // await updating
      await this.await(`${key}_changed`);
    }
    this._scheduleUpdateIfAbsent(serviceName, clusters, env, allIPs);
    return this._serviceInfoMap.get(key);
  }

  async updateService4AllIPNow(serviceName, clusters, env) {
    try {
      const params = {
        dom: serviceName,
        clusters,
        udpPort: this._pushReceiver.udpPort + '',
      };
      const key = ServiceInfo.getKey(serviceName, clusters, env, true);
      const oldService = this._serviceInfoMap.get(key);
      if (oldService) {
        params.checksum = oldService.checksum;
      }

      const result = await this.serverProxy.reqAPI(Constants.NACOS_URL_BASE + '/api/srvAllIP', params);
      if (result) {
        const serviceInfo = this.processServiceJSON(result);
        serviceInfo.isAllIPs = true;
      }
      this.logger.debug('[HostReactor] updateService4AllIPNow() serviceName: %s, clusters: %s, env: %s, result: %s',
        serviceName, clusters, env, result);
    } catch (err) {
      err.message = 'failed to update serviceName: ' + serviceName + ', caused by: ' + err.message;
      this.emit('error', err);
    }
  }

  async updateServiceNow(serviceName, clusters, env) {
    const key = ServiceInfo.getKey(serviceName, clusters, env, false);
    const oldService = this._serviceInfoMap.get(key);
    try {
      const params = {
        dom: serviceName,
        clusters,
        udpPort: this._pushReceiver.udpPort + '',
        env,
        clientIP: localIp,
        unconsistentDom: '', // TODO:
      };

      const envSpliter = ',';
      if (env && !env.includes(envSpliter)) {
        params.useEnvId = 'true';
      }
      if (oldService) {
        params.checksum = oldService.checksum;
      }
      const result = await this.serverProxy.reqAPI(Constants.NACOS_URL_BASE + '/api/srvIPXT', params);
      if (result) {
        this.processServiceJSON(result);
      }
      this.logger.debug('[HostReactor] updateServiceNow() serviceName: %s, clusters: %s, env: %s, result: %s',
        serviceName, clusters, env, result);
    } catch (err) {
      err.message = 'failed to update serviceName: ' + serviceName + ', caused by: ' + err.message;
      this.emit('error', err);
    }
  }

  async refreshOnly(serviceName, clusters, env, allIPs) {
    try {
      const params = {
        dom: serviceName,
        clusters,
        udpPort: this._pushReceiver.udpPort + '',
        unit: env,
        clientIP: localIp,
        unconsistentDom: '', // TODO:
      };

      const envSpliter = ',';
      if (env && !env.includes(envSpliter)) {
        params.useEnvId = 'true';
      }

      if (allIPs) {
        await this.serverProxy.reqAPI(Constants.NACOS_URL_BASE + '/api/srvAllIP', params);
      } else {
        await this.serverProxy.reqAPI(Constants.NACOS_URL_BASE + '/api/srvIPXT', params);
      }
    } catch (err) {
      err.message = 'failed to update serviceName: ' + serviceName + ', caused by: ' + err.message;
      this.emit('error', err);
    }
  }

  _scheduleUpdateIfAbsent(serviceName, clusters, env, allIPs) {
    const key = ServiceInfo.getKey(serviceName, clusters, env, allIPs);
    if (this._futureMap.has(key)) {
      return;
    }
    // 第一次延迟 1s 更新
    const timer = setTimeout(() => {
      this._doUpdate(serviceName, clusters, env, allIPs)
        .catch(err => {
          this.emit('error', err);
        });
    }, 1000);
    const task = {
      timer,
      lastRefTime: Infinity,
    };
    this._futureMap.set(key, task);
  }

  async _doUpdate(serviceName, clusters, env, allIPs) {
    const key = ServiceInfo.getKey(serviceName, clusters, env, allIPs);
    const task = this._futureMap.get(key);
    if (!task) return;

    const serviceInfo = this._serviceInfoMap.get(key);
    if (!serviceInfo || serviceInfo.lastRefTime <= task.lastRefTime) {
      if (allIPs) {
        await this.updateService4AllIPNow(serviceName, clusters, env);
      } else {
        await this.updateServiceNow(serviceName, clusters, env);
      }
    } else {
      this.logger.debug('[HostReactor] refreshOnly, serviceInfo.lastRefTime: %s, task.lastRefTime: %s, serviceName: %s, clusters: %s, env: %s',
        serviceInfo.lastRefTime, task.lastRefTime, serviceName, clusters, env);
      // if serviceName already updated by push, we should not override it
      // since the push data may be different from pull through force push
      await this.refreshOnly(serviceName, clusters, env, allIPs);
    }

    if (this._futureMap.has(key)) {
      const serviceInfo = this._serviceInfoMap.get(key);
      let delay = 1000;
      if (serviceInfo) {
        delay = serviceInfo.cacheMillis;
        task.lastRefTime = serviceInfo.lastRefTime;
      }
      const timer = setTimeout(() => {
        this._doUpdate(serviceName, clusters, env, allIPs)
          .catch(err => {
            this.emit('error', err);
          });
      }, delay);
      task.timer = timer;
      this._futureMap.set(key, task);
    }
  }

  close() {
    this._pushReceiver.close();
    this._updatingSet.clear();

    for (const key of this._futureMap.keys()) {
      const task = this._futureMap.get(key);
      clearTimeout(task.timer);
    }
    for (const key of this._serviceInfoMap.keys()) {
      this.unSubscribe(key);
    }
    this._serviceInfoMap.clear();
    this._futureMap.clear();
  }
}

module.exports = HostReactor;
