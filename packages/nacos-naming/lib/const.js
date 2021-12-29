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

exports.VERSION = 'Nacos-Java-Client:v1.0.0';

exports.ENCODING = 'UTF-8';

exports.ENV_LIST_KEY = 'envList';

exports.ALL_IPS = '000--00-ALL_IPS--00--000';

exports.FAILOVER_SWITCH = '00-00---000-VIPSRV_FAILOVER_SWITCH-000---00-00';

exports.NACOS_URL_BASE = '/nacos/v1/ns';

exports.NACOS_URL_INSTANCE = exports.NACOS_URL_BASE + '/instance';

exports.DEFAULT_NAMESPACE_ID = 'default';

exports.REQUEST_DOMAIN_RETRY_COUNT = 3;

exports.DEFAULT_NAMING_ID = 'default';

exports.NACOS_NAMING_LOG_NAME = 'com.alibaba.nacos.naming.log.filename';

exports.NACOS_NAMING_LOG_LEVEL = 'com.alibaba.nacos.naming.log.level';

exports.SERVER_ADDR_IP_SPLITER = ':';

exports.NAMING_INSTANCE_ID_SPLITTER = '#';

exports.NAMING_DEFAULT_CLUSTER_NAME = 'DEFAULT';

exports.SERVICE_INFO_SPLITER = '@@';

exports.DEFAULT_GROUP = 'DEFAULT_GROUP';

exports.DEFAULT_DELAY = 5000;
