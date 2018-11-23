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
import { ClientOptionKeys, IConfiguration } from './interface';

export class Configuration implements IConfiguration {

  private innerConfig;

  constructor(initConfig) {
    this.innerConfig = initConfig || {};
  }

  merge(config) {
    this.innerConfig = Object.assign(this.innerConfig, config);
    return this;
  }

  attach(config): Configuration {
    return new Configuration(Object.assign({}, this.innerConfig, config));
  }

  get(configKey?: ClientOptionKeys) {
    return configKey ? this.innerConfig[configKey] : this.innerConfig;
  }

  has(configKey: ClientOptionKeys) {
    return !!this.innerConfig[configKey];
  }

  set(configKey: ClientOptionKeys, target: any) {
    this.innerConfig[configKey] = target;
    return this;
  }

  modify(configKey: ClientOptionKeys, changeHandler: (target: any) => any) {
    this.innerConfig[configKey] = changeHandler.call(this, this.innerConfig[configKey]);
    return this;
  }

}
