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

import { GrpcConnection, GrpcTransportClient } from 'nacos-common';
import { Instance } from './instance';
import { NamingProxy } from './proxy';
import { GrpcNamingProxy } from './grpc_proxy';
import { BeatReactor } from './beat_reactor';
import { HostReactor } from './host_reactor';
import { NacosNamingClientOptions, Host, SubscribeInfo, BeatInfo } from '../interface';
import { getGroupedName } from '../utils';
import { DEFAULT_GROUP } from '../const';

const defaultOptions = {
  namespace: 'public',
};

export class NacosNamingClient extends Base {
  private _serverProxy: NamingProxy | GrpcNamingProxy;
  private _beatReactor: BeatReactor | null;
  private _hostReactor: HostReactor;
  private _transport: 'grpc' | 'http';
  private _connection: GrpcConnection | null;
  private _transportClient: GrpcTransportClient | null;

  constructor(options: NacosNamingClientOptions = {} as NacosNamingClientOptions) {
    assert(options.logger, '');
    super(Object.assign({}, defaultOptions, options, { initMethod: '_init' }));

    // Default transport is 'grpc'
    this._transport = options.transport || 'grpc';
    this._beatReactor = null;
    this._connection = null;
    this._transportClient = null;

    if (this._transport === 'http') {
      // HTTP mode: existing behavior
      const proxy = new NamingProxy(this.options);
      this._serverProxy = proxy;
      this._beatReactor = new BeatReactor({
        serverProxy: proxy,
        logger: this.logger,
      });
      this._hostReactor = new HostReactor({
        serverProxy: proxy,
        logger: this.logger,
      });
    } else {
      // gRPC mode: use GrpcConnection + GrpcTransportClient + GrpcNamingProxy
      const rawServerList: string[] = typeof options.serverList === 'string'
        ? (options.serverList as string).split(',').map((s: string) => s.trim()).filter(Boolean)
        : (options.serverList as string[]) || [];

      this._connection = new GrpcConnection({
        serverList: rawServerList,
        namespace: options.namespace || 'public',
        ssl: options.ssl,
        logger: options.logger,
        username: options.username,
        password: options.password,
        labels: { source: 'sdk', module: 'naming' },
      });

      this._transportClient = new GrpcTransportClient(this._connection);

      const grpcProxy = new GrpcNamingProxy({
        transportClient: this._transportClient,
        namespace: options.namespace || 'public',
        logger: options.logger,
      });
      this._serverProxy = grpcProxy;

      // No BeatReactor or PushReceiver in gRPC mode
      this._hostReactor = new HostReactor({
        serverProxy: grpcProxy,
        logger: this.logger,
        transport: 'grpc',
      });

      // Wire gRPC server push to HostReactor
      grpcProxy.registerPushHandler((json: string) => {
        this._hostReactor.processServiceJSON(json);
      });
    }
  }

  async _init(): Promise<void> {
    if (this._transport === 'grpc' && this._connection) {
      await this._connection.connect();
    }
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
    if (this._transport === 'http' && this._beatReactor && instance.ephemeral) {
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
    if (this._beatReactor) {
      this._beatReactor.removeBeatInfo(serviceNameWithGroup, instance.ip, instance.port);
    }
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
    if (this._beatReactor) {
      await this._beatReactor.close();
    }
    await this._hostReactor.close();
    if (this._connection) {
      this._connection.close();
    }
  }
}
