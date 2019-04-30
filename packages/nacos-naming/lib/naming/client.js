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

const utils = require('../util');
const Base = require('sdk-base');
const assert = require('assert');
const Instance = require('./instance');
const NamingProxy = require('./proxy');
const BeatReactor = require('./beat_reactor');
const HostReactor = require('./host_reactor');
const Constants = require('../const');

const defaultOptions = {
  namespace: 'default',
};

class NacosNamingClient extends Base {
  constructor(options = {}) {
    assert(options.logger, '');
    super(Object.assign({}, defaultOptions, options, { initMethod: '_init' }));

    this._serverProxy = new NamingProxy(this.options);
    this._beatReactor = new BeatReactor({
      serverProxy: this._serverProxy,
      logger: this.logger,
    });
    this._hostReactor = new HostReactor({
      serverProxy: this._serverProxy,
      logger: this.logger,
    });
  }

  async _init() {
    await this._hostReactor.ready();
  }

  get logger() {
    return this.options.logger;
  }

  async registerInstance(serviceName, instance, groupName = Constants.DEFAULT_GROUP) {
    if (!(instance instanceof Instance)) {
      instance = new Instance(instance);
    }
    const serviceNameWithGroup = utils.getGroupedName(serviceName, groupName);
    if (instance.ephemeral) {
      const beatInfo = {
        serviceName: serviceNameWithGroup,
        ip: instance.ip,
        port: instance.port,
        cluster: instance.clusterName,
        weight: instance.weight,
        metadata: instance.metadata,
        scheduled: false,
      };
      this._beatReactor.addBeatInfo(serviceNameWithGroup, beatInfo);
    }
    await this._serverProxy.registerService(serviceNameWithGroup, groupName, instance);
  }

  async deregisterInstance(serviceName, instance, groupName = Constants.DEFAULT_GROUP) {
    if (!(instance instanceof Instance)) {
      instance = new Instance(instance);
    }
    const serviceNameWithGroup = utils.getGroupedName(serviceName, groupName);
    this._beatReactor.removeBeatInfo(serviceNameWithGroup, instance.ip, instance.port);
    await this._serverProxy.deregisterService(serviceName, instance);
  }

  async getAllInstances(serviceName, groupName = Constants.DEFAULT_GROUP, clusters = '', subscribe = true) {
    let serviceInfo;
    const serviceNameWithGroup = utils.getGroupedName(serviceName, groupName);
    if (subscribe) {
      serviceInfo = await this._hostReactor.getServiceInfo(serviceNameWithGroup, clusters);
    } else {
      serviceInfo = await this._hostReactor.getServiceInfoDirectlyFromServer(serviceNameWithGroup, clusters);
    }
    if (!serviceInfo) return [];
    return serviceInfo.hosts;
  }

  async selectInstances(serviceName, groupName = Constants.DEFAULT_GROUP, clusters = '', healthy = true, subscribe = true) {
    let serviceInfo;
    const serviceNameWithGroup = utils.getGroupedName(serviceName, groupName);
    if (subscribe) {
      serviceInfo = await this._hostReactor.getServiceInfo(serviceNameWithGroup, clusters);
    } else {
      serviceInfo = await this._hostReactor.getServiceInfoDirectlyFromServer(serviceNameWithGroup, clusters);
    }
    if (!serviceInfo || !serviceInfo.hosts || !serviceInfo.hosts.length) {
      return [];
    }
    return serviceInfo.hosts.filter(host => {
      return host.healthy === healthy && host.enabled && host.weight > 0;
    });
  }

  async getServerStatus() {
    const isHealthy = await this._serverProxy.serverHealthy();
    return isHealthy ? 'UP' : 'DOWN';
  }

  subscribe(info, listener) {
    if (typeof info === 'string') {
      info = {
        serviceName: info,
      };
    }
    const groupName = info.groupName || Constants.DEFAULT_GROUP;
    const serviceNameWithGroup = utils.getGroupedName(info.serviceName, groupName);
    this._hostReactor.subscribe({
      serviceName: serviceNameWithGroup,
      clusters: info.clusters || '',
    }, listener);
  }

  unSubscribe(info, listener) {
    if (typeof info === 'string') {
      info = {
        serviceName: info,
      };
    }
    const groupName = info.groupName || Constants.DEFAULT_GROUP;
    const serviceNameWithGroup = utils.getGroupedName(info.serviceName, groupName);
    this._hostReactor.unSubscribe({
      serviceName: serviceNameWithGroup,
      clusters: info.clusters || '',
    }, listener);
  }

  async _close() {
    await this._beatReactor.close();
    await this._hostReactor.close();
  }
}

module.exports = NacosNamingClient;
