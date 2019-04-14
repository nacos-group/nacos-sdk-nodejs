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

const uuid = require('uuid/v4');
const Base = require('sdk-base');
const assert = require('assert');
const utility = require('utility');
const Constants = require('../const');

const defaultOptions = {
    namespace: 'default',
    httpclient: require('urllib'),
    ssl: false,
};
const DEFAULT_SERVER_PORT = 8848;

class NameProxy extends Base {
    constructor(options = {}) {
        assert(options.logger, '[NameProxy] options.logger is required');
        if (typeof options.serverList === 'string' && options.serverList) {
            options.serverList = options.serverList.split(',');
        }
        super(Object.assign({}, defaultOptions, options));
        // 硬负载域名
        if (options.serverList.length === 1) {
            this.nacosDomain = options.serverList[0];
        }
        this.serverList = options.serverList || [];
        this.ready(true);
    }

    get logger() {
        return this.options.logger;
    }

    get namespace() {
        return this.options.namespace;
    }

    get httpclient() {
        return this.options.httpclient;
    }

    async _callServer(serverAddr, method, api, params) {
        const headers = {
            'Client-Version': Constants.VERSION,
            'Accept-Encoding': 'gzip,deflate,sdch',
            Connection: 'Keep-Alive',
            RequestId: uuid(),
            'User-Agent': 'Nacos-Java-Client',
        };

        if (!serverAddr.includes(Constants.SERVER_ADDR_IP_SPLITER)) {
            serverAddr = serverAddr + Constants.SERVER_ADDR_IP_SPLITER + DEFAULT_SERVER_PORT;
        }

        const url = (this.options.ssl ? 'https://' : 'http://') + serverAddr + api;
        const result = await this.httpclient.request(url, {
            method,
            headers,
            data: params,
            dataType: 'text',
            dataAsQueryString: true,
        });

        if (result.status === 200) {
            return result.data;
        }
        if (result.status === 304) {
            return '';
        }
        const err = new Error('failed to req API: ' + url + '. code: ' + result.status + ' msg: ' + result.data);
        err.name = 'NacosException';
        throw err;
    }

    async reqAPI(api, params, method) {
        // TODO:
        const servers = this.serverList;
        const size = servers.length;

        if (size === 0 && !this.nacosDomain) {
            throw new Error('[NameProxy] no server available');
        }

        if (size > 0) {
            let index = utility.random(size);
            for (let i = 0; i < size; i++) {
                const server = servers[index];
                try {
                    return await this._callServer(server, method, api, params);
                } catch (err) {
                    this.logger.warn(err);
                }
                index = (index + 1) % size;
            }
            throw new Error('failed to req API: ' + api + ' after all servers(' + servers.join(',') + ') tried');
        }

        for (let i = 0; i < Constants.REQUEST_DOMAIN_RETRY_COUNT; i++) {
            try {
                return await this._callServer(this.nacosDomain, method, api, params);
            } catch (err) {
                this.logger.warn(err);
            }
        }
        throw new Error('failed to req API: ' + api + ' after all servers(' + this.nacosDomain + ') tried');
    }

    async registerService(serviceName, instance) {
        this.logger.info('[NameProxy][REGISTER-SERVICE] registering service: %s with instance:%j', serviceName, instance);

        const params = {
            namespaceId: this.namespace,
            ip: instance.ip,
            port: instance.port + '',
            weight: instance.weight + '',
            enable: instance.enabled ? 'true' : 'false',
            healthy: instance.healthy ? 'true' : 'false',
            metadata: JSON.stringify(instance.metadata),
            clusterName: instance.clusterName,
            serviceName,
        };
        return await this.reqAPI(Constants.NACOS_URL_INSTANCE, params, 'PUT');
    }

    async deregisterService(serviceName, ip, port, cluster) {
        const params = {
            namespaceId: this.namespace,
            ip,
            port: port + '',
            serviceName,
            cluster,
        };
        return await this.reqAPI(Constants.NACOS_URL_INSTANCE, params, 'DELETE');
    }

    async serverHealthy() {
        try {
            await this.reqAPI(Constants.NACOS_URL_BASE + '/api/hello', {}, 'GET');
        } catch (_) {
            return false;
        }
        return true;
    }
}

module.exports = NameProxy;