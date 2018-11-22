import * as urllib from 'urllib';
import * as path from 'path';
import * as osenv from 'osenv';

export const DEFAULT_GROUP = 'DEFAULT_GROUP';

export const LINE_SEPARATOR = String.fromCharCode(1);
export const WORD_SEPARATOR = String.fromCharCode(2);

export const VERSION = 'nodejs-diamond-client/' + require('../package.json').version;
export const CURRENT_UNIT = 'CURRENT_UNIT';

export const HTTP_OK = 200;
export const HTTP_NOT_FOUND = 404;
export const HTTP_CONFLICT = 409;
export const HTTP_UNAVAILABLE = 503; // 被限流

export const DEFAULT_OPTIONS = {
  serverPort: 8848,
  requestTimeout: 5000,
  refreshInterval: 30000,
  cacheDir: path.join(osenv.home(), '.node-diamond-client-cache'),
  httpclient: urllib,
  contextPath: 'nacos',
  clusterName: 'serverlist',
  unit: CURRENT_UNIT,
  ssl: false,
  secretKey: ''
};
