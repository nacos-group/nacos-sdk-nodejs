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
const Base = require('sdk-base');
/* tslint:enable:no-var-requires */

import { GrpcTransportClient } from 'nacos-common';

interface ListenContext {
  dataId: string;
  group: string;
  tenant: string;
  md5: string;
}

/**
 * GrpcConfigProxy provides config operations (get/publish/remove/listen) over gRPC.
 * Emits 'configChanged' event when the server pushes a config change notification.
 */
export class GrpcConfigProxy extends Base {
  private _transportClient: GrpcTransportClient;
  private _namespace: string;
  private _logger: any;
  /** key: `${dataId}@@${group}@@${tenant}` → ListenContext */
  private _listenContexts: Map<string, ListenContext>;

  constructor(options: { transportClient: GrpcTransportClient; namespace?: string; logger: any }) {
    super({ logger: options.logger });
    this._transportClient = options.transportClient;
    this._namespace = options.namespace || 'public';
    this._logger = options.logger;
    this._listenContexts = new Map();

    // Register server push handler for config change notifications
    this._transportClient.registerServerPushHandler(
      'ConfigChangeNotifyRequest',
      (request: any) => this._onConfigChangeNotify(request)
    );

    // Re-send all listen contexts on reconnect
    this._transportClient.onReconnect(() => this._onReconnect());
  }

  private _listenKey(dataId: string, group: string, tenant: string): string {
    return `${dataId}@@${group}@@${tenant}`;
  }

  private async _onConfigChangeNotify(request: any): Promise<any> {
    const { dataId, group, tenant, namespace } = request;
    const resolvedTenant = tenant || namespace || this._namespace;
    this._logger.info(
      '[GrpcConfigProxy] ConfigChangeNotifyRequest received: dataId=%s, group=%s, tenant=%s',
      dataId, group, resolvedTenant
    );
    this.emit('configChanged', { dataId, group, tenant: resolvedTenant });
    // Return an ack response
    return { __type: 'ConfigChangeNotifyResponse', resultCode: 200, message: 'success' };
  }

  private async _onReconnect(): Promise<void> {
    this._logger.info('[GrpcConfigProxy] Reconnected, re-sending %d listen contexts', this._listenContexts.size);
    if (this._listenContexts.size === 0) return;
    try {
      await this._sendBatchListen(Array.from(this._listenContexts.values()), true);
    } catch (err) {
      this._logger.error('[GrpcConfigProxy] Failed to re-send listen contexts on reconnect: %s', err.message);
    }
  }

  private async _sendBatchListen(contexts: ListenContext[], listen: boolean): Promise<void> {
    if (contexts.length === 0) return;
    const configListenContexts = contexts.map(ctx => ({
      dataId: ctx.dataId,
      group: ctx.group,
      tenant: ctx.tenant,
      md5: ctx.md5,
    }));
    const request = {
      listen,
      configListenContexts,
    };
    try {
      await this._transportClient.request(request, 'ConfigBatchListenRequest');
    } catch (err) {
      this._logger.error('[GrpcConfigProxy] ConfigBatchListenRequest failed: %s', err.message);
      throw err;
    }
  }

  /**
   * Get config value via gRPC ConfigQueryRequest.
   */
  async getConfig(dataId: string, group: string, tenant?: string): Promise<string> {
    const resolvedTenant = tenant != null ? tenant : this._namespace;
    this._logger.info('[GrpcConfigProxy] getConfig dataId=%s group=%s tenant=%s', dataId, group, resolvedTenant);
    const request = {
      dataId,
      group,
      tenant: resolvedTenant,
    };
    const response = await this._transportClient.request(request, 'ConfigQueryRequest');
    return response.content || '';
  }

  /**
   * Publish config via gRPC ConfigPublishRequest.
   */
  async publishSingle(dataId: string, group: string, tenant: string | undefined, content: string, type?: string): Promise<boolean> {
    const resolvedTenant = tenant != null ? tenant : this._namespace;
    this._logger.info('[GrpcConfigProxy] publishSingle dataId=%s group=%s tenant=%s', dataId, group, resolvedTenant);
    const request: any = {
      dataId,
      group,
      tenant: resolvedTenant,
      content,
    };
    if (type) {
      request.type = type;
    }
    const response = await this._transportClient.request(request, 'ConfigPublishRequest');
    return response.resultCode === 200;
  }

  /**
   * Remove config via gRPC ConfigRemoveRequest.
   */
  async remove(dataId: string, group: string, tenant?: string): Promise<boolean> {
    const resolvedTenant = tenant != null ? tenant : this._namespace;
    this._logger.info('[GrpcConfigProxy] remove dataId=%s group=%s tenant=%s', dataId, group, resolvedTenant);
    const request = {
      dataId,
      group,
      tenant: resolvedTenant,
    };
    const response = await this._transportClient.request(request, 'ConfigRemoveRequest');
    return response.resultCode === 200;
  }

  /**
   * Add a config listener. Accumulates in listenContexts and sends a ConfigBatchListenRequest.
   */
  async addListener(dataId: string, group: string, md5: string, tenant?: string): Promise<void> {
    const resolvedTenant = tenant != null ? tenant : this._namespace;
    const key = this._listenKey(dataId, group, resolvedTenant);
    const ctx: ListenContext = { dataId, group, tenant: resolvedTenant, md5 };
    this._listenContexts.set(key, ctx);
    try {
      await this._sendBatchListen([ ctx ], true);
    } catch (err) {
      this._logger.error('[GrpcConfigProxy] addListener failed: %s', err.message);
      throw err;
    }
  }

  /**
   * Remove a config listener. Removes from listenContexts and sends a ConfigBatchListenRequest (un-listen).
   */
  async removeListener(dataId: string, group: string, tenant?: string): Promise<void> {
    const resolvedTenant = tenant != null ? tenant : this._namespace;
    const key = this._listenKey(dataId, group, resolvedTenant);
    const ctx = this._listenContexts.get(key);
    if (!ctx) return;
    this._listenContexts.delete(key);
    try {
      await this._sendBatchListen([ ctx ], false);
    } catch (err) {
      this._logger.error('[GrpcConfigProxy] removeListener failed: %s', err.message);
      // Don't re-throw: already removed from local map
    }
  }

  close(): void {
    this._transportClient.removeServerPushHandler('ConfigChangeNotifyRequest');
    this._listenContexts.clear();
  }
}
