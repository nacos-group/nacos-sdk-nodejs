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

import { GrpcTransportClient } from 'nacos-common';
import {
  BeatInfo,
  ServiceListResult,
  NamingTransport,
} from '../interface';
import { SERVICE_INFO_SPLITER, DEFAULT_GROUP } from '../const';

function splitGroupedName(nameWithGroup: string): { serviceName: string; groupName: string } {
  if (nameWithGroup.includes(SERVICE_INFO_SPLITER)) {
    const parts = nameWithGroup.split(SERVICE_INFO_SPLITER);
    return { groupName: parts[0], serviceName: parts[1] };
  }
  return { groupName: DEFAULT_GROUP, serviceName: nameWithGroup };
}

export class GrpcNamingProxy extends Base implements NamingTransport {
  private _transportClient: GrpcTransportClient;
  private _namespace: string;
  private _logger: any;
  private _registeredInstances: Map<string, { serviceName: string; groupName: string; instance: any }>;
  private _activeSubscriptions: Map<string, { serviceName: string; groupName: string; clusters: string }>;

  constructor(options: { transportClient: GrpcTransportClient; namespace?: string; logger: any }) {
    assert(options.logger, '[GrpcNamingProxy] options.logger is required');
    assert(options.transportClient, '[GrpcNamingProxy] options.transportClient is required');
    super({ logger: options.logger });
    this._transportClient = options.transportClient;
    this._namespace = options.namespace || 'public';
    this._logger = options.logger;
    this._registeredInstances = new Map();
    this._activeSubscriptions = new Map();

    this._transportClient.onReconnect(() => this._onReconnect());
  }

  private async _onReconnect(): Promise<void> {
    this._logger.info('[GrpcNamingProxy] reconnected, recovering %d instances and %d subscriptions',
      this._registeredInstances.size, this._activeSubscriptions.size);

    for (const { serviceName, instance } of this._registeredInstances.values()) {
      try {
        const { serviceName: svc, groupName: grp } = splitGroupedName(serviceName);
        await this._transportClient.request({
          namespace: this._namespace,
          serviceName: svc,
          groupName: grp,
          type: 'registerInstance',
          instance: {
            instanceId: instance.instanceId || '',
            ip: instance.ip,
            port: instance.port,
            weight: instance.weight != null ? instance.weight : 1.0,
            healthy: instance.healthy !== false,
            enabled: instance.enabled !== false,
            ephemeral: instance.ephemeral !== false,
            clusterName: instance.clusterName || 'DEFAULT',
            serviceName: svc,
            metadata: instance.metadata || {},
          },
        }, 'InstanceRequest', 5000);
        this._logger.info('[GrpcNamingProxy] re-registered instance %s:%d for %s', instance.ip, instance.port, serviceName);
      } catch (err) {
        this._logger.warn('[GrpcNamingProxy] re-register failed for %s: %s', serviceName, (err as Error).message);
      }
    }

    for (const { serviceName, clusters } of this._activeSubscriptions.values()) {
      try {
        const { serviceName: svc, groupName: grp } = splitGroupedName(serviceName);
        await this._transportClient.request({
          namespace: this._namespace,
          serviceName: svc,
          groupName: grp,
          clusters,
          subscribe: true,
        }, 'SubscribeServiceRequest', 5000);
        this._logger.info('[GrpcNamingProxy] re-subscribed %s', serviceName);
      } catch (err) {
        this._logger.warn('[GrpcNamingProxy] re-subscribe failed for %s: %s', serviceName, (err as Error).message);
      }
    }
  }

  get logger(): any {
    return this._logger;
  }

  async ready(): Promise<void> {
    // Nothing to initialize for proxy itself; connection is managed externally.
  }

  async registerService(serviceName: string, groupName: string, instance: any): Promise<string> {
    this._logger.info('[GrpcNamingProxy][REGISTER-SERVICE] %s registering service: %s with instance:%j', this._namespace, serviceName, instance);

    const key = `${serviceName}@@${instance.ip}:${instance.port}`;
    this._registeredInstances.set(key, { serviceName, groupName, instance });

    const { serviceName: svc, groupName: grp } = splitGroupedName(serviceName);
    const request = {
      namespace: this._namespace,
      serviceName: svc,
      groupName: grp,
      type: 'registerInstance',
      instance: {
        instanceId: instance.instanceId || '',
        ip: instance.ip,
        port: instance.port,
        weight: instance.weight != null ? instance.weight : 1.0,
        healthy: instance.healthy !== false,
        enabled: instance.enabled !== false,
        ephemeral: instance.ephemeral !== false,
        clusterName: instance.clusterName || 'DEFAULT',
        serviceName,
        metadata: instance.metadata || {},
      },
    };

    const response = await this._transportClient.request(request, 'InstanceRequest');
    return response.resultCode === 200 ? 'ok' : JSON.stringify(response);
  }

  async deregisterService(serviceName: string, instance: any): Promise<string> {
    this._logger.info('[GrpcNamingProxy][DEREGISTER-SERVICE] %s deregistering service: %s with instance:%j', this._namespace, serviceName, instance);

    const key = `${serviceName}@@${instance.ip}:${instance.port}`;
    this._registeredInstances.delete(key);

    const { serviceName: svc, groupName: grp } = splitGroupedName(serviceName);
    const request = {
      namespace: this._namespace,
      serviceName: svc,
      groupName: grp,
      type: 'deregisterInstance',
      instance: {
        instanceId: instance.instanceId || '',
        ip: instance.ip,
        port: instance.port,
        weight: instance.weight != null ? instance.weight : 1.0,
        healthy: instance.healthy !== false,
        enabled: instance.enabled !== false,
        ephemeral: instance.ephemeral !== false,
        clusterName: instance.clusterName || 'DEFAULT',
        serviceName,
        metadata: instance.metadata || {},
      },
    };

    const response = await this._transportClient.request(request, 'InstanceRequest');
    return response.resultCode === 200 ? 'ok' : JSON.stringify(response);
  }

  async queryList(serviceName: string, clusters: string, udpPort: number, healthyOnly: boolean): Promise<string> {
    const { serviceName: svc, groupName: grp } = splitGroupedName(serviceName);
    const request = {
      namespace: this._namespace,
      serviceName: svc,
      groupName: grp,
      cluster: clusters,
      healthyOnly,
      udpPort,
    };

    const response: any = await this._transportClient.request(request, 'ServiceQueryRequest');
    // Extract serviceInfo from QueryServiceResponse and return as JSON string
    // HostReactor.processServiceJSON expects flat structure with hosts at top level
    const si = response.serviceInfo || {};
    return JSON.stringify({
      name: si.name || serviceName,
      dom: si.name || serviceName,
      groupName: si.groupName || '',
      clusters: si.clusters || clusters,
      cacheMillis: si.cacheMillis || 10000,
      hosts: si.hosts || [],
      lastRefTime: si.lastRefTime || Date.now(),
      checksum: si.checksum || '',
    });
  }

  /**
   * No-op in gRPC mode: heartbeats are managed by the persistent gRPC connection.
   */
  async sendBeat(_beatInfo: BeatInfo): Promise<number> {
    return 0;
  }

  async serverHealthy(): Promise<boolean> {
    try {
      const response = await this._transportClient.request({}, 'ServerCheckRequest');
      return !!(response && response.connectionId);
    } catch (_err) {
      return false;
    }
  }

  async getServiceList(pageNo: number, pageSize: number, groupName?: string): Promise<ServiceListResult> {
    const request = {
      namespace: this._namespace,
      groupName: groupName || '',
      pageNo,
      pageSize,
    };

    const response = await this._transportClient.request(request, 'ServiceListRequest');
    return {
      count: Number(response.count || 0),
      data: response.serviceNames || [],
    };
  }

  async subscribe(serviceName: string, groupName: string, clusters: string): Promise<string> {
    const { serviceName: svc, groupName: grp } = splitGroupedName(serviceName);
    const request = {
      namespace: this._namespace,
      serviceName: svc,
      groupName: grp,
      clusters,
      subscribe: true,
    };

    const response: any = await this._transportClient.request(request, 'SubscribeServiceRequest');
    const key = `${serviceName}@@${clusters}`;
    this._activeSubscriptions.set(key, { serviceName, groupName: grp, clusters });

    const si = response.serviceInfo || {};
    return JSON.stringify({
      name: si.name || svc,
      dom: si.name || svc,
      groupName: si.groupName || grp,
      clusters: si.clusters || clusters,
      cacheMillis: si.cacheMillis || 10000,
      hosts: si.hosts || [],
      lastRefTime: si.lastRefTime || Date.now(),
      checksum: si.checksum || '',
    });
  }

  async unSubscribe(serviceName: string, groupName: string, clusters: string): Promise<void> {
    const { serviceName: svc, groupName: grp } = splitGroupedName(serviceName);
    const request = {
      namespace: this._namespace,
      serviceName: svc,
      groupName: grp,
      clusters,
      subscribe: false,
    };

    try {
      await this._transportClient.request(request, 'SubscribeServiceRequest');
    } catch (err) {
      this._logger.warn('[GrpcNamingProxy] unSubscribe failed: %s', (err as Error).message);
    }
    const key = `${serviceName}@@${clusters}`;
    this._activeSubscriptions.delete(key);
  }

  registerPushHandler(handler: (serviceInfoJson: string) => void): void {
    this._transportClient.registerServerPushHandler(
      'NotifySubscriberRequest',
      (request: any) => {
        const si = request.serviceInfo || {};
        const json = JSON.stringify({
          name: si.name || '',
          dom: si.name || '',
          groupName: si.groupName || '',
          clusters: si.clusters || '',
          cacheMillis: si.cacheMillis || 10000,
          hosts: si.hosts || [],
          lastRefTime: si.lastRefTime || Date.now(),
          checksum: si.checksum || '',
        });
        handler(json);
        return { __type: 'NotifySubscriberResponse', resultCode: 200, message: 'success' };
      }
    );
  }

  async close(): Promise<void> {
    this._transportClient.removeServerPushHandler('NotifySubscriberRequest');
    this._registeredInstances.clear();
    this._activeSubscriptions.clear();
  }

  getRegisteredInstances(): Map<string, { serviceName: string; groupName: string; instance: any }> {
    return this._registeredInstances;
  }

  getActiveSubscriptions(): Map<string, { serviceName: string; groupName: string; clusters: string }> {
    return this._activeSubscriptions;
  }
}
