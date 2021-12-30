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
const util = require('../util');
const Base = require('sdk-base');
const assert = require('assert');

class PushReceiver extends Base {
  constructor(hostReactor) {
    assert(hostReactor, '[PushReceiver] hostReactor is required');
    super({});

    this._udpPort = 0;
    this._inited = false;
    this._isClosed = false;
    this._hostReactor = hostReactor;
    this._createServer();
  }

  get logger() {
    return this._hostReactor.logger;
  }

  get udpPort() {
    return this._udpPort;
  }

  _createServer() {
    this._server = dgram.createSocket({
      type: 'udp4',
    });
    this._server.once('error', err => {
      this._server.close();
      err.name = 'PushReceiverError';
      this.emit('error', err);
    });
    this._server.once('close', () => {
      if (!this._isClosed) {
        this._createServer();
      }
    });
    this._server.once('listening', () => {
      const address = this._server.address();
      this._udpPort = address.port;
      if (!this._inited) {
        this.ready(true);
      }
      this.logger.info('[PushReceiver] udp server listen on %s:%s', address.address, address.port);
    });
    this._server.on('message', (msg, rinfo) => this._handlePushMessage(msg, rinfo));
    // 随机绑定一个端口
    this._server.bind({port: 0, exclusive: true}, null);
  }

  _handlePushMessage(msg, rinfo) {
    try {
      const jsonStr = util.tryDecompress(msg).toString();
      const pushPacket = JSON.parse(jsonStr);
      this.logger.info('[PushReceiver] received push data: %s from %s:%s', jsonStr, rinfo.address, rinfo.port);
      let ack;
      if (pushPacket.type === 'dom') {
        this._hostReactor.processServiceJSON(pushPacket.data);
        ack = JSON.stringify({
          type: 'push-ack',
          lastRefTime: pushPacket.lastRefTime,
          data: '',
        });
      } else if (pushPacket.type === 'dump') {
        ack = JSON.stringify({
          type: 'dump-ack',
          lastRefTime: pushPacket.lastRefTime,
          data: JSON.stringify(this._hostReactor.getServiceInfoMap()),
        });
      } else {
        ack = JSON.stringify({
          type: 'unknown-ack',
          lastRefTime: pushPacket.lastRefTime,
          data: '',
        });
      }
      this._server.send(ack, rinfo.port, rinfo.address);
    } catch (err) {
      err.name = 'PushReceiverError';
      err.message += ' error while receiving push data';
      this.emit('error', err);
    }
  }

  close() {
    return new Promise((resolve) => {
      this._isClosed = true;
      if (this._server) {
        this._server.close(resolve)
        this._server = null;
      }
    });
  }
}

module.exports = PushReceiver;
