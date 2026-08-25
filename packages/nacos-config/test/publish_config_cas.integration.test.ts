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
import { createDefaultConfiguration } from './utils';
import * as crypto from 'crypto';
import * as path from 'path';
import * as assert from 'assert';

const httpclient = require('urllib');

// 需要一个可用的 Nacos server（CI 的 integration-http job 会启动 nacos/nacos-server:v2.5.2）
const SERVER_ADDR = process.env.NACOS_SERVER_ADDR || '127.0.0.1:8848';
const GROUP = 'DEFAULT_GROUP';
const cacheDir = path.join(__dirname, '.cache_cas_integration');

function md5(content: string): string {
  return crypto.createHash('md5').update(content).digest('hex');
}

// Nacos 配置写入后 dump/读取存在秒级异步延迟，期间读可能返回旧值或 404，
// 轮询直到服务端内容与期望一致（直接 HTTP 读，绕过客户端快照缓存）
async function waitForServerContent(dataId: string, group: string, expected: string, timeoutMs = 20000): Promise<string | null> {
  const deadline = Date.now() + timeoutMs;
  let content = await getServerConfig(dataId, group);
  while (content !== expected && Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 500));
    content = await getServerConfig(dataId, group);
  }
  return content;
}

// 直接 HTTP 读服务端，绕过客户端快照缓存，断言服务端真实状态
async function getServerConfig(dataId: string, group: string): Promise<string | null> {
  const res = await httpclient.request(
    `http://${SERVER_ADDR}/nacos/v1/cs/configs?dataId=${dataId}&group=${group}&tenant=`,
    { method: 'GET', dataType: 'text', timeout: 5000 });
  return res.status === 200 ? res.data : null;
}

async function isServerAvailable(): Promise<boolean> {
  try {
    const res = await httpclient.request(`http://${SERVER_ADDR}/nacos/v1/cs/configs?dataId=__cas_probe__&group=${GROUP}`, {
      method: 'GET',
      dataType: 'text',
      timeout: 3000,
    });
    return res.status < 500;
  } catch (err) {
    return false;
  }
}

describe('test/publish_config_cas.integration.test.ts', () => {

  let client: ClientWorker;
  let serverAvailable = false;
  const dataId = `cas-integration-${Date.now()}`;
  const contentV1 = 'cas-integration-v1';
  const contentV2 = 'cas-integration-v2';
  const contentV3 = 'cas-integration-v3';

  before(async function(this: any) {
    serverAvailable = await isServerAvailable();
    if (!serverAvailable) {
      console.warn('[publish_config_cas.integration] Nacos server unavailable at %s, skip integration tests', SERVER_ADDR);
      this.skip();
      return;
    }
    const configuration = createDefaultConfiguration({
      serverAddr: SERVER_ADDR,
      namespace: '',
      cacheDir,
    });
    const snapshot = new Snapshot({ configuration });
    const serverMgr = new ServerListManager({ configuration });
    const httpAgent = new HttpAgent({ configuration });
    configuration.merge({ snapshot, serverMgr, httpAgent });
    client = new ClientWorker({ configuration });
  });

  after(async () => {
    if (!serverAvailable || !client) return;
    await client.remove(dataId, GROUP);
  });

  it('should publish when casMd5 matches the server-side content', async () => {
    await client.publishSingle(dataId, GROUP, contentV1);
    assert(await waitForServerContent(dataId, GROUP, contentV1) === contentV1);
    const published = await client.publishConfigCas(dataId, GROUP, contentV2, md5(contentV1));
    assert(published === true);
    assert(await waitForServerContent(dataId, GROUP, contentV2) === contentV2);
  });

  it('should return false and keep the config unchanged when casMd5 is stale', async () => {
    // 服务端当前内容是 contentV2，传入 contentV1 的 md5 模拟读到旧版本后并发写入
    const published = await client.publishConfigCas(dataId, GROUP, contentV3, md5(contentV1));
    assert(published === false);
    // stale 写入被拒绝后，服务端内容必须保持 contentV2
    assert(await waitForServerContent(dataId, GROUP, contentV2) === contentV2);
  });
});
