<!--
  Copyright 1999-2026 Alibaba Group Holding Ltd.

  Licensed under the Apache License, Version 2.0 (the "License");
  you may not use this file except in compliance with the License.
  You may obtain a copy of the License at

       http://www.apache.org/licenses/LICENSE-2.0

  Unless required by applicable law or agreed to in writing, software
  distributed under the License is distributed on an "AS IS" BASIS,
  WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
  See the License for the specific language governing permissions and
  limitations under the License.
-->

# Node.js SDK Coverage Registry

This registry maps every public API to the scenarios that cover it. The
[Scenario Matrix](./SCENARIOS.md) holds the status of each scenario. A public API is complete
only when all of its scenarios are `Covered` or `Documented gap`.

Update this file in the same PR as any change to the public surface.

## Config Client

| API | Scenarios |
| --- | --- |
| `new NacosConfigClient()` | LC-01, LC-08, LC-09, BND-02, BND-05 |
| `ready()` | LC-02, LC-04, AUTH-04 |
| `getConfig` | CFG-01, CFG-02, CFG-04, CFG-05, CFG-06, CFG-07, CFG-08, CFG-09, CFG-10, BND-01, AUTH-05, AUTH-06 |
| `subscribe` | CFG-11, CFG-12, CFG-20, CFG-25, CFG-33, CFG-35, CFG-36, CFG-37, CFG-38, CFG-39, CFG-49, CFG-50, CFG-51, CFG-52, CFG-56, CFG-57 |
| `unSubscribe` | CFG-29, CFG-30, CFG-31, CFG-53, CFG-54, CFG-58 |
| `publishSingle` | CFG-01, ERR-01, CON-15, BND-01, AUTH-07 |
| `publishConfigCas` | ERR-03, CON-15 |
| `remove` | CFG-02, CFG-03, ERR-02, AUTH-07 |
| `addConfigFilter` | CFG-40, CFG-41, CFG-42, CFG-43, CFG-44, CFG-45, CFG-46, CFG-47, CFG-59, CFG-60, CFG-61 |
| `close()` | LC-05, LC-06, LC-07, CFG-30, CFG-46, CFG-55 |
| `getCurrentUnit`, `getAllUnits`, `publishToAllUnit`, `removeToAllUnit`, `getConfigs`, `batchGetConfig`, `batchQuery`, `publishAggr`, `removeAggr` | ERR-04, HTTP-02 |

## Naming Client

| API | Scenarios |
| --- | --- |
| `new NacosNamingClient()` | LC-01, LC-08, BND-02, BND-05 |
| `ready()` | LC-02, LC-03, AUTH-04 |
| `registerInstance` | NAM-01, NAM-10, NAM-12, NAM-15, NAM-16, NAM-17, NAM-18, NAM-19, BND-03 |
| `deregisterInstance` | NAM-11, NAM-20, NAM-21, NAM-22, NAM-23, NAM-24, NAM-25, NAM-26, NAM-27, NAM-29, NAM-33 |
| `batchRegisterInstance` | NAM-13, BND-04 |
| `batchDeregisterInstance` | NAM-14, NAM-28, BND-04 |
| `getAllInstances` | NAM-01, NAM-04, NAM-05, NAM-06, NAM-31 |
| `selectInstances` | NAM-03, NAM-31 |
| `selectOneHealthyInstance` | NAM-03 |
| `subscribe` | NAM-02, NAM-40, NAM-42, NAM-43, NAM-44, NAM-46 |
| `unSubscribe` | NAM-41, NAM-45 |
| `getServerStatus` | LC-02 |
| `close()` | LC-05, LC-06, LC-07, NAM-57, NAM-58 |

## Options

| Option | Scenarios |
| --- | --- |
| `serverAddr`, `endpoint` | BND-02, CON-07, CON-08 |
| `contextPath` | CON-05 |
| `namespace` | LC-09, ISO-01 |
| `username`, `password` | AUTH-01, AUTH-04, ISO-04 |
| `accessKey`, `secretKey`, `ramRoleName`, `signatureRegionId` | AUTH-14, AUTH-15, WIRE-04 |
| `ssl`, `tls` | CON-18 |
| `grpcPortOffset` | CON-06 |
| `requestTimeout` | CON-13, CON-15 |
| `transport` | BND-05, HTTP-01, HTTP-03 |
| `logger` | LC-08, AUTH-16 |
| `cacheDir` | CFG-05, LC-09 |

## Errors And Events

| Surface | Scenarios |
| --- | --- |
| `NacosConnectionError` | CON-13, CON-18 |
| `NacosTimeoutError` | CON-14, CON-15 |
| `NacosServerError` | ERR-01, ERR-02, ERR-08 |
| `NacosAuthError` | AUTH-04, AUTH-05, AUTH-06, CFG-09 |
| `NacosValidationError` | BND-01, BND-03, BND-04 |
| `NacosUnsupportedError` | ERR-04, HTTP-03 |
| `error` event | ERR-06, LC-04, AUTH-12, NAM-46 |
| `localRead` event | CFG-04, CFG-07 |
| `redoPending`, `redoRestored` events | NAM-55 |

## Entry Points

| Entry | Scenarios |
| --- | --- |
| `@nacos-group/client` | PKG-01, PKG-02, PKG-04 |
| `@nacos-group/client/naming` | PKG-01, PKG-02 |
| `@nacos-group/client/config` | PKG-01, PKG-02 |
| `nacos`, `nacos-naming`, `nacos-config` | PKG-07 |

## Runtime Behavior

These scenarios have no single public method. They cover behavior that every call depends on.

| Behavior | Scenarios |
| --- | --- |
| Handshake and abilities | CON-01, CON-02, CON-03, CON-04, CON-16 |
| Reconnect and health | CON-09, CON-10, CON-11, CON-12, CON-17 |
| Login and token refresh | AUTH-02, AUTH-03, AUTH-08, AUTH-09, AUTH-10, AUTH-11, AUTH-13, AUTH-17 |
| Error model | ERR-05, ERR-07 |
| Wire compatibility | WIRE-02, WIRE-03 |
| Config sync and delivery | CFG-14, CFG-17, CFG-18, CFG-19, CFG-21, CFG-22, CFG-24, CFG-26, CFG-27, CFG-28, CFG-34, CFG-48 |
| Encryption plugin | ENC-01, ENC-02, ENC-03, ENC-04, ENC-05, ENC-06, ENC-07, ENC-08, ENC-09 |
| Naming cache | NAM-30, NAM-32 |
| Naming redo | NAM-50, NAM-51, NAM-52, NAM-53, NAM-54, NAM-56 |
| Client isolation | ISO-02, ISO-03, ISO-05, ISO-06 |
| Packaging | PKG-03, PKG-05, PKG-06, PKG-08 |
| Migration from 2.6.x | MIG-01, MIG-02, MIG-03, MIG-04, MIG-05, MIG-06, MIG-07 |

## Existing Test Files

These files come from 2.x, at `master` commit `22f6782`. **In CI** says whether CI runs the
file. **Plan** applies to the toolchain migration.

| File | In CI | Scenarios it helps | Plan |
| --- | --- | --- | --- |
| `packages/nacos-common/test/grpc/payload_codec.test.ts` | Yes | WIRE-01 | Keep. Add Java vectors. |
| `packages/nacos-config/test/client.test.ts` | No | - | Review. |
| `packages/nacos-config/test/client_worker.test.ts` | No | HTTP-02 | Run for HTTP. |
| `packages/nacos-config/test/grpc_config_proxy.test.ts` | Yes | LC-02, CFG-01, CFG-02, CFG-11, AUTH-01 | Replace with public client tests. |
| `packages/nacos-config/test/index.test.ts` | No | - | Review. |
| `packages/nacos-config/test/local_cache.test.ts` | Yes | CFG-04 to CFG-08, CFG-11, CFG-13, CFG-15, CFG-16, CFG-23, CFG-30, CFG-32, CFG-50, CFG-53, LC-06, ERR-08 | Keep as the base for the pipeline tests. Change the blank-content case, which asserts the empty-string defect. |
| `packages/nacos-config/test/publish_config_cas.integration.test.ts` | No | ERR-03 | Run in CI. |
| `packages/nacos-config/test/publish_config_cas.test.ts` | No | ERR-03 | Run in CI. |
| `packages/nacos-config/test/server_list_mgr.test.ts` | No | HTTP-02 | Run for HTTP. |
| `packages/nacos-config/test/snapshot.test.ts` | No | CFG-05 | Run in CI. |
| `packages/nacos-config/test/utils.test.ts` | Yes | - | Keep. |
| `packages/nacos-naming/test/naming/client.test.ts` | No | - | Review. |
| `packages/nacos-naming/test/naming/grpc_proxy.test.ts` | Yes | LC-02 | Replace with public client tests. |
| `packages/nacos-naming/test/naming/host_reactor.test.ts` | No | - | Remove with `HostReactor`. |
| `packages/nacos-naming/test/naming/instance.test.ts` | Yes | - | Keep. |
| `packages/nacos-naming/test/naming/proxy.test.ts` | Yes | HTTP-01 | Keep for HTTP. |
| `packages/nacos-naming/test/naming/push_receiver.test.ts` | Yes | HTTP-01 | Keep for HTTP. |
| `packages/nacos-naming/test/naming/select_one_healthy_instance.test.ts` | No | NAM-03 | Run in CI. |
| `packages/nacos-naming/test/naming/service_info.test.ts` | Yes | - | Keep. |
| `packages/nacos-naming/test/util/index.test.ts` | Yes | - | Keep. |
