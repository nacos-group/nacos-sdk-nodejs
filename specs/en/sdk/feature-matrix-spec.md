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

# Nacos Node.js SDK Feature Matrix

This document records how the Node.js Client SDK aligns with the Java Client SDK
capabilities in the
[Java SDK Implementation Spec](https://github.com/alibaba/nacos/blob/3.3.0/specs/en/sdk/sdk-java-impl-spec.md#5-java-client-sdk-interfaces).

The Maintainer SDK is out of scope. This repository adds no Admin or broad
management API, following the
[Client SDK scope](https://github.com/alibaba/nacos/blob/3.3.0/specs/en/sdk/sdk-spec.md#2-client-sdk-scope).

## 1. Reading The Tables

**Node today** describes `master` on the default gRPC transport. npm 2.6.3 has no gRPC,
so these values are not released behavior. The
[implementation spec](./sdk-nodejs-impl-spec.md#9-30-migration) keeps the two baselines
apart.

| Value | Meaning |
| --- | --- |
| Yes | Available and expected to match the Java contract. |
| Partial | Available, with the gap named in the row. |
| No | Not available. |

**Target** is the first release expected to meet the Java contract. A PR label
refers to the [roadmap](https://github.com/nacos-group/nacos-sdk-nodejs/issues/162).
**Not planned** means no roadmap item covers it. Add one before implementing it.

Update a row in the same PR that changes the capability.

## 2. Config

| Capability | Java | Node API | Node today | Target |
| --- | --- | --- | --- | --- |
| Query config | `getConfig` | `getConfig` | Yes | - |
| Query with md5 | `getConfigWithResult` | - | No | Not planned |
| Query and listen | `getConfigAndSignListener` | - | No | Not planned |
| Listen | `addListener`, `removeListener` | `subscribe`, `unSubscribe` | Partial: recovery after reconnect is incomplete | 3.0 (PR5) |
| Publish | `publishConfig` | `publishSingle` | Partial: non-200 responses resolve to `false` | 3.0 (PR3) |
| CAS publish | `publishConfigCas` | `publishConfigCas` | Partial: every non-200 response resolves to `false`, not only md5 conflict | 3.0 (PR3) |
| Delete | `removeConfig` | `remove` | Partial: non-200 responses resolve to `false` | 3.0 (PR3) |
| Failover and snapshot | `LocalConfigInfoProcessor` | Internal | Partial: an empty string is treated as deletion; authorization failures fall back to the snapshot | 3.0 (PR5) |
| Config filter | `addConfigFilter` | `addConfigFilter` | No | 3.0 (PR5) |
| Config encryption | `ConfigEncryptionFilter` | - | No | 3.0 or 3.x, after PR5 |
| Fuzzy watch | `fuzzyWatch`, `fuzzyWatchWithGroupKeys`, `cancelFuzzyWatch` | - | No | 3.x (PR6) |
| Server status | `getServerStatus` | - | No | Not planned |
| Shutdown | `shutDown` | `close` | Yes | - |

## 3. Naming

| Capability | Java | Node API | Node today | Target |
| --- | --- | --- | --- | --- |
| Register | `registerInstance` | `registerInstance` | Partial: a second instance replaces the first; persistent instances register as ephemeral | 3.0 (PR4) |
| Deregister | `deregisterInstance` | `deregisterInstance` | Partial: no persistent path; non-200 responses resolve; the local record is removed before the server confirms | 3.0 (PR4) |
| Batch register | `batchRegisterInstance` | - | No | 3.0 (PR4) |
| Batch deregister | `batchDeregisterInstance` | - | No | 3.0 (PR4) |
| Query instances | `getAllInstances`, `selectInstances`, `selectOneHealthyInstance` | Same names | Partial: default-parameter discovery can return empty | 3.0 |
| Subscribe | `subscribe`, `unsubscribe` | `subscribe`, `unSubscribe` | Partial: same discovery gap; no deduplication | 3.0 (PR4) |
| Redo after reconnect | `NamingGrpcRedoService` | Internal | Partial: no retry | 3.0 (PR4) |
| Fuzzy watch | `fuzzyWatch`, `fuzzyWatchWithServiceKeys`, `cancelFuzzyWatch` | - | No | 3.x (PR6) |
| List services | `getServicesOfServer` | - | No: proxy only | Not planned |
| Subscribed services | `getSubscribeServices` | - | No | Not planned |
| Server status | `getServerStatus` | `getServerStatus` | Yes | - |
| Service disk cache | `ServiceInfoHolder` | Internal | No | Not planned |
| Naming failover | `FailoverReactor` | Internal | No | Not planned |
| Push-empty protection | `namingPushEmptyProtection` | - | No | Not planned |
| Shutdown | `shutDown` | `close` | Yes | - |

`getServicesOfServer` is a Java compatibility surface. New broad listing belongs
to the Maintainer SDK.

## 4. Authentication

| Capability | Java | Node today | Target |
| --- | --- | --- | --- |
| Username and password | `NacosClientAuthServiceImpl` | Partial: v1 login only, login failure is silent, no token refresh | 3.0 (PR3) |
| AK/SK and RAM | `RamClientAuthServiceImpl` | Partial: HTTP only | 3.0 (PR3) |
| OIDC | `OidcClientAuthServiceImpl` | No | Not planned |

## 5. Connection And Runtime

| Capability | Java | Node today | Target |
| --- | --- | --- | --- |
| Fixed server list | `serverAddr` | Yes | - |
| Endpoint addressing | `endpoint` | Partial: HTTP only | 3.0 (PR2) |
| Context path | `contextPath` | Partial: gRPC login uses a fixed `/nacos` path | 3.0 (PR2) |
| Request timeout | `configRequestTimeout`, `namingRequestTimeout` | Partial: gRPC uses a fixed 3000 ms | 3.0 (PR2) |
| Setup acknowledgement | `SetupAckRequest` | No | 3.0 (PR2) |
| Ability negotiation | Client and server ability tables | No: the client sends an empty table | 3.0 (PR2) |
| Real client version | `clientVersion` | No: fixed to `2.0.0` | 3.0 (PR2) |
| Client isolation | One instance, one namespace | Partial: config clients can share a connection across processes | 3.0 (PR2) |

## 6. Later Domains

| Capability | Java | Node today | Target |
| --- | --- | --- | --- |
| Prompt, Skill, AgentSpec, and MCP read and subscribe | `AiService` | No | 3.x (PR7) |
| MCP publish and endpoint; Agent register, discover, search, and watch | `AiService` | No | 3.x (PR8) |
| Distributed lock | `LockService` | No | 3.x (PR9) |

Lock is
[experimental](https://github.com/alibaba/nacos/blob/3.3.0/specs/en/lock/lock-spec.md#2-experimental-status)
and carries no cross-language parity guarantee. Its spec defers cross-language SDK
contracts until the server semantics are stable, so confirm the scope before PR9.

## 7. Server Compatibility

| Server | Support |
| --- | --- |
| 2.5.x | Supported. Earlier 2.x versions are not tested. |
| 3.x | Supported. |

Capabilities that need a newer server are gated by ability negotiation, following
the [Client Ability Negotiation Spec](https://github.com/alibaba/nacos/blob/3.3.0/specs/en/client/client-ability-negotiation-spec.md).
For example, fuzzy watch requires `SERVER_FUZZY_WATCH`.

| Capability | Minimum server |
| --- | --- |
| Fuzzy watch | 3.0 |
| Agent | 3.3 |
| Lock | Decided with PR9 |
