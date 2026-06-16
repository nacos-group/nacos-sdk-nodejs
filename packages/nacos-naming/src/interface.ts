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

/** Constructor input for Instance. instanceId, healthy, enabled are optional (fixes #118). */
export interface InstanceOptions {
  instanceId?: string;
  ip: string;
  port: number;
  weight?: number;
  /** @deprecated use healthy instead */
  valid?: boolean;
  healthy?: boolean;
  enabled?: boolean;
  ephemeral?: boolean;
  clusterName?: string;
  serviceName?: string;
  metadata?: Record<string, string>;
}

/** Server-returned host info */
export interface Host {
  instanceId?: string;
  ip: string;
  port: number;
  weight: number;
  healthy: boolean;
  enabled: boolean;
  ephemeral?: boolean;
  clusterName?: string;
  serviceName?: string;
  metadata?: Record<string, string>;
}

export type Hosts = Host[];

/** Subscribe parameters */
export interface SubscribeInfo {
  serviceName: string;
  groupName?: string;
  clusters?: string;
}

/**
 * Options for NacosNamingClient constructor.
 * Fixes #109: added JSDoc comments for all options.
 */
export interface NacosNamingClientOptions {
  /** Logger instance (required) */
  logger: any;
  /** Nacos server address list, e.g. ['127.0.0.1:8848'] or ['http://127.0.0.1:8848'] */
  serverList?: string | string[];
  /** Nacos namespace (default: 'public') */
  namespace?: string;
  /** Nacos endpoint for server list discovery */
  endpoint?: string;
  /** HTTP client (default: urllib) */
  httpclient?: any;
  /** Whether to use SSL (default: false) */
  ssl?: boolean;
  /** Access key for authentication */
  ak?: string;
  /** Secret key for authentication */
  sk?: string;
  /** Application name */
  appName?: string;
  /** Alibaba Cloud STS security token */
  securityToken?: string;
  /** Alibaba Cloud extended auth AccessKeyId */
  alibabaCloudAccessKeyId?: string;
  /** Alibaba Cloud extended auth AccessKeySecret */
  alibabaCloudAccessKeySecret?: string;
  /** Alibaba Cloud extended auth SecurityToken */
  alibabaCloudSecurityToken?: string;
  /** Alibaba Cloud extended auth Credentials URI */
  alibabaCloudCredentialsUri?: string;
  /** STS temporary credentials JSON */
  securityCredentials?: string | object;
  /** STS temporary credentials fetch URL */
  securityCredentialsUrl?: string;
  /** ECS RAM role name */
  ramRoleName?: string;
  /** Whether to cache STS temporary credentials */
  cacheSecurityCredentials?: boolean;
  /** Refresh-ahead time (ms) for STS temporary credentials */
  timeToRefreshInMillisecond?: number;
  /** Custom Alibaba Cloud credential provider */
  aliyunCredentialsProvider?: any;
  /** Custom Alibaba Cloud extended credential provider */
  alibabaCloudCredentialsProvider?: any;
  /** Alibaba Cloud v4 signature region ID */
  signatureRegionId?: string;
  /** Interval in ms to refresh server list from endpoint (default: 30000) */
  vipSrvRefInterMillis?: number;
  /** Username for authentication */
  username?: string;
  /** Password for authentication */
  password?: string;
  /** Transport protocol to use: 'grpc' (default) or 'http' */
  transport?: 'grpc' | 'http';
}

/** Heartbeat data */
export interface BeatInfo {
  serviceName: string;
  ip: string;
  port: number;
  cluster: string;
  weight: number;
  metadata: Record<string, string>;
  scheduled: boolean;
}

/** Result of getServiceList */
export interface ServiceListResult {
  count: number;
  data: string[];
}

/** Constructor input for ServiceInfo */
export interface ServiceInfoData {
  name?: string;
  dom?: string;
  groupName?: string;
  clusters?: string;
  allIPs?: boolean;
  cacheMillis?: number;
  hosts?: any[];
  lastRefTime?: number;
  checksum?: string;
}

/** Transport interface for future gRPC support */
export interface NamingTransport {
  registerService(serviceName: string, groupName: string, instance: any): Promise<string>;
  deregisterService(serviceName: string, instance: any): Promise<string>;
  queryList(serviceName: string, clusters: string, udpPort: number, healthyOnly: boolean): Promise<string>;
  sendBeat(beatInfo: BeatInfo): Promise<number>;
  serverHealthy(): Promise<boolean>;
  getServiceList(pageNo: number, pageSize: number, groupName?: string): Promise<ServiceListResult>;
  close(): Promise<void>;
  ready(): Promise<void>;
}
