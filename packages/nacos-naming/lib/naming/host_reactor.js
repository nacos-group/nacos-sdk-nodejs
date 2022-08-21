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
const equals = require('equals');

class HostReactor extends Base {
  constructor(options = {}) {
    assert(options.logger, '[HostReactor] options.logger is required');
    assert(options.serverProxy, '[HostReactor] options.serverProxy is required');
    super(Object.assign({}, options, { initMethod: '_init' }));

    // TODO:
    // cacheDir

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
    await Promise.all([
      this.serverProxy.ready(),
      this._pushReceiver.ready(),
    ]);
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

        if (oldHostMap.has(key) && !equals(host, oldHostMap.get(key))) {
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
    return serviceInfo;
  }

  _getKey(param) {
    const serviceName = param.serviceName;
    const clusters = param.clusters || Constants.NAMING_DEFAULT_CLUSTER_NAME;
    return ServiceInfo.getKey(serviceName, clusters);
  }

  subscribe(param, listener) {
    const key = this._getKey(param);
    const serviceInfo = this._serviceInfoMap.get(key);
    if (serviceInfo) {
      setImmediate(() => { listener(serviceInfo.hosts); });
    } else {
      this.getServiceInfo(param.serviceName, param.clusters || Constants.NAMING_DEFAULT_CLUSTER_NAME);
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

  async getServiceInfoDirectlyFromServer(serviceName, clusters = Constants.NAMING_DEFAULT_CLUSTER_NAME) {
    const result = await this.serverProxy.queryList(serviceName, clusters, 0, false);
    if (result) {
      return this.processServiceJSON(result);
    }
    return null;
  }

  async getServiceInfo(serviceName, clusters = Constants.NAMING_DEFAULT_CLUSTER_NAME) {
    const key = ServiceInfo.getKey(serviceName, clusters);
    // TODO: failover

    let serviceInfo = this._serviceInfoMap.get(key);
    if (!serviceInfo) {
      serviceInfo = new ServiceInfo({
        name: serviceName,
        clusters,
        hosts: [],
      });
      this._serviceInfoMap.set(key, serviceInfo);
      this._updatingSet.add(key);
      await this.updateServiceNow(serviceName, clusters);
      this._updatingSet.delete(key);
    } else if (this._updatingSet.has(key)) {
      // await updating
      await this.await(`${key}_changed`);
    }
    this._scheduleUpdateIfAbsent(serviceName, clusters);
    return this._serviceInfoMap.get(key);
  }

  async updateServiceNow(serviceName, clusters) {
    try {
      const result = await this.serverProxy.queryList(serviceName, clusters, this._pushReceiver.udpPort, false);
      if (result) {
        this.processServiceJSON(result);
      }
      this.logger.debug('[HostReactor] updateServiceNow() serviceName: %s, clusters: %s, result: %s', serviceName, clusters, result);
    } catch (err) {
      err.message = 'failed to update serviceName: ' + serviceName + ', caused by: ' + err.message;
      if (err.status === 404) {
        this.logger.warn(err.message);
      } else {
        this.emit('error', err);
      }
    }
  }

  async refreshOnly(serviceName, clusters) {
    try {
      await this.serverProxy.queryList(serviceName, clusters, this._pushReceiver.udpPort, false);
    } catch (err) {
      err.message = 'failed to update serviceName: ' + serviceName + ', caused by: ' + err.message;
      this.emit('error', err);
    }
  }

  _scheduleUpdateIfAbsent(serviceName, clusters) {
    const key = ServiceInfo.getKey(serviceName, clusters);
    if (this._futureMap.has(key)) {
      return;
    }
    // 第一次延迟 1s 更新
    const timer = setTimeout(() => {
      this._doUpdate(serviceName, clusters)
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

  async _doUpdate(serviceName, clusters) {
    const key = ServiceInfo.getKey(serviceName, clusters);
    const task = this._futureMap.get(key);
    if (!task) return;

    const serviceInfo = this._serviceInfoMap.get(key);
    if (!serviceInfo || serviceInfo.lastRefTime <= task.lastRefTime) {
      await this.updateServiceNow(serviceName, clusters);
    } else {
      this.logger.debug('[HostReactor] refreshOnly, serviceInfo.lastRefTime: %s, task.lastRefTime: %s, serviceName: %s, clusters: %s',
        serviceInfo.lastRefTime, task.lastRefTime, serviceName, clusters);
      // if serviceName already updated by push, we should not override it
      // since the push data may be different from pull through force push
      await this.refreshOnly(serviceName, clusters);
    }

    if (this._futureMap.has(key)) {
      const serviceInfo = this._serviceInfoMap.get(key);
      let delay = Constants.DEFAULT_DELAY;
      if (serviceInfo) {
        delay = serviceInfo.cacheMillis;
        task.lastRefTime = serviceInfo.lastRefTime;
      }
      const timer = setTimeout(() => {
        this._doUpdate(serviceName, clusters)
          .catch(err => {
            this.emit('error', err);
          });
      }, delay);
      task.timer = timer;
      this._futureMap.set(key, task);
    }
  }

  async _close() {
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
