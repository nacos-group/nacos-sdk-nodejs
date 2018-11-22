import { HTTP_CONFLICT, HTTP_NOT_FOUND, HTTP_OK, VERSION } from './const';
import { ClientOptionKeys, IConfiguration, IServerListManager } from './interface';
import * as urllib from 'urllib';
import * as crypto from 'crypto';
import { encodingParams } from './utils';

export class HttpAgent {

  options;
  currentServer: string;
  protected loggerDomain = 'Nacos';
  private debug = require('debug')(`${this.loggerDomain}:${process.pid}:http_agent`);

  constructor(options) {
    this.options = options;
  }

  get configuration(): IConfiguration {
    return this.options.configuration;
  }

  get serverListMgr(): IServerListManager {
    return this.configuration.get(ClientOptionKeys.SERVER_MGR);
  }

  /**
   * HTTP 请求客户端
   * @property {Urllib} DiamondClient#urllib
   */
  get httpclient() {
    return this.configuration.get(ClientOptionKeys.HTTPCLIENT) || urllib;
  }

  get unit() {
    return this.configuration.get(ClientOptionKeys.UNIT);
  }

  get secretKey() {
    return this.configuration.get(ClientOptionKeys.SECRETKEY);
  }

  get requestTimeout() {
    return this.configuration.get(ClientOptionKeys.REQUEST_TIMEOUT);
  }

  get accessKey() {
    return this.configuration.get(ClientOptionKeys.ACCESSKEY);
  }

  get ssl() {
    return this.configuration.get(ClientOptionKeys.SSL);
  }

  get serverPort() {
    return this.configuration.get(ClientOptionKeys.SERVER_PORT);
  }

  get contextPath() {
    return this.configuration.get(ClientOptionKeys.CONTEXTPATH) || 'nacos';
  }

  get clusterName() {
    return this.configuration.get(ClientOptionKeys.CLUSTER_NAME) || 'serverlist';
  }


  /**
   * 请求
   * @param {String} path - 请求 path
   * @param {Object} [options] - 参数
   * @return {String} value
   */
  async request(path, options: {
    encode?: boolean;
    method?: string;
    data?: any;
    timeout?: number;
    headers?: any;
    unit?: string;
  } = {}) {
    // 默认为当前单元
    const unit = options.unit || this.unit;
    const ts = String(Date.now());
    const { encode = false, method = 'GET', data, timeout = this.requestTimeout, headers = {} } = options;

    const endTime = Date.now() + timeout;
    let lastErr;

    let signStr = data.tenant;
    if (data.group && data.tenant) {
      signStr = data.tenant + '+' + data.group;
    } else if (data.group) {
      signStr = data.group;
    }

    const signature = crypto.createHmac('sha1', this.secretKey)
      .update(signStr + '+' + ts).digest()
      .toString('base64');

    // 携带统一的头部信息
    Object.assign(headers, {
      'Client-Version': VERSION,
      'Content-Type': 'application/x-www-form-urlencoded; charset=GBK',
      'Spas-AccessKey': this.accessKey,
      timeStamp: ts,
      exConfigInfo: 'true',
      'Spas-Signature': signature,
    });

    let requestData = data;
    if (encode) {
      requestData = encodingParams(data);
    }

    do {
      const currentServer = await this.serverListMgr.getCurrentServerAddr(unit);
      let url = this.getRequestUrl(currentServer) + `${path}`;
      this.debug('request unit: [%s] with url: %s', unit, url);

      try {
        const res = await this.httpclient.request(url, {
          rejectUnauthorized: false,
          httpsAgent: false,
          method,
          data: requestData,
          dataType: 'text',
          headers,
          timeout,
          secureProtocol: 'TLSv1_2_method',
        });
        this.debug('%s %s, got %s, body: %j', method, url, res.status, res.data);
        switch (res.status) {
          case HTTP_OK:
            return res.data;
          case HTTP_NOT_FOUND:
            return null;
          case HTTP_CONFLICT:
            await this.serverListMgr.updateCurrentServer(unit);
            // JAVA 在外面业务类处理的这个逻辑，应该是需要重试的
            lastErr = new Error(`[DiamondEnv] Diamond server config being modified concurrently, data: ${JSON.stringify(data)}`);
            lastErr.name = 'DiamondServerConflictError';
            break;
          default:
            await this.serverListMgr.updateCurrentServer(unit);
            // JAVA 还有一个针对 HTTP_FORBIDDEN 的处理，不过合并到 default 应该也没问题
            lastErr = new Error(`Diamond Server Error Status: ${res.status}, url: ${url}, data: ${JSON.stringify(data)}`);
            lastErr.name = 'DiamondServerResponseError';
            lastErr.body = res.data;
            break;
        }
      } catch (err) {
        err.url = `${method} ${url}`;
        err.data = data;
        err.headers = headers;
        lastErr = err;
      }

    } while (Date.now() < endTime);

    throw lastErr;
  }

  // 获取请求 url
  getRequestUrl(currentServer) {
    let url;
    if (/:/.test(currentServer)) {
      url = `http://${currentServer}`;
      if (this.ssl) {
        url = `https://${this.currentServer}`;
      }
    } else {
      url = `http://${currentServer}:${this.serverPort}`;
      if (this.ssl) {
        url = `https://${this.currentServer}:${this.serverPort}`;
      }
    }
    return `${url}/${this.contextPath}`;
  }

}
