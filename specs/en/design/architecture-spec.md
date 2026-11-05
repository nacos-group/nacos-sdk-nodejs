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

# Nacos Node.js SDK Architecture Spec

This document defines the internal structure of the Node.js SDK 3.x and how its
responsibilities map to the Java Client SDK. Public behavior is defined by the
[Node.js SDK Implementation Spec](../sdk/sdk-nodejs-impl-spec.md).

## 1. Principles

- 3.x aligns the internal structure with Java, so that a Java fix or spec change
  has an obvious place to land in Node.js.
- Alignment is by responsibility. Internal names should match Java where that
  helps, but do not have to. Public class names do not change.
- Each runtime concern has one owner. A domain client does not reach into the
  transport, and a transport does not know domain rules.
- All state belongs to a client instance. There is no module-level mutable state.

## 2. Layers

The layers follow
[Client Runtime Layers](https://github.com/alibaba/nacos/blob/3.3.0/specs/en/client/client-runtime-spec.md#2-runtime-layers):

```text
Public client            NacosConfigClient, NacosNamingClient
  -> Domain runtime      config pipeline; naming proxy, cache, and redo
     -> Shared runtime   server list, auth, ability, RPC client
        -> Transport     gRPC, HTTP (frozen)
           -> Codec      @nacos-group/sdk-proto
```

Dependencies point downward only. Domain runtimes never import each other.
Public behavior must stay the same when the transport changes.

## 3. Source Layout

Target layout after the migration to one package:

```text
packages/client/src/
  index.ts            Public exports
  common/             Errors, options, logger, shared utilities
  remote/             RPC client, gRPC transport, payload codec, ability
  auth/               Login, token refresh, AK/SK signing
  address/            Server list, endpoint addressing
  config/             Config client and pipeline
  naming/             Naming client, proxies, cache, redo
```

`packages/nacos`, `packages/nacos-config`, and `packages/nacos-naming` hold only
bridge re-exports. Only the entries listed in the implementation spec are public.
Everything else is unreachable through the package `exports` map.

## 4. Mapping To Java

Java paths are relative to `com.alibaba.nacos` at tag `3.3.0`.

| Responsibility | Java | Node.js today | Node.js 3.x |
| --- | --- | --- | --- |
| Config entry | `client.config.NacosConfigService` | `NacosConfigClient`, `DataClient` | `NacosConfigClient` |
| Naming entry | `client.naming.NacosNamingService` | `NacosNamingClient` | `NacosNamingClient` |
| RPC client | `common.remote.client.RpcClient`, `grpc.GrpcClient` | `GrpcConnection`, `GrpcTransportClient` | Same responsibility; replaces `GrpcConnection` |
| Auth | `client.security.SecurityProxy` | Login in `GrpcConnection`; `aliyun_auth` per package | One owner, shared by both domains |
| Server list | `client.address.AbstractServerListManager`, `client.config.impl.ConfigServerListManager`, `client.naming.core.NamingServerListManager` | `ServerListManager` (config HTTP); `serverList` in `GrpcConnection` | One shared base, as in Java |
| Config listening | `client.config.impl.ClientWorker`, `CacheData` | `DataClient`, `ClientWorker`, `GrpcConfigProxy` | Same responsibility |
| Config filter | `client.config.filter.impl.ConfigFilterChainManager` | None | Same responsibility |
| Local config | `client.config.impl.LocalConfigInfoProcessor` | `Snapshot` | Same responsibility, building on `Snapshot` |
| Naming proxy | `client.naming.remote.NamingClientProxyDelegate`, `NamingGrpcClientProxy`, `NamingHttpClientProxy` | `GrpcNamingProxy`, `NamingProxy` | Same responsibility |
| Naming redo | `client.naming.remote.gprc.redo.NamingGrpcRedoService` | Inside `GrpcNamingProxy` | Same responsibility |
| Service cache | `client.naming.cache.ServiceInfoHolder` | `HostReactor` | Same responsibility; replaces `HostReactor` |
| Service refresh | `client.naming.core.ServiceInfoUpdateService` | `HostReactor` | Same responsibility; replaces `HostReactor` |
| Service notification | `client.naming.event.InstancesChangeNotifier` | `HostReactor` | Same responsibility; replaces `HostReactor` |

The `gprc` package name is spelled that way in Java.

## 5. Client Isolation

A client owns its connection, auth state, cache, and listeners. Two clients with
different addresses, namespaces, or credentials must never affect each other.

`NacosConfigClient` extends `APIClientBase` from `cluster-client` in 2.x. That
shares one connection between processes through a local port, and it names the
cluster with `DiamondClient@${endpoint}`. With `serverAddr`, `endpoint` is
undefined, so unrelated clients on one host join the same cluster. A process can
then publish to another process's server.

3.0 removes this default: each client connects on its own. In a multi-worker
application, connections therefore grow from one per host to one per process.

**Proposed, pending maintainer confirmation:** a caller that passes
`options.cluster` explicitly, such as `app.cluster` in egg, keeps sharing. The
cluster name then includes the address, namespace, and username.

## 6. Extension Points

The SDK has one planned extension point in 3.0: the config filter, defined by the
Config Pipeline Spec. Config encryption is one filter, not a separate path.
Other Java extension points, such as custom addressing and auth services, are not
planned. Adding one needs a spec change first.

## 7. Dependencies

Runtime dependencies stay minimal. The 3.x runtime must not need `cluster-client`
by default, and it drops utility packages that Node.js 18 replaces with built-ins.
