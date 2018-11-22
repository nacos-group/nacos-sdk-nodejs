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

const NacosNamingClient = require('../lib/naming/client');
const sleep = require('mz-modules/sleep');
const logger = console;

async function test() {
  const client = new NacosNamingClient({
    logger,
    serverList: '127.0.0.1:8848',
  });
  await client.ready();

  const serviceName = 'nodejs.test.nodejs.1';

  // console.log();
  // console.log('before', await client.getAllInstances(serviceName, ['NODEJS']));
  // console.log();

  client.subscribe(serviceName, hosts => {
    console.log(hosts);
  });

  await client.registerInstance(serviceName, '1.1.1.1', 8080, 'NODEJS');
  await client.registerInstance(serviceName, '2.2.2.2', 8080, 'NODEJS');

  // const hosts = await client.getAllInstances(serviceName);
  // console.log();
  // console.log(hosts);
  // console.log();

  await sleep(5000);

  await client.deregisterInstance(serviceName, '1.1.1.1', 8080, 'NODEJS');
}

test().catch(err => {
  console.log(err);
});
