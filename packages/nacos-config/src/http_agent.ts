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
import { HTTP_CONFLICT, HTTP_NOT_FOUND, HTTP_OK, VERSION } from './const';
import { ClientOptionKeys, IConfiguration, IServerListManager } from './interface';
import * as urllib from 'urllib';
import * as crypto from 'crypto';
import { encodingParams, transformGBKToUTF8 } from './utils';
import * as dns from 'dns';

export class HttpAgent {

  options;
  protected loggerDomain = 'Nacos';
  private debugPrefix = this.loggerDomain.toLowerCase();
  private debug = require('debug')(`${this.debugPrefix}:${process.pid}:http_agent`);

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

  get defaultEncoding() {
    return this.configuration.get(ClientOptionKeys.DEFAULT_ENCODING) || 'utf8';
  }

  get identityKey() {
    return this.configuration.get(ClientOptionKeys.IDENTITY_KEY);
  }

  get identityValue() {
    return this.configuration.get(ClientOptionKeys.IDENTITY_VALUE);
  }

  get endpointQueryParams() {
    return this.configuration.get(ClientOptionKeys.ENDPOINT_QUERY_PARAMS)
  }

  get decodeRes() {
    return this.configuration.get(ClientOptionKeys.DECODE_RES);
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
    dataAsQueryString?: boolean;
  } = {}) {
    // 默认为当前单元
    const unit = options.unit || this.unit;
    const ts = String(Date.now());
    const { encode = false, method = 'GET', data, timeout = this.requestTimeout, headers = {}, dataAsQueryString = false } = options;

    const endTime = Date.now() + timeout;
    let lastErr;

    if (this.options?.configuration?.innerConfig?.username &&
        this.options?.configuration?.innerConfig?.password) {
      data.username = this.options.configuration.innerConfig.username;
      data.password = this.options.configuration.innerConfig.password;
    }
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
      ...this.identityKey ? {[this.identityKey]: this.identityValue} : {}
    });

    let requestData = data;
    if (encode) {
      requestData = encodingParams(data, this.defaultEncoding);
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
          dataAsQueryString,
        });
        this.debug('%s %s, got %s, body: %j', method, url, res.status, res.data);
        switch (res.status) {
          case HTTP_OK:
            if (this.decodeRes) {
              return this.decodeRes(res, method, this.defaultEncoding)
            }
            return this.decodeResData(res, method);
          case HTTP_NOT_FOUND:
            return null;
          case HTTP_CONFLICT:
            await this.serverListMgr.updateCurrentServer(unit);
            // JAVA 在外面业务类处理的这个逻辑，应该是需要重试的
            lastErr = new Error(`[Client Worker] ${this.loggerDomain} server config being modified concurrently, data: ${JSON.stringify(data)}`);
            lastErr.name = `${this.loggerDomain}ServerConflictError`;
            break;
          default:
            await this.serverListMgr.updateCurrentServer(unit);
            // JAVA 还有一个针对 HTTP_FORBIDDEN 的处理，不过合并到 default 应该也没问题
            lastErr = new Error(`${this.loggerDomain} Server Error Status: ${res.status}, url: ${url}, data: ${JSON.stringify(data)}`);
            lastErr.name = `${this.loggerDomain}ServerResponseError`;
            lastErr.body = res.data;
            break;
        }
      } catch (err) {
        if (err.code === dns.NOTFOUND) {
          throw err;
        }
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
        url = `https://${currentServer}`;
      }
    } else {
      url = `http://${currentServer}:${this.serverPort}`;
      if (this.ssl) {
        url = `https://${currentServer}:${this.serverPort}`;
      }
    }
    return `${url}/${this.contextPath}`;
  }

  decodeResData(res, method = 'GET') {
    if (method === 'GET' && /charset=GBK/.test(res.headers[ 'content-type' ]) && this.defaultEncoding === 'utf8') {
      try {
        return transformGBKToUTF8(res.data);
      } catch (err) {
        console.error(`transform gbk data to utf8 error, msg=${err.messager}`);
        return res.data;
      }
    } else {
      return res.data;
    }
  }

}
