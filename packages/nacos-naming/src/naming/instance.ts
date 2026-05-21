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

import { InstanceOptions } from '../interface';
import { NAMING_DEFAULT_CLUSTER_NAME } from '../const';

export class Instance {
  instanceId?: string;
  ip: string;
  port: number;
  weight: number;
  healthy: boolean;
  enabled: boolean;
  ephemeral: boolean;
  clusterName: string;
  serviceName?: string;
  metadata: Record<string, string>;

  constructor(data: InstanceOptions = {} as InstanceOptions) {
    this.instanceId = data.instanceId;
    this.ip = data.ip;
    this.port = data.port;
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
    this.clusterName = data.clusterName || NAMING_DEFAULT_CLUSTER_NAME;
    this.serviceName = data.serviceName;
    this.metadata = data.metadata || {};
  }

  toString(): string {
    return JSON.stringify(this);
  }

  toInetAddr(): string {
    return this.ip + ':' + this.port;
  }

  equal(instance: Instance): boolean {
    const str1 = this.toString();
    const str2 = instance.toString();
    return str1 === str2;
  }
}
