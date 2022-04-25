/*
 * Author: ugrg
 * Create Time: 2021/8/20 9:12
 */
interface Instance {
  ip: string,                                         //IP of instance
  port: number,                                       //Port of instance
  weight?: number,
  ephemeral?: boolean,
  clusterName?: string
}

type Hosts = string[];

interface SubscribeInfo {
  serviceName: string,
  groupName?: string,
  clusters?: string
}

/**
 * Nacos服务发现组件
 */
export class NacosNamingClient {
  constructor (config: { logger: typeof console, serverList: string | string[], namespace?: string })

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