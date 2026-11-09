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

# Nacos Node.js SDK Implementation Spec

This document defines how the Node.js SDK 3.x implements the shared
[SDK Spec](https://github.com/alibaba/nacos/blob/3.3.0/specs/en/sdk/sdk-spec.md).
Runtime semantics come from the
[Client Runtime Specs](https://github.com/alibaba/nacos/blob/3.3.0/specs/en/client/README.md).
Capability status is tracked in the [Feature Matrix](./feature-matrix-spec.md).

This document describes the 3.0 target. It does not claim that `master` already
behaves this way.

## 1. Scope

The repository provides a Client SDK only. It does not provide a Maintainer SDK
and does not expand the Client SDK write or management surface.

## 2. Packages And Entry Points

3.0 ships a single package, with one subpath per domain.

| Entry | Exports |
| --- | --- |
| `@nacos-group/client` | All stable public exports. |
| `@nacos-group/client/naming` | `NacosNamingClient` and naming models. |
| `@nacos-group/client/config` | `NacosConfigClient` and config models. |
| `@nacos-group/client/ai` | Later. See the Feature Matrix. |
| `@nacos-group/client/lock` | Later. See the Feature Matrix. |

The legacy packages `nacos`, `nacos-naming`, and `nacos-config` become bridge
packages from `3.0.0-rc.1`. A bridge only re-exports `@nacos-group/client`. It
contains no behavior.

The package requires Node.js 18 or later. `@nacos-group/sdk-proto` is a regular,
pinned dependency. A missing codec fails at load time and is never silently
replaced by a fallback.

## 3. Lifecycle

| Stage | Contract |
| --- | --- |
| Construct | Validates options synchronously and throws on invalid values. Starts connecting in the background, as in 2.6.x. |
| `ready()` | Resolves when the client can serve requests. Rejects as defined in section 3.1. |
| `close()` | Stops timers, cancels pending work, closes connections, and removes server push handlers. Calling it again has no effect. |

Rules:

- One client instance is bound to one namespace. Public methods take no
  namespace argument.
- A client shares no connection, cache, or listener state with another client.
  This holds both within a process and across processes.
- After `close()`, requests reject and no listener is called.

### 3.1 `ready()` Failure

| Situation | Naming | Config |
| --- | --- | --- |
| Credentials rejected (401 or 403) | Rejects | Rejects |
| Server unreachable | Rejects | Emits `error`, then resolves and reconnects in the background |

Config keeps resolving when the server is unreachable so that it can start from
failover and snapshot data.

## 4. Options

Option names follow the Java properties where one exists. Both clients accept
the same common options.

| Option | Scope | Default | Meaning |
| --- | --- | --- | --- |
| `serverAddr` | common | - | Server address list, as a string or array. |
| `endpoint` | common | - | Dynamic address endpoint. |
| `contextPath` | common | `nacos` | Server context path. |
| `namespace` | common | `public` | Namespace bound to the client. |
| `username`, `password` | common | - | Login credentials. |
| `accessKey`, `secretKey`, `ramRoleName`, `signatureRegionId` | common | - | RAM-style credentials. |
| `ssl` | common | `false` | Use TLS. |
| `requestTimeout` | common | `3000` on gRPC, as in Java; `5000` on HTTP, as in 2.6.x | Request timeout in milliseconds. |
| `transport` | common | `grpc` | `grpc` or `http`. |
| `logger` | common | Console-based logger | Logger with `info`, `warn`, and `error`. |
| `cacheDir` | config | `~/.node-diamond-client-cache` | Snapshot and failover directory. |

At least one of `serverAddr` and `endpoint` is required. Priority between them
follows Java and is defined by the Node.js Runtime Spec. Options that only the
HTTP transport uses, such as `unit` and `clusterName`, stay as they are.

When `namespace` is not set, requests use `public`, but local cache paths keep the
2.x `default_tenant` segment. Existing snapshot and failover files stay valid after
an upgrade.

Deprecated names keep working in 3.x and log one warning per client. If both
names are set, the new name wins.

| Deprecated | Use |
| --- | --- |
| `serverList` (naming) | `serverAddr` |
| `ak`, `sk` (naming) | `accessKey`, `secretKey` |

Options are read from the constructor argument only. Unlike Java, the SDK has no
general property lookup through the environment. The Alibaba Cloud credential
variables already read by `aliyun_auth` stay supported.

## 5. Public API

All I/O methods return a `Promise`. Names stay as they are in 2.x, so that the
migration only has to handle behavior changes.

### 5.1 `NacosConfigClient`

| Method | Java | Result |
| --- | --- | --- |
| `getConfig(dataId, group)` | `getConfig` | Config content. A missing config resolves to `null`. |
| `subscribe({ dataId, group }, listener)` | `addListener` | Registers a listener. |
| `unSubscribe({ dataId, group }, listener?)` | `removeListener` | Removes the listener, or all listeners when none is given. |
| `publishSingle(dataId, group, content, options?)` | `publishConfig` | Resolves `true`. Rejects on failure. |
| `publishConfigCas(dataId, group, content, casMd5, options?)` | `publishConfigCas` | Resolves `true`, or `false` on md5 conflict. Rejects on any other failure. |
| `remove(dataId, group)` | `removeConfig` | Resolves `true`. Removing a missing config succeeds. Rejects on failure. |
| `addConfigFilter(filter)` | `addConfigFilter` | Added in 3.0. See the [Config Pipeline Spec](../config/config-pipeline-spec.md#8-transform). |
| `close()` | `shutDown` | See section 3. |

### 5.2 `NacosNamingClient`

| Method | Java | Result |
| --- | --- | --- |
| `registerInstance(serviceName, instance, groupName?)` | `registerInstance` | Rejects on failure. |
| `deregisterInstance(serviceName, instance, groupName?)` | `deregisterInstance` | Rejects on failure. |
| `batchRegisterInstance(serviceName, instances, groupName?)` | `batchRegisterInstance` | Added in 3.0. |
| `batchDeregisterInstance(serviceName, instances, groupName?)` | `batchDeregisterInstance` | Added in 3.0. |
| `getAllInstances(serviceName, groupName?, clusters?, subscribe?)` | `getAllInstances` | Instances, or an empty array when the service has none. |
| `selectInstances(serviceName, groupName?, clusters?, healthy?, subscribe?)` | `selectInstances` | Filtered instances. |
| `selectOneHealthyInstance(serviceName, groupName?, clusters?, subscribe?)` | `selectOneHealthyInstance` | One instance by weight, or `null`. |
| `subscribe(info, listener)` | `subscribe` | Registers a listener. |
| `unSubscribe(info, listener?)` | `unsubscribe` | Removes the listener, or all listeners when none is given. |
| `getServerStatus()` | `getServerStatus` | `UP` or `DOWN`. |
| `close()` | `shutDown` | See section 3. |

### 5.3 Legacy Config APIs

These methods have no gRPC implementation. They stay available on the HTTP
transport with unchanged behavior. On gRPC they reject with
`NacosUnsupportedError`.

`getCurrentUnit`, `getAllUnits`, `publishToAllUnit`, `removeToAllUnit`,
`getConfigs`, `batchGetConfig`, `batchQuery`, `publishAggr`, `removeAggr`.

## 6. Error Model

This section implements the five failure classes in
[Failure Visibility](https://github.com/alibaba/nacos/blob/3.3.0/specs/en/client/client-connection-failover-spec.md#8-failure-visibility).
The first three fail the call. The last two are not errors, because the SDK still
has a usable result, but they must stay observable.

| Failure class | Surface | Caller can assume |
| --- | --- | --- |
| Connection unavailable | Rejects with `NacosConnectionError` | The request was not sent. |
| Result unknown | Rejects with `NacosTimeoutError` | Nothing. A write may have been applied. |
| Server rejected | Rejects with `NacosServerError`, or its subclass `NacosAuthError` for 401 and 403 | The server refused the request. |
| Read served locally | Resolves with local content, and emits `localRead` | The content may be stale. |
| Redo not yet restored | Emits `redoPending`, then `redoRestored` | Registrations or subscriptions are not active yet. |

Two more errors do not come from the runtime:

| Case | Surface |
| --- | --- |
| Invalid argument | Rejects or throws `NacosValidationError` before any request. |
| API unavailable on this transport or server | Rejects with `NacosUnsupportedError`. |

All error classes extend `NacosError`:

```ts
class NacosError extends Error {
  code: string;      // Stable SDK code, such as NACOS_REQUEST_TIMEOUT.
  cause?: unknown;   // The underlying error.
}

class NacosServerError extends NacosError {
  resultCode?: number;  // Response result code.
  errorCode?: number;   // Nacos error code from the server.
}
```

Rules:

- A request in flight when the connection drops is a result-unknown failure, not a
  connection failure, because the server may have applied it. It rejects with
  `NacosTimeoutError` and the code `NACOS_CONNECTION_LOST`.
- A failed response never turns into a success, an empty result, or a timeout.
  Reject with what the server said.
- Failures that have no caller, such as a background refresh or a listener that
  throws, go to the `error` event. They must not crash the process, even when
  no `error` listener is registered.
- A throwing listener does not stop other listeners.
- Logs and errors never contain passwords, tokens, or secret keys.

`localRead` and the redo events carry only the resource identity and the reason.
Their full payloads are defined with the runtime specs.

## 7. Differences From Java

| Topic | Java | Node.js |
| --- | --- | --- |
| Async model | Blocking calls and executors | `Promise` and callbacks on the event loop |
| Construction | Factories, such as `NacosFactory` | `new NacosConfigClient(options)`, then `await client.ready()` |
| Failures | `NacosException` | Rejected `Promise` with a `NacosError` subclass |
| Listener executor | Listener may supply an `Executor` | Not supported. Listeners run on the event loop. |
| Async listener | Not applicable | A returned `Promise` is observed, and its rejection goes to `error` |
| Unsubscribe | Requires the same listener instance | Same, or omit the listener to remove all of them |
| Configuration lookup | Properties, JVM properties, environment | Constructor options only |

Because operations interleave at every `await`, work on one config key or service
key must run in order, and a late result must be dropped once the key has been
unsubscribed or closed. The runtime specs define this per domain.

## 8. Transports

gRPC is the default and the only transport that receives new work. HTTP is frozen
in 3.x: it keeps existing behavior, gets regression tests against Nacos 2.5.5,
and is not brought to feature parity. New APIs reject with
`NacosUnsupportedError` on HTTP.

Failure semantics in section 6 apply to gRPC. HTTP keeps its 2.6.x behavior, and the
migration guide lists the differences.

## 9. 3.0 Migration

There are two baselines, and they must not be mixed. npm 2.6.3 has no gRPC, so 3.0 is the
first release with it. Behavior that exists only on `master` is not a contract that users
depend on, and 3.0 does not preserve it.

### 9.1 Released 2.6.x To 3.0

These rows are the migration guide. Compatibility tests use 2.6.3 as their baseline.

| Topic | 2.6.x | 3.0 |
| --- | --- | --- |
| Package | `nacos`, `nacos-naming`, `nacos-config` | `@nacos-group/client`. Legacy names are bridges. |
| Exports | Internals such as `ClientWorker` and `HostReactor` are exported | See section 11. |
| Node.js | `>= 8.0.0` declared | `>= 18` |
| Default transport | HTTP, with long polling and UDP push | gRPC. The server gRPC port must be reachable. Set `transport: 'http'` to stay on HTTP. |
| Config client sharing | Shared through `cluster-client` | Not shared by default. See the [Architecture Spec](../design/architecture-spec.md#5-client-isolation). |
| Credentials | `username` and `password` sent with each request | Login once, then a token. Rejected credentials make `ready()` reject. |
| Legacy config APIs | Work | Reject with `NacosUnsupportedError` on gRPC. Unchanged on HTTP. |
| Failed writes | Reject with a plain `Error` | Reject with a `NacosError` subclass. |
| Discovery failure with nothing cached | Emits `error` and resolves `[]` | Rejects. |
| Authorization rejected on `getConfig`, snapshot present | Resolves the snapshot | Rejects. |
| Option names | `serverList`, `ak`, `sk` on naming | Deprecated. See section 4. |

2.6.x has no config encryption. If a 2.7.x release adds KMS over HTTP, its users must move to
gRPC to keep KMS in 3.x, as the
[Config Pipeline Spec](../config/config-pipeline-spec.md#13-transport-and-decrypt-fallback)
explains.

Behavior that stays the same as 2.6.x: `publishSingle` and `remove` resolve `true` and reject
on failure, a new config listener receives the current value at once, a deleted config is
delivered as `null`, and several instances of one service can be registered from one client.

### 9.2 Unreleased `master` To 3.0

These rows are defects in the unreleased gRPC work. They are corrected, not migrated, so they
do not belong in the migration guide.

| Area | `master` | 3.0 |
| --- | --- | --- |
| `publishSingle`, `remove` | Resolve `false` on a non-200 response | Reject |
| `publishConfigCas` | Every non-200 response resolves `false` | Only an md5 conflict does |
| Legacy config APIs | Inconsistent; for example, `publishToAllUnit` resolves `true` without publishing | Reject with `NacosUnsupportedError` |
| `getCurrentUnit`, `getAllUnits` | Return `'gRPC'` and `[]` | Reject with `NacosUnsupportedError` |
| Deleted config | Delivered as `''` | Delivered as `null` |
| Snapshot | An empty string deletes it | An empty string is valid content |
| Snapshot fallback | Used for every query failure | Not used when authorization is rejected |
| Failed login | Reported as a success | `ready()` rejects |
| Token | Never refreshed | Refreshed before it expires |
| Discovery | Empty with default parameters | Works |
| Second instance of a service | Replaces the first | Adds to the set |
| Persistent instance | Registered as ephemeral | Uses the persistent path |
| `deregisterInstance` | Non-200 resolves; local record removed first | Rejects; record kept until confirmed |

## 10. Maintenance

2.x receives bug and security fixes until 3.x is stable, and no new features.
A 2.x release uses its own dist-tag and must not overwrite `latest`.

## 11. Open Questions

- **Internal exports:** 2.x exports internals such as `ClientWorker`,
  `ServerListManager`, `Snapshot`, `HttpAgent`, `NamingProxy`, and `HostReactor`.
  Section 2 limits `@nacos-group/client` to stable public exports. Decide whether
  the bridges keep the old names for one major version.
- **`cluster` option:** See the
  [Architecture Spec](../design/architecture-spec.md#5-client-isolation).
