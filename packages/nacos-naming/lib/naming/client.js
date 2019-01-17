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

    this._serverProxy = new NamingProxy({
      logger: this.logger,
      serverList: this.options.serverList,
    });
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

  async registerInstance(serviceName, ip, port, clusterName = Constants.NAMING_DEFAULT_CLUSTER_NAME) {
    let instance = null;
    if (typeof ip === 'object') {
      instance = new Instance(ip);
    } else {
      instance = new Instance({
        ip,
        port,
        weight: 1,
        clusterName,
      });
    }
    const beatInfo = {
      port: instance.port,
      ip: instance.ip,
      weight: instance.weight,
      metadata: instance.metadata,
      dom: serviceName,
    };
    this._beatReactor.addBeatInfo(serviceName, beatInfo);
    await this._serverProxy.registerService(serviceName, instance);
  }

  async deregisterInstance(serviceName, ip, port, clusterName = Constants.NAMING_DEFAULT_CLUSTER_NAME) {
    this._beatReactor.removeBeatInfo(serviceName, ip, port);
    await this._serverProxy.deregisterService(serviceName, ip, port, clusterName);
  }

  async getAllInstances(serviceName, clusters = []) {
    const serviceInfo = await this._hostReactor.getServiceInfo({
      serviceName,
      clusters,
      allIPs: false,
      env: '',
    });
    if (!serviceInfo) return [];
    return serviceInfo.hosts;
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
    this._hostReactor.subscribe(info, listener);
  }

  unSubscribe(info, listener) {
    if (typeof info === 'string') {
      info = {
        serviceName: info,
      };
    }
    this._hostReactor.unSubscribe(info, listener);
  }

  close() {
    this._beatReactor.close();
    this._hostReactor.close();
  }
}

module.exports = NacosNamingClient;
