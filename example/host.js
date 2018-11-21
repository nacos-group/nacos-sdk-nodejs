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

const net = require('net');
const NameProxy = require('../lib/naming/proxy');
const HostReactor = require('../lib/naming/host_reactor');
const logger = console;

const server = net.createServer();
server.listen(8080);

const serverProxy = new NameProxy({
  logger,
  serverList: '127.0.0.1:8848',
});
const hostReactor = new HostReactor({
  logger,
  serverProxy,
});

async function test() {
  await hostReactor.ready();

  const serviceName = 'nodejs.test.nodejs.1';
  let result = await serverProxy.registerService(serviceName, {
    ip: '30.23.176.112',
    port: 8080,
    cluster: {
      name: 'NODEJS',
      serviceName,
    },
    weight: 1.0,
    healthy: true,
  });
  console.log(result);

  const doms = await hostReactor.getServiceInfo({
    serviceName,
    cluster: [ 'NODEJS' ],
    allIPs: true,
  });
  console.log(doms);

  result = await serverProxy.deregisterService(serviceName, '30.23.176.112', 8080, 'NODEJS');
  console.log(result);
}

test();
