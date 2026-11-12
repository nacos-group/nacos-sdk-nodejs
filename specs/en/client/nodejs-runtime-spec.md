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

# Nacos Node.js SDK Runtime Spec

This document defines the shared runtime of the Node.js SDK 3.x: addressing,
connection, ability negotiation, and authentication. Config and Naming sit on top
of it, and both use it the same way.

Shared semantics come from these specs, which this document does not repeat:

- [Client Runtime Spec](https://github.com/alibaba/nacos/blob/3.3.0/specs/en/client/client-runtime-spec.md)
- [Client Connection And Failover Spec](https://github.com/alibaba/nacos/blob/3.3.0/specs/en/client/client-connection-failover-spec.md)
- [Client Ability Negotiation Spec](https://github.com/alibaba/nacos/blob/3.3.0/specs/en/client/client-ability-negotiation-spec.md)

The reference implementation is Java `RpcClient`, `GrpcClient`, and `SecurityProxy`.
Values below come from those classes unless the text says otherwise.

## 1. Scope

The runtime owns the connection and signals when it changes. It does not recover
domain state. Recovery after a signal is defined by the
[Config Pipeline Spec](../config/config-pipeline-spec.md#6-server-sync) and the
[Naming Runtime Spec](../naming/naming-runtime-spec.md#6-redo).

Each client owns one runtime instance, so a Config client and a Naming client each
have their own connection, as in Java.

## 2. Addressing

If both `endpoint` and `serverAddr` are set, `endpoint` wins, matching the order of
the Java server list providers.

| Mode | Behavior |
| --- | --- |
| `serverAddr` | Fixed list. It does not change after construction. |
| `endpoint` | Fetched from the address server, then refreshed every 30 seconds. |

Normalization:

- An address without a port uses `8848`.
- The gRPC port is the server port plus `grpcPortOffset`, which defaults to `1000`.
- `contextPath` applies to HTTP calls, including login. It is not part of the gRPC
  target.

A failed refresh keeps the previous list and goes to the `error` event. When a
refresh removes the current server, the connection reconnects.

## 3. Connection

```text
STARTING ──> RUNNING ──> UNHEALTHY ──> RUNNING
    └──────────────────────┴────────────────────> SHUTDOWN
```

### 3.1 Handshake

1. Log in, if credentials are configured.
2. Send `ServerCheckRequest` with a timeout of 3 seconds.
3. Open the bidirectional stream and send `ConnectionSetupRequest`.
4. If `ServerCheckResponse` reports ability negotiation, wait for `SetupAckRequest`.
   If it does not arrive within 5 seconds, abandon this attempt.
5. Enter `RUNNING` and emit `connected`.

`ConnectionSetupRequest` carries:

| Field | Value |
| --- | --- |
| `clientVersion` | `Nacos-Node-Client:v<package version>` |
| `tenant` | The bound namespace. |
| `labels` | `source: sdk` and `module: config` or `module: naming`. |
| `abilityTable` | The abilities in section 4. |

`master` sleeps 500 ms in place of step 4 and sends a fixed `2.0.0` version.

### 3.2 Reconnect

Reconnect is triggered by the cases in
[gRPC Connection Lifecycle](https://github.com/alibaba/nacos/blob/3.3.0/specs/en/client/client-connection-failover-spec.md#3-grpc-connection-lifecycle).
A response with error code `301` (`UN_REGISTER`) also triggers it, because the server
no longer knows this connection.

`301` is handled inside the request retry loop in section 3.5, not by the caller. The
connection moves to `UNHEALTHY`, the next server is selected asynchronously, and the
request is retried after a short wait within the same budget.

- Each reconnect attempt uses the next server in the list. A request retry inside a call
  keeps the current connection unless `301` selects a new server.
- The delay starts at 1 second, doubles, and is capped at 60 seconds. It resets after
  a successful connection.
- `ConnectResetRequest` is acknowledged. If it names a server that is in the current
  list, that server is tried first.
- `ClientDetectionRequest` is acknowledged.

Every connection is new to the server. Ability state does not carry over.

### 3.3 Health Check

If the connection has been idle for 5 seconds, the client sends `HealthCheckRequest`
as a unary call with a timeout of 3 seconds. It retries up to 3 times, and then
enters `UNHEALTHY`.

The check must wait for a response, so that it detects a half-open connection.
`master` only writes to the stream, which cannot fail in that case.

### 3.4 Signals

| Signal | Emitted when | Meaning |
| --- | --- | --- |
| `disconnected` | `RUNNING` is left. | Server-side listeners and subscriptions for this connection are gone. |
| `connected` | `RUNNING` is entered. | A new connection is ready. Domain state must be restored. |

Each signal increments a connection `epoch`. A domain uses the `epoch` to detect a late
response from an earlier connection.

### 3.5 Requests

| Connection state | Behavior |
| --- | --- |
| `RUNNING` | Sends the attempt. |
| `STARTING`, `UNHEALTHY` | Waits for `RUNNING` until the remaining budget is exhausted, then counts as a connection failure. |
| `SHUTDOWN` | Rejects with `NacosConnectionError` without an attempt. |

A request runs a bounded retry loop, following Java `RpcClient#request`:

| Property | Value |
| --- | --- |
| Attempts | One initial attempt and up to three retries. |
| Budget | `start + requestTimeout`, default 3000 ms. |
| Deadline check | Before each attempt. Each attempt may use the full per-attempt timeout, so the total can exceed the budget. `requestTimeout <= 0` disables the deadline check. |
| Retry trigger | Any failed attempt: connection unavailable, connection lost, no response, timeout, result unknown, or any `ErrorResponse`, including a server rejection. |
| `301 UN_REGISTER` | Moves the connection to `UNHEALTHY`, selects the next server asynchronously, waits `min(100, requestTimeout / 3)`, and retries within the same budget. |

When the attempts or the budget are exhausted, the call rejects. The class is decided over
the whole call, so that the error model's guarantee stays true:

| Outcome of the call | Error |
| --- | --- |
| No attempt was sent | `NacosConnectionError` |
| At least one attempt was sent, and the final failure has no server response | `NacosTimeoutError` with `NACOS_CONNECTION_LOST` |
| The final attempt received a server response | `NacosServerError`, or `NacosAuthError` for 401 and 403 |

The middle row is deliberate. An earlier attempt may have been applied even when a later
attempt could not be sent, so the call is result unknown, not connection unavailable. Java
surfaces the last exception instead; Node.js keeps the stronger guarantee from the
[error model](../sdk/sdk-nodejs-impl-spec.md#6-error-model).

A replay after an unknown result may apply a write more than once. Each operation therefore
documents its replay policy: Naming keeps its intent and uses redo (Naming Runtime Spec
section 6), and the Config CAS stale-comparison boundary is in the
[SDK Implementation Spec](../sdk/sdk-nodejs-impl-spec.md#51-nacosconfigclient).
Retaining an intent or replaying a request never turns a failed call into a success.

The runtime also provides an internal `requestOnce` path with no retries, for a caller that
must not replay. It is not part of the public API.

## 4. Ability Negotiation

Ability state belongs to the current connection and is reset on reconnect.

| Result | Meaning |
| --- | --- |
| `SUPPORTED` | The server table says `true`. |
| `NOT_SUPPORTED` | The server table says `false`. |
| `UNKNOWN` | No table was received, or the key is absent. |

`UNKNOWN` is never treated as support. A feature that needs an ability checks it when
the operation runs, and does not cache the result across connections. If there is no
documented fallback, it rejects with `NacosUnsupportedError`.

The client declares only the abilities it implements. 3.0 declares none. Fuzzy watch,
AI, and Lock add theirs when they ship.

## 5. Authentication

The runtime owns authentication. Domain code never handles tokens or signatures. It
hands the runtime a request and the resource it targets.

### 5.1 Username And Password

Login tries `POST <contextPath>/v3/auth/user/login` first. If the server answers 404
or 501, it uses `<contextPath>/v1/auth/users/login`. It tries each server in the list
until one answers.

| Login result | Effect |
| --- | --- |
| Token and `tokenTtl` | Stores the token. |
| Token without `tokenTtl` | Login fails. |
| No token | Auth is off on the server. No header is sent, and no refresh runs. |
| 401 or 403 | Credentials rejected. |
| No server reachable | Server unreachable. |

`master` uses only `/nacos/v1/auth/login`, and reports a failed login as a success.

### 5.2 Token Refresh

A timer checks the token every 5 seconds. It refreshes when the token age reaches
`tokenTtl` minus a refresh window. The window is a random value between `tokenTtl / 15`
and `tokenTtl / 10`, so that clients do not all refresh at once.

| Refresh failure | Effect |
| --- | --- |
| Server unreachable | Keeps the current token and tries again on the next check. |
| Credentials rejected | Goes to the `error` event. Later requests fail with `NacosAuthError`. |

A 403 response marks the token for refresh, at most once per 60 seconds. The request
that got the 403 still rejects, as in Java.

### 5.3 AK/SK

Options match [Options](../sdk/sdk-nodejs-impl-spec.md#4-options). Signing follows the
[RAM Auth Plugin Spec](https://github.com/alibaba/nacos/blob/3.3.0/specs/en/auth/ram-auth-plugin-spec.md).

gRPC must reach parity with what the HTTP path already supports in `aliyun_auth`,
including `ramRoleName` and the `alibabaCloud*` options. Otherwise, MSE users regress
when they move to the default gRPC transport. 3.x has one implementation, shared by
Config and Naming.

### 5.4 Startup

| Situation | `ready()` |
| --- | --- |
| Credentials rejected | See [`ready()` Failure](../sdk/sdk-nodejs-impl-spec.md#31-ready-failure). |
| Server unreachable | Same. |

If `ready()` rejects because credentials were rejected, the client stops trying and
enters `SHUTDOWN`. A retry would only repeat the failure, and could lock the account.

## 6. TLS

`ssl: true` uses TLS with the Node.js default trust store. To use a private CA or mutual
TLS, set `tls`:

```ts
interface TlsOptions {
  ca?: string | Buffer;
  cert?: string | Buffer;
  key?: string | Buffer;
}
```

A TLS mismatch with the server is a connection failure. There is no option to disable
certificate verification. Java has a trust-all mode for test environments. Node.js
leaves it out, so that it cannot reach production.

## 7. Process Lifecycle

- All timers call `unref()`.
- `close()` runs in this order: stop timers, reject pending requests, close the stream,
  and close the channel. It enters `SHUTDOWN`.
- An open gRPC stream can keep the process alive. Applications call `close()` on
  shutdown. Java threads are daemons, so this is a difference from Java.
- The SDK installs no handler on `process`.

## 8. Differences From Java

| Topic | Java | Node.js |
| --- | --- | --- |
| Credentials rejected at startup | Logs, and continues in the background | `ready()` rejects and the client stops |
| TLS trust-all | Available | Not available |
| Custom address and auth providers | SPI | Not available |
| Process exit | Daemon threads | `close()` is required |
