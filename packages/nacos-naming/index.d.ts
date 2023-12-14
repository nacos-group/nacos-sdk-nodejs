/*
 * Author: ugrg
 * Create Time: 2021/8/20 9:12
 */
interface Instance {
  instanceId: string,
  ip: string,                                         //IP of instance
  port: number,                                       //Port of instance
  healthy: boolean,
  enabled: boolean,
  serviceName?: string,
  weight?: number,
  ephemeral?: boolean,
  clusterName?: string
}

export interface Host {
  instanceId: string;
  ip: string;
  port: number;
  weight: number;
  healthy: boolean;
  enabled: boolean;
  ephemeral: boolean;
  clusterName: string;
  serviceName: string;
  metadata: any;
  instanceHeartBeatInterval: number;
  instanceIdGenerator: string;
  instanceHeartBeatTimeOut: number;
  ipDeleteTimeout: number;
}

type Hosts = Host[];

interface SubscribeInfo {
  serviceName: string,
  groupName?: string,
  clusters?: string
}

interface NacosNamingClientConfig {
  logger: typeof console,
  serverList: string | string[],
  namespace?: string,
  username?: string,
  password?: string,
  endpoint?: string,
  vipSrvRefInterMillis?: number,
  ssl?: boolean
}

/**
 * Nacos服务发现组件
 */
export class NacosNamingClient {
  constructor (config: NacosNamingClientConfig);

  ready: () => Promise<void>;
  // Register an instance to service
  registerInstance: (
    serviceName: string,                              //Service name
    instance: Instance,                               //Instance
    groupName?: string                                 // group name, default is DEFAULT_GROUP
  ) => Promise<void>;
  // Delete instance from service.
  deregisterInstance: (
    serviceName: string,                              //Service name
    instance: Instance,                               //Instance
    groupName?: string                                // group name, default is DEFAULT_GROUP
  ) => Promise<void>;
  // Query instance list of service.
  getAllInstances: (
    serviceName: string,                              //Service name
    groupName?: string,                               //group name, default is DEFAULT_GROUP
    clusters?: string,                                //Cluster names
    subscribe?: boolean                               //whether subscribe the service, default is true
  ) => Promise<Hosts>;
  // Select instance list of service.
  selectInstances: (
    serviceName: string, 
    groupName?: string,
    clusters?: string,
    healthy?: boolean,
    subscribe?: boolean
  ) => Promise<Hosts>;
  //  Get the status of nacos server, 'UP' or 'DOWN'.
  getServerStatus: () => 'UP' | 'DOWN';
  subscribe: (
    info: SubscribeInfo | string,                     //service info, if type is string, it's the serviceName
    listener: (host: Hosts) => void                   //the listener function
  ) => void;
  unSubscribe: (
    info: SubscribeInfo | string,                     //service info, if type is string, it's the serviceName
    listener: (host: Hosts) => void                   //the listener function
  ) => void;
}
