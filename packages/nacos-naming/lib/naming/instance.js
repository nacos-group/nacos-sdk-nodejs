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

const Constants = require('../const');

class Instance {
  constructor(data = {}) {
    this.instanceId = data.instanceId; // Unique ID of this instance
    this.ip = data.ip; // ip address
    this.port = data.port; // port
    this.weight = data.weight || 1;
    if (typeof data.valid === 'boolean') {
      this.healthy = data.valid;
    } else if (typeof data.healthy === 'boolean') {
      this.healthy = data.healthy;
    } else {
      this.healthy = true;
    }
    this.enabled = typeof data.enabled === 'boolean' ? data.enabled : true;
    this.ephemeral = typeof data.ephemeral === 'boolean' ? data.ephemeral : true;
    this.clusterName = data.clusterName || Constants.NAMING_DEFAULT_CLUSTER_NAME; // Cluster information of instance
    this.serviceName = data.serviceName;
    this.metadata = data.metadata || {};
  }

  toString() {
    return JSON.stringify(this);
  }

  toInetAddr() {
    return this.ip + ':' + this.port;
  }

  equal(instance) {
    const str1 = this.toString();
    const str2 = instance.toString();
    return str1 === str2;
  }
}

module.exports = Instance;
