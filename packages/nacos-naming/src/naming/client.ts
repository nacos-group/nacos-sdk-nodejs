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
/* tslint:enable:no-var-requires */

import { Instance } from './instance';
import { NamingProxy } from './proxy';
import { BeatReactor } from './beat_reactor';
import { HostReactor } from './host_reactor';
import { NacosNamingClientOptions, Host, SubscribeInfo, BeatInfo } from '../interface';
import { getGroupedName } from '../utils';
import { DEFAULT_GROUP } from '../const';

const defaultOptions = {
  namespace: 'public',
};

export class NacosNamingClient extends Base {
  private _serverProxy: NamingProxy;
  private _beatReactor: BeatReactor;
  private _hostReactor: HostReactor;

  constructor(options: NacosNamingClientOptions = {} as NacosNamingClientOptions) {
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

  async _init(): Promise<void> {
    await this._hostReactor.ready();
  }

  get logger(): any {
    return this.options.logger;
  }

  async registerInstance(serviceName: string, instance: any, groupName: string = DEFAULT_GROUP): Promise<void> {
    if (!(instance instanceof Instance)) {
      instance = new Instance(instance);
    }
    const serviceNameWithGroup = getGroupedName(serviceName, groupName);
    if (instance.ephemeral) {
      const beatInfo: BeatInfo = {
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

  async deregisterInstance(serviceName: string, instance: any, groupName: string = DEFAULT_GROUP): Promise<void> {
    if (!(instance instanceof Instance)) {
      instance = new Instance(instance);
    }
    const serviceNameWithGroup = getGroupedName(serviceName, groupName);
    this._beatReactor.removeBeatInfo(serviceNameWithGroup, instance.ip, instance.port);
    await this._serverProxy.deregisterService(serviceNameWithGroup, instance);
  }

  async getAllInstances(serviceName: string, groupName: string = DEFAULT_GROUP, clusters: string = '', subscribe: boolean = true): Promise<Host[]> {
    let serviceInfo: any;
    const serviceNameWithGroup = getGroupedName(serviceName, groupName);
    if (subscribe) {
      serviceInfo = await this._hostReactor.getServiceInfo(serviceNameWithGroup, clusters);
    } else {
      serviceInfo = await this._hostReactor.getServiceInfoDirectlyFromServer(serviceNameWithGroup, clusters);
    }
    if (!serviceInfo) return [];
    return serviceInfo.hosts;
  }

  async selectInstances(serviceName: string, groupName: string = DEFAULT_GROUP, clusters: string = '', healthy: boolean = true, subscribe: boolean = true): Promise<Host[]> {
    let serviceInfo: any;
    const serviceNameWithGroup = getGroupedName(serviceName, groupName);
    if (subscribe) {
      serviceInfo = await this._hostReactor.getServiceInfo(serviceNameWithGroup, clusters);
    } else {
      serviceInfo = await this._hostReactor.getServiceInfoDirectlyFromServer(serviceNameWithGroup, clusters);
    }
    if (!serviceInfo || !serviceInfo.hosts || !serviceInfo.hosts.length) {
      return [];
    }
    return serviceInfo.hosts.filter((host: Host) => {
      return host.healthy === healthy && host.enabled && host.weight > 0;
    });
  }

  async getServerStatus(): Promise<string> {
    const isHealthy = await this._serverProxy.serverHealthy();
    return isHealthy ? 'UP' : 'DOWN';
  }

  subscribe(info: string | SubscribeInfo, listener: (hosts: Host[]) => void): void {
    if (typeof info === 'string') {
      info = {
        serviceName: info,
      };
    }
    const groupName = info.groupName || DEFAULT_GROUP;
    const serviceNameWithGroup = getGroupedName(info.serviceName, groupName);
    this._hostReactor.subscribe({
      serviceName: serviceNameWithGroup,
      clusters: info.clusters || '',
    }, listener);
  }

  unSubscribe(info: string | SubscribeInfo, listener?: (hosts: Host[]) => void): void {
    if (typeof info === 'string') {
      info = {
        serviceName: info,
      };
    }
    const groupName = info.groupName || DEFAULT_GROUP;
    const serviceNameWithGroup = getGroupedName(info.serviceName, groupName);
    this._hostReactor.unSubscribe({
      serviceName: serviceNameWithGroup,
      clusters: info.clusters || '',
    }, listener);
  }

  async _close(): Promise<void> {
    await this._beatReactor.close();
    await this._hostReactor.close();
  }
}
