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

import { ClientWorker, ServerListManager, Snapshot } from '../src';
import { HttpAgent } from '../src/http_agent';
import { GrpcConfigProxy } from '../src/grpc_config_proxy';
import { DataClient } from '../src/client';
import { createDefaultConfiguration } from './utils';
import * as path from 'path';
import * as mm from 'mm';
import * as assert from 'assert';

const cacheDir = path.join(__dirname, '.cache_cas');

describe('test/publish_config_cas.test.ts', () => {

  afterEach(mm.restore);

  describe('ClientWorker.publishSingle casMd5 (HTTP transport)', () => {
    let client: ClientWorker;

    before(() => {
      const configuration = createDefaultConfiguration({
        serverAddr: '127.0.0.1:8848',
        namespace: '',
        cacheDir,
      });
      const snapshot = new Snapshot({ configuration });
      const serverMgr = new ServerListManager({ configuration });
      const httpAgent = new HttpAgent({ configuration });
      configuration.merge({ snapshot, serverMgr, httpAgent });
      client = new ClientWorker({ configuration });
    });

    it('should pass casMd5 in publish request', async () => {
      let captured;
      mm(client.httpAgent, 'request', async (path, options) => {
        captured = options;
      });
      const success = await client.publishSingle('cas-data-id', 'cas-group', 'content-v2', { casMd5: 'md5-of-v1' });
      assert(success === true);
      assert(captured.data.casMd5 === 'md5-of-v1');
      assert(captured.data.dataId === 'cas-data-id');
      assert(captured.data.content === 'content-v2');
    });

    it('should not pass casMd5 when absent', async () => {
      let captured;
      mm(client.httpAgent, 'request', async (path, options) => {
        captured = options;
      });
      await client.publishSingle('cas-data-id', 'cas-group', 'content-v1');
      assert(!('casMd5' in captured.data));
    });
  });

  describe('GrpcConfigProxy.publishSingle casMd5 (gRPC transport)', () => {
    const capturedRequests: any[] = [];
    let resultCode = 200;
    const transportClient: any = {
      request: async (request, type) => {
        capturedRequests.push({ request, type });
        return { resultCode };
      },
      registerServerPushHandler: () => {},
      onReconnect: () => {},
    };
    const proxy = new GrpcConfigProxy({
      transportClient,
      namespace: 'public',
      logger: console,
    });

    beforeEach(() => {
      capturedRequests.length = 0;
      resultCode = 200;
    });

    it('should set casMd5 on ConfigPublishRequest', async () => {
      const success = await proxy.publishSingle('cas-data-id', 'cas-group', 'public', 'content-v2', undefined, 'md5-of-v1');
      assert(success === true);
      assert(capturedRequests.length === 1);
      assert(capturedRequests[0].type === 'ConfigPublishRequest');
      assert(capturedRequests[0].request.casMd5 === 'md5-of-v1');
    });

    it('should not set casMd5 when absent', async () => {
      await proxy.publishSingle('cas-data-id', 'cas-group', 'public', 'content-v1');
      assert(!('casMd5' in capturedRequests[0].request));
    });

    it('should return false when server rejects cas md5', async () => {
      resultCode = 401;
      const success = await proxy.publishSingle('cas-data-id', 'cas-group', 'public', 'content-v2', undefined, 'stale-md5');
      assert(success === false);
    });
  });

  describe('DataClient.publishConfigCas', () => {
    let client: DataClient;

    before(() => {
      client = new DataClient({
        serverAddr: '127.0.0.1:8848',
        namespace: '',
        transport: 'http',
      } as any);
    });

    after(() => {
      client.close();
    });

    afterEach(() => {
      (client as any)._grpcConfigProxy = null;
    });

    it('should throw when casMd5 is missing', async () => {
      await assert.rejects(
        () => client.publishConfigCas('cas-data-id', 'cas-group', 'content', undefined as any),
        /requires casMd5/
      );
    });

    it('should delegate to grpc proxy with casMd5', async () => {
      let capturedArgs;
      (client as any)._grpcConfigProxy = {
        publishSingle: async (...args) => {
          capturedArgs = args;
          return true;
        },
      };
      const success = await client.publishConfigCas('cas-data-id', 'cas-group', 'content-v2', 'md5-of-v1');
      assert(success === true);
      assert(capturedArgs[0] === 'cas-data-id');
      assert(capturedArgs[5] === 'md5-of-v1');
    });

    it('should delegate to worker with casMd5 in options', async () => {
      let capturedOptions;
      mm(client, 'getClient', () => ({
        publishConfigCas: async (dataId, group, content, casMd5, options) => {
          capturedOptions = { casMd5, ...options };
          return true;
        },
      }));
      const success = await client.publishConfigCas('cas-data-id', 'cas-group', 'content-v2', 'md5-of-v1', { type: 'properties' } as any);
      assert(success === true);
      assert(capturedOptions.casMd5 === 'md5-of-v1');
      assert(capturedOptions.type === 'properties');
    });
  });
});
