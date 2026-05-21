const localIp: string = require('address').ip();

export interface Payload {
  metadata: {
    type: string;
    clientIp: string;
    headers: { [key: string]: string };
  };
  body: {
    value: Buffer;
    typeUrl: string;
  };
}

export interface MessageFns<T> {
  fromJSON(object: any): T;
  toJSON(message: T): unknown;
}

function loadSdkProto(): { [key: string]: MessageFns<any> } {
  try {
    const common = require('@nacos-group/sdk-proto/src/common/common');
    const namingReq = require('@nacos-group/sdk-proto/src/naming/naming_request');
    const namingRes = require('@nacos-group/sdk-proto/src/naming/naming_response');
    const cfgReq = require('@nacos-group/sdk-proto/src/config/config_request');
    const cfgRes = require('@nacos-group/sdk-proto/src/config/config_response');
    return {
      // Common
      ConnectionSetupRequest: common.ConnectionSetupRequest,
      ServerCheckRequest: common.ServerCheckRequest,
      ServerCheckResponse: common.ServerCheckResponse,
      HealthCheckRequest: common.HealthCheckRequest,
      HealthCheckResponse: common.HealthCheckResponse,
      ConnectResetRequest: common.ConnectResetRequest,
      ConnectResetResponse: common.ConnectResetResponse,
      SetupAckRequest: common.SetupAckRequest,
      SetupAckResponse: common.SetupAckResponse,
      ClientDetectionRequest: common.ClientDetectionRequest,
      ClientDetectionResponse: common.ClientDetectionResponse,
      PushAckRequest: common.PushAckRequest,
      ErrorResponse: common.ErrorResponse,
      // Naming
      InstanceRequest: namingReq.InstanceRequest,
      InstanceResponse: namingRes.InstanceResponse,
      ServiceQueryRequest: namingReq.ServiceQueryRequest,
      QueryServiceResponse: namingRes.QueryServiceResponse,
      SubscribeServiceRequest: namingReq.SubscribeServiceRequest,
      SubscribeServiceResponse: namingRes.SubscribeServiceResponse,
      ServiceListRequest: namingReq.ServiceListRequest,
      ServiceListResponse: namingRes.ServiceListResponse,
      NotifySubscriberRequest: namingReq.NotifySubscriberRequest,
      // Config
      ConfigQueryRequest: cfgReq.ConfigQueryRequest,
      ConfigQueryResponse: cfgRes.ConfigQueryResponse,
      ConfigPublishRequest: cfgReq.ConfigPublishRequest,
      ConfigPublishResponse: cfgRes.ConfigPublishResponse,
      ConfigRemoveRequest: cfgReq.ConfigRemoveRequest,
      ConfigRemoveResponse: cfgRes.ConfigRemoveResponse,
      ConfigBatchListenRequest: cfgReq.ConfigBatchListenRequest,
      ConfigChangeBatchListenResponse: cfgRes.ConfigChangeBatchListenResponse,
      ConfigChangeNotifyRequest: cfgReq.ConfigChangeNotifyRequest,
      ConfigChangeNotifyResponse: cfgRes.ConfigChangeNotifyResponse,
    };
  } catch (e) {
    return {};
  }
}

export class PayloadCodec {
  private registry: Map<string, MessageFns<any>> = new Map();

  constructor() {
    this.registerDefaults();
  }

  private registerDefaults(): void {
    const types = loadSdkProto();
    for (const [name, fns] of Object.entries(types)) {
      if (fns) {
        this.registerType(name, fns);
      }
    }
  }

  registerType(name: string, fns: MessageFns<any>): void {
    this.registry.set(name, fns);
  }

  encode(message: any, type: string, headers?: { [key: string]: string }): Payload {
    const fns = this.registry.get(type);
    let jsonObj: any;
    if (fns) {
      jsonObj = fns.toJSON(message);
    } else {
      jsonObj = message;
    }
    const jsonStr = JSON.stringify(jsonObj);
    return {
      metadata: {
        type,
        clientIp: localIp,
        headers: headers || {},
      },
      body: {
        value: Buffer.from(jsonStr, 'utf8'),
        typeUrl: '',
      },
    };
  }

  decode(payload: Payload): { type: string; body: any } {
    const type = payload.metadata.type;
    const raw = JSON.parse(payload.body.value.toString('utf8'));
    const fns = this.registry.get(type);
    if (fns) {
      return { type, body: fns.fromJSON(raw) };
    }
    return { type, body: raw };
  }
}
