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

import * as assert from 'assert';
import * as mm from 'mm';
import { NacosNamingClient } from '../../src/naming/client';
import { Host } from '../../src/interface';
import { chooseHostByWeight } from '../../src/utils';

const logger = console;

function host(ip: string, weight: number, healthy: boolean = true, enabled: boolean = true): Host {
  return { ip, port: 8080, weight, healthy, enabled };
}

describe('test/naming/select_one_healthy_instance.test.ts', () => {
  afterEach(mm.restore);

  describe('chooseHostByWeight', () => {
    it('should return null for an empty list', () => {
      assert.strictEqual(chooseHostByWeight([]), null);
    });

    it('should return the only host for a single-element list', () => {
      const onlyHost = host('1.1.1.1', 1);
      assert.strictEqual(chooseHostByWeight([ onlyHost ]), onlyHost);
    });

    it('should distribute selections proportionally to weights', () => {
      const hosts = [ host('1.1.1.1', 1), host('2.2.2.2', 3) ];
      const counts: Record<string, number> = {};
      for (let i = 0; i < 4000; i++) {
        const picked = chooseHostByWeight(hosts) as Host;
        counts[picked.ip] = (counts[picked.ip] || 0) + 1;
      }
      // Expected ratio is 1:3; keep a loose bound to avoid flakes.
      const ratio = counts['2.2.2.2'] / counts['1.1.1.1'];
      assert(ratio > 2.2 && ratio < 4.0, `unexpected ratio: ${ratio}`);
    });
  });

  describe('NacosNamingClient#selectOneHealthyInstance', () => {
    it('should pick one healthy, enabled host with positive weight', async () => {
      const client = new NacosNamingClient({
        logger,
        serverList: '127.0.0.1:8848',
        transport: 'http',
      });
      client.on('error', () => { /* ignore background errors in unit test */ });
      mm(client as any, '_hostReactor', {
        getServiceInfo: async () => ({
          hosts: [
            host('1.1.1.1', 1),
            host('2.2.2.2', 0),
            host('3.3.3.3', 1, false),
            host('4.4.4.4', 1, true, false),
          ],
        }),
      });
      const selected = await client.selectOneHealthyInstance('test-service');
      assert(selected);
      assert.strictEqual((selected as Host).ip, '1.1.1.1');
    });

    it('should return null when there is no healthy host', async () => {
      const client = new NacosNamingClient({
        logger,
        serverList: '127.0.0.1:8848',
        transport: 'http',
      });
      client.on('error', () => { /* ignore background errors in unit test */ });
      mm(client as any, '_hostReactor', {
        getServiceInfo: async () => ({ hosts: [] }),
      });
      const selected = await client.selectOneHealthyInstance('test-service');
      assert.strictEqual(selected, null);
    });
  });
});
