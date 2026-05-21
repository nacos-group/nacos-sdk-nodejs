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
const Base = require('sdk-base');
const assert = require('assert');
const equals = require('equals');
/* tslint:enable:no-var-requires */

import { ServiceInfo } from './service_info';
import { PushReceiver } from './push_receiver';
import { Host } from '../interface';
import { NAMING_DEFAULT_CLUSTER_NAME, DEFAULT_DELAY } from '../const';

interface FutureTask {
  timer: any;
  lastRefTime: number;
}

// Helper function to wait for an event
function waitForEvent(emitter: any, eventName: string, timeout = 30000): Promise<any> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      emitter.removeListener(eventName, handler);
      reject(new Error(`Timeout waiting for event ${eventName}`));
    }, timeout);

    function handler(data: any) {
      clearTimeout(timer);
      resolve(data);
    }

    emitter.once(eventName, handler);
  });
}

export class HostReactor extends Base {
  private _serviceInfoMap: Map<string, ServiceInfo>;
  private _updatingSet: Set<string>;
  private _futureMap: Map<string, FutureTask>;
  private _pushReceiver: PushReceiver | null;

  constructor(options: any = {}) {
    assert(options.logger, '[HostReactor] options.logger is required');
    assert(options.serverProxy, '[HostReactor] options.serverProxy is required');
    super(Object.assign({}, options, { initMethod: '_init' }));

    this._serviceInfoMap = new Map();
    this._updatingSet = new Set();
    this._futureMap = new Map();
    this._pushReceiver = options.transport === 'grpc' ? null : new PushReceiver(this);
  }

  get logger(): any {
    return this.options.logger;
  }

  get serverProxy(): any {
    return this.options.serverProxy;
  }

  get getServiceInfoMap(): Record<string, ServiceInfo> {
    const map: Record<string, ServiceInfo> = {};
    for (const key of this._serviceInfoMap.keys()) {
      map[key] = this._serviceInfoMap.get(key)!;
    }
    return map;
  }

  async _init(): Promise<void> {
    const waits: Promise<void>[] = [this.serverProxy.ready()];
    if (this._pushReceiver) {
      waits.push(this._pushReceiver.ready());
    }
    await Promise.all(waits);
  }

  processServiceJSON(json: string): ServiceInfo | undefined {
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

      const oldHostMap = new Map<string, Host>();
      for (const host of oldService.hosts) {
        const key = host.ip + ':' + host.port;
        oldHostMap.set(key, host);
      }

      const modHosts: Host[] = [];
      const newHosts: Host[] = [];
      const remvHosts: Host[] = [];

      const newHostMap = new Map<string, Host>();
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
          remvHosts.push(oldHostMap.get(key)!);
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
        // TODO: local cache
      } else if (oldHostMap.size === 0) {
        this.emit(`${serviceInfo.getKey()}_changed`, serviceInfo.hosts, serviceInfo);
      }
    } else {
      this._serviceInfoMap.set(serviceInfo.getKey(), serviceInfo);
      this.emit(`${serviceInfo.getKey()}_changed`, serviceInfo.hosts, serviceInfo);
      // TODO: local cache
    }
    return serviceInfo;
  }

  _getKey(param: { serviceName: string; clusters?: string }): string {
    const serviceName = param.serviceName;
    const clusters = param.clusters || NAMING_DEFAULT_CLUSTER_NAME;
    return ServiceInfo.getKey(serviceName, clusters);
  }

  subscribe(param: { serviceName: string; clusters?: string }, listener: (hosts: Host[]) => void): void {
    const key = this._getKey(param);
    const serviceInfo = this._serviceInfoMap.get(key);
    if (serviceInfo) {
      setImmediate(() => { listener(serviceInfo.hosts); });
    } else {
      this.getServiceInfo(param.serviceName, param.clusters || NAMING_DEFAULT_CLUSTER_NAME);
    }
    this.on(key + '_changed', listener);
  }

  unSubscribe(param: { serviceName: string; clusters?: string }, listener?: (hosts: Host[]) => void): void {
    const key = this._getKey(param);
    if (listener) {
      this.removeListener(key + '_changed', listener);
    } else {
      this.removeAllListeners(key + '_changed');
    }
  }

  async getServiceInfoDirectlyFromServer(serviceName: string, clusters: string = NAMING_DEFAULT_CLUSTER_NAME): Promise<ServiceInfo | null> {
    const result = await this.serverProxy.queryList(serviceName, clusters, 0, false);
    if (result) {
      return this.processServiceJSON(result) || null;
    }
    return null;
  }

  async getServiceInfo(serviceName: string, clusters: string = NAMING_DEFAULT_CLUSTER_NAME): Promise<ServiceInfo | undefined> {
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
      // wait for updating to complete
      await waitForEvent(this, `${key}_changed`);
    }
    this._scheduleUpdateIfAbsent(serviceName, clusters);
    return this._serviceInfoMap.get(key);
  }

  async updateServiceNow(serviceName: string, clusters: string): Promise<void> {
    try {
      const udpPort = this._pushReceiver ? this._pushReceiver.udpPort : 0;
      const result = await this.serverProxy.queryList(serviceName, clusters, udpPort, false);
      if (result) {
        this.processServiceJSON(result);
      }
      this.logger.debug('[HostReactor] updateServiceNow() serviceName: %s, clusters: %s, result: %s', serviceName, clusters, result);
    } catch (err) {
      (err as any).message = 'failed to update serviceName: ' + serviceName + ', caused by: ' + (err as any).message;
      if ((err as any).status === 404) {
        this.logger.warn((err as any).message);
      } else {
        this.emit('error', err);
      }
    }
  }

  async refreshOnly(serviceName: string, clusters: string): Promise<void> {
    try {
      const udpPort = this._pushReceiver ? this._pushReceiver.udpPort : 0;
      await this.serverProxy.queryList(serviceName, clusters, udpPort, false);
    } catch (err) {
      (err as any).message = 'failed to update serviceName: ' + serviceName + ', caused by: ' + (err as any).message;
      this.emit('error', err);
    }
  }

  _scheduleUpdateIfAbsent(serviceName: string, clusters: string): void {
    const key = ServiceInfo.getKey(serviceName, clusters);
    if (this._futureMap.has(key)) {
      return;
    }
    // first update delayed by 1s
    const timer = setTimeout(() => {
      this._doUpdate(serviceName, clusters)
        .catch((err: any) => {
          this.emit('error', err);
        });
    }, 1000);
    const task: FutureTask = {
      timer,
      lastRefTime: Infinity,
    };
    this._futureMap.set(key, task);
  }

  async _doUpdate(serviceName: string, clusters: string): Promise<void> {
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
      const currentServiceInfo = this._serviceInfoMap.get(key);
      let delay = DEFAULT_DELAY;
      if (currentServiceInfo) {
        delay = currentServiceInfo.cacheMillis;
        task.lastRefTime = currentServiceInfo.lastRefTime;
      }
      const timer = setTimeout(() => {
        this._doUpdate(serviceName, clusters)
          .catch((err: any) => {
            this.emit('error', err);
          });
      }, delay);
      task.timer = timer;
      this._futureMap.set(key, task);
    }
  }

  async _close(): Promise<void> {
    if (this._pushReceiver) {
      this._pushReceiver.close();
    }
    this._updatingSet.clear();

    for (const key of this._futureMap.keys()) {
      const task = this._futureMap.get(key)!;
      clearTimeout(task.timer);
    }
    // Fix #130: _close() was calling unSubscribe(key) with a raw string key.
    // Now correctly removes all listeners via removeAllListeners(key + '_changed').
    for (const key of this._serviceInfoMap.keys()) {
      this.removeAllListeners(key + '_changed');
    }
    this._serviceInfoMap.clear();
    this._futureMap.clear();
  }
}
