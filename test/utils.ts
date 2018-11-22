import { Configuration } from '../src/configuration';
import { DEFAULT_OPTIONS } from '../src/const';

export function delay(timeout) {
  return new Promise(resolve => {
    setTimeout(() => {
      resolve();
    }, timeout);
  });
}

export function createDefaultConfiguration(config: any) {
  return new Configuration(DEFAULT_OPTIONS).merge(config);
}
