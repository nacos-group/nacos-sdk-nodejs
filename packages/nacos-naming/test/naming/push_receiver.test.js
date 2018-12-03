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

const dgram = require('dgram');
const assert = require('assert');
const sleep = require('mz-modules/sleep');
const awaitEvent = require('await-event');
const PushReceiver = require('../../lib/naming/push_receiver');

const logger = console;

describe('test/naming/push_receiver.test.js', () => {
  it('should push message ok', async function() {
    const pushReceiver = new PushReceiver({
      logger,
      processServiceJSON(json) {
        const data = JSON.parse(json);
        assert.deepEqual(data, {
          cacheMillis: 20000,
          checksum: 'd10785d4cc80a8319578b92c4164902b1486619344219',
          clusters: '',
          dom: 'xxx',
          env: '',
          hosts: [{
            appUseType: '',
            doubleWeight: 1,
            hostname: 'xxx',
            ip: '1.1.1.1',
            marked: false,
            port: 80,
            site: 'xxx',
            unit: 'CENTER',
            valid: true,
            weight: 1,
          }],
          lastRefTime: 1486619344219,
          useSpecifiedURL: true,
        });
      },
      getServiceInfoMap() {
        return { foo: 'bar' };
      },
    });
    await pushReceiver.ready();
    assert(pushReceiver.udpPort);

    const client = dgram.createSocket('udp4');

    const domMsg = '{"data":"{\\"cacheMillis\\":20000,\\"checksum\\":\\"d10785d4cc80a8319578b92c4164902b1486619344219\\",\\"clusters\\":\\"\\",\\"dom\\":\\"xxx\\",\\"env\\":\\"\\",\\"hosts\\":[{\\"appUseType\\":\\"\\",\\"doubleWeight\\":1,\\"hostname\\":\\"xxx\\",\\"ip\\":\\"1.1.1.1\\",\\"marked\\":false,\\"port\\":80,\\"site\\":\\"xxx\\",\\"unit\\":\\"CENTER\\",\\"valid\\":true,\\"weight\\":1}],\\"lastRefTime\\":1486619344219,\\"useSpecifiedURL\\":true}","lastRefTime":26084107962357333,"type":"dom"}';
    client.send(domMsg, pushReceiver.udpPort, 'localhost');

    let msg = await awaitEvent(client, 'message');
    assert(msg.toString() === '{"type":"push-ack","lastRefTime":26084107962357332,"data":""}');

    const dumpMsg = '{"data":"","lastRefTime":26084107962357334,"type":"dump"}';
    client.send(dumpMsg, pushReceiver.udpPort, 'localhost');
    msg = await awaitEvent(client, 'message');
    assert(msg.toString() === '{"type":"dump-ack","lastRefTime":26084107962357336,"data":"{\\"foo\\":\\"bar\\"}"}');

    const unknowMsg = '{"data":"","lastRefTime":26084107962357335,"type":"unknow"}';
    client.send(unknowMsg, pushReceiver.udpPort, 'localhost');
    msg = await awaitEvent(client, 'message');
    assert(msg.toString() === '{"type":"unknown-ack","lastRefTime":26084107962357336,"data":""}');

    const errorMsg = '{';
    client.send(errorMsg, pushReceiver.udpPort, 'localhost');

    try {
      await pushReceiver.await('error');
    } catch (err) {
      console.log(err);
    }

    await pushReceiver.close();
  });

  it('should auto recover from exception', async function() {
    const pushReceiver = new PushReceiver({
      logger,
      processServiceJSON() {},
      getServiceInfoMap() { return null; },
    });
    await pushReceiver.ready();
    const udpPort1 = pushReceiver.udpPort;
    assert(udpPort1);

    pushReceiver._server.emit('error', new Error('mock error'));

    await sleep(100);

    const udpPort2 = pushReceiver.udpPort;
    assert(udpPort2);
    assert(udpPort1 !== udpPort2);

    await pushReceiver.close();
  });
});
