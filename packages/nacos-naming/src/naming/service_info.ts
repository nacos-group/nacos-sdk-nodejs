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

import { ServiceInfoData } from '../interface';
import { DEFAULT_DELAY } from '../const';

const EMPTY = '';
const SPLITER = '@@';

export class ServiceInfo {
  name: string;
  groupName?: string;
  clusters?: string;
  isAllIPs: boolean;
  cacheMillis: number;
  hosts: any[];
  lastRefTime: number;
  checksum: string;
  jsonFromServer: string;

  constructor(data: ServiceInfoData) {
    this.name = data.name || data.dom || '';
    this.groupName = data.groupName;
    this.clusters = data.clusters;
    this.isAllIPs = data.allIPs || false;
    this.cacheMillis = data.cacheMillis || DEFAULT_DELAY;
    this.hosts = data.hosts || [];
    this.lastRefTime = data.lastRefTime || 0;
    this.checksum = data.checksum || '';
    this.jsonFromServer = EMPTY;
  }

  get ipCount(): number {
    return this.hosts.length;
  }

  get isValid(): boolean {
    const valid = !!this.hosts;
    // if this.hosts is empty array return false
    if (valid && Array.isArray(this.hosts)) {
      return this.hosts.length > 0;
    }
    return valid;
  }

  getKey(): string {
    return ServiceInfo.getKey(this.name, this.clusters);
  }

  toString(): string {
    return this.getKey();
  }

  static getKey(name: string, clusters?: string): string {
    if (clusters) {
      return name + SPLITER + clusters;
    }
    return name;
  }

  static fromKey(key: string): ServiceInfo {
    let name: string | undefined;
    let clusters: string | undefined;
    let groupName: string | undefined;

    const segs = key.split(SPLITER);
    if (segs.length === 2) {
      groupName = segs[0];
      name = segs[1];
    } else if (segs.length === 3) {
      groupName = segs[0];
      name = segs[1];
      clusters = segs[2];
    }
    return new ServiceInfo({
      name,
      clusters,
      groupName,
    });
  }
}
