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
