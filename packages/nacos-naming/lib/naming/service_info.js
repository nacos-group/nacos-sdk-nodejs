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

const EMPTY = '';
const SPLITER = '@@';
const ALL_IPS = '000--00-ALL_IPS--00--000';

class ServiceInfo {
  constructor(data) {
    this.name = data.name || data.dom;
    this.clusters = data.clusters;
    this.isAllIPs = data.allIPs || false;
    this.cacheMillis = data.cacheMillis || 1000;
    this.hosts = data.hosts;
    this.lastRefTime = data.lastRefTime || 0;
    this.checksum = data.checksum || '';
    this.env = data.env || '';
    this.jsonFromServer = EMPTY;
  }

  get ipCount() {
    return this.hosts.length;
  }

  get isValid() {
    return !!this.hosts;
  }

  getKey() {
    const name = this.name;
    const clusters = this.clusters;
    const unit = this.env;
    const isAllIPs = this.isAllIPs;
    return ServiceInfo.getKey(name, clusters, unit, isAllIPs);
  }

  toString() {
    return this.getKey();
  }

  static getKey(name, clusters, unit, isAllIPs) {
    if (!unit) {
      unit = EMPTY;
    }
    if (clusters && unit) {
      return isAllIPs ? name + SPLITER + clusters + SPLITER + unit + SPLITER + ALL_IPS :
        name + SPLITER + clusters + SPLITER + unit;
    }
    if (clusters) {
      return isAllIPs ? name + SPLITER + clusters + SPLITER + ALL_IPS : name + SPLITER + clusters;
    }
    if (unit) {
      return isAllIPs ? name + SPLITER + EMPTY + SPLITER + unit + SPLITER + ALL_IPS :
        name + SPLITER + EMPTY + SPLITER + unit;
    }
    return isAllIPs ? name + SPLITER + ALL_IPS : name;
  }

  static parse(key) {
    const maxKeySectionCount = 4;
    const allIpFlagIndex = 3;
    const envIndex = 2;
    const clusterIndex = 1;
    const serviceNameIndex = 0;

    let name;
    let clusters;
    let env;
    let allIPs = false;

    const keys = key.split(SPLITER);
    if (keys.length >= maxKeySectionCount) {
      name = keys[serviceNameIndex];
      clusters = keys[clusterIndex];
      env = keys[envIndex];
      if (keys[allIpFlagIndex] === ALL_IPS) {
        allIPs = true;
      }
    } else if (keys.length >= allIpFlagIndex) {
      name = keys[serviceNameIndex];
      clusters = keys[clusterIndex];
      if (keys[envIndex] === ALL_IPS) {
        allIPs = true;
      } else {
        env = keys[envIndex];
      }
    } else if (keys.length >= envIndex) {
      name = keys[serviceNameIndex];
      if (keys[clusterIndex] === ALL_IPS) {
        allIPs = true;
      } else {
        clusters = keys[clusterIndex];
      }
    }

    return new ServiceInfo({
      name,
      clusters,
      env,
      allIPs,
    });
  }
}

module.exports = ServiceInfo;
