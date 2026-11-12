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

# Node.js SDK Scenario Matrix

This matrix lists the scenarios required for 3.0. The
[Test Design Spec](../specs/en/testing/test-design-spec.md) defines the layers, the gates,
and the status values.

- **Layer:** `U` unit, `W` wire contract, `I` integration, `R` reliability job, `P` package.
- **Gate:** the first release that needs the scenario.
- **Rule:** the spec section the scenario verifies. `Impl` is the Node.js SDK Implementation
  Spec, `Arch` the Architecture Spec, `Runtime` the Node.js Runtime Spec, `Config` the Config
  Pipeline Spec, and `Naming` the Naming Runtime Spec.

`Partial` means that a 2.x test exercises the behavior. See the
[Coverage Registry](./COVERAGE.md#existing-test-files).

## Lifecycle

| ID | Scenario | Expected | Layer | Gate | Rule | Status |
| --- | --- | --- | --- | --- | --- | --- |
| LC-01 | Invalid options | The constructor throws. | U | beta | Impl 3 | Pending |
| LC-02 | Server available | `ready()` resolves for both clients. | I | beta | Impl 3 | Partial |
| LC-03 | Naming, server unreachable | `ready()` rejects. | U | beta | Impl 3.1 | Pending |
| LC-04 | Config, server unreachable | `error` is emitted, `ready()` resolves, and the snapshot is served to `getConfig` and to a new listener. | U | beta | Impl 3.1 | Pending |
| LC-05 | `close()` twice | The second call has no effect. | U | beta | Impl 3 | Pending |
| LC-06 | Calls after `close()` | Requests reject and no listener is called. | U | beta | Impl 3 | Partial |
| LC-07 | Exit after `close()` | The process exits with no open handles. | P | beta | Runtime 7 | Pending |
| LC-08 | Deprecated option | It works, logs one warning, and the new name wins if both are set. | U | beta | Impl 4 | Pending |
| LC-09 | `namespace` not set | Requests use `public`. Cache paths use `default_tenant`. | U | beta | Impl 4 | Pending |

## Boundary

| ID | Scenario | Expected | Layer | Gate | Rule | Status |
| --- | --- | --- | --- | --- | --- | --- |
| BND-01 | Missing `dataId` or `group` | `NacosValidationError` before any request. | U | beta | Impl 6 | Pending |
| BND-02 | Neither `serverAddr` nor `endpoint` | The constructor throws. | U | beta | Impl 4 | Pending |
| BND-03 | Missing service name or instance address | `NacosValidationError` before any request. | U | beta | Impl 6 | Pending |
| BND-04 | Persistent instance in a batch call | `NacosValidationError`. | U | rc | Naming 2.2 | Pending |
| BND-05 | Unknown `transport` value | The constructor throws. | U | beta | Impl 3 | Pending |

## Errors

| ID | Scenario | Expected | Layer | Gate | Rule | Status |
| --- | --- | --- | --- | --- | --- | --- |
| ERR-01 | `publishSingle`, non-200 response | Rejects with `NacosServerError`. | U | beta | Impl 5.1 | Pending |
| ERR-02 | `remove`, non-200 response | Rejects with `NacosServerError`. | U | beta | Impl 5.1 | Pending |
| ERR-03 | `publishConfigCas` | Correct MD5 resolves `true` and the server content changes. Stale MD5 resolves `false` and the server content is unchanged. Any other failure rejects. | U, I | beta | Impl 5.1 | Partial |
| ERR-04 | Legacy config APIs on gRPC | Each rejects with `NacosUnsupportedError`. | U | beta | Impl 5.3 | Pending |
| ERR-05 | Failed response | Never becomes success, empty data, or a timeout. | U | beta | Impl 6 | Pending |
| ERR-06 | Background failure, no `error` listener | The process does not crash. | U | beta | Impl 6 | Pending |
| ERR-07 | Any error | Has a stable `code`, and keeps the cause. | U | beta | Impl 6 | Pending |
| ERR-08 | Server error fields | `resultCode` and `errorCode` are preserved. | U | beta | Impl 6 | Partial |

## Connection

| ID | Scenario | Expected | Layer | Gate | Rule | Status |
| --- | --- | --- | --- | --- | --- | --- |
| CON-01 | Handshake with negotiation | `RUNNING` only after `SetupAckRequest`. | U | beta | Runtime 3.1 | Pending |
| CON-02 | No `SetupAckRequest` in 5 seconds | The attempt is abandoned. | U | beta | Runtime 3.1 | Pending |
| CON-03 | Server without negotiation | Abilities are `UNKNOWN`, and setup completes. | U | beta | Runtime 4 | Pending |
| CON-04 | Client version | `Nacos-Node-Client:v<version>` is sent. | U | beta | Runtime 3.1 | Pending |
| CON-05 | Custom `contextPath` | Login uses it. | U | beta | Runtime 2 | Pending |
| CON-06 | Custom `grpcPortOffset` | The gRPC target uses it. | U | beta | Runtime 2 | Pending |
| CON-07 | `endpoint` refresh | A removed current server triggers reconnect. A failed refresh keeps the list. | U | beta | Runtime 2 | Pending |
| CON-08 | `endpoint` and `serverAddr` set | `endpoint` wins. | U | beta | Runtime 2 | Pending |
| CON-09 | Reconnect delay | Rotates servers, doubles to 60 seconds, and resets on success. | U | beta | Runtime 3.2 | Pending |
| CON-10 | `ConnectResetRequest` | It is acknowledged, and a listed target is tried first. | U | beta | Runtime 3.2 | Pending |
| CON-11 | Error `301` | Triggers reconnect, selects the next server, and retries the request within the budget. If it still fails, Naming intent remains. | U | beta | Runtime 3.2, 3.5 | Pending |
| CON-12 | Half-open connection | The health check fails and the client reconnects. | U | beta | Runtime 3.3 | Pending |
| CON-13 | Request during an outage | Waits until `requestTimeout`, then `NacosConnectionError`. | U | beta | Runtime 3.5 | Pending |
| CON-14 | Connection drops with a request in flight | The runtime makes its bounded attempts; if they are exhausted, the call rejects with `NACOS_CONNECTION_LOST` as a result-unknown failure. | U | beta | Runtime 3.5 | Pending |
| CON-15 | Naming registration times out | The runtime makes the bounded attempts, the call rejects as result unknown, and the latest Naming intent stays for redo. | U | beta | Runtime 3.5, Naming 2.3 | Pending |
| CON-16 | Reconnect resets abilities | No value carries over. | U | beta | Runtime 4 | Pending |
| CON-17 | Server restart | The original clients recover. | R | rc | Runtime 3.2 | Pending |
| CON-18 | TLS with a private CA and with a client certificate | A real `@grpc/grpc-js` TLS fixture accepts a trusted CA and a valid client certificate; an untrusted CA, a hostname mismatch, and a missing or wrong client certificate map to `NacosConnectionError` and clean up the connection. | U, I | rc | Runtime 6 | Pending |
| CON-19 | Config write replay policy | A publish/cas that fails with a connection failure or unknown result is retried within the budget. A CAS retry after an applied write may return `false`; this false negative is asserted as the documented Java-compatible boundary. | U | beta | Runtime 3.5, Impl 5.1 | Pending |
| CON-20 | Server `ErrorResponse` | The request is retried within the budget, then the call rejects with the server error. Attempt count and final error are asserted. | U | beta | Runtime 3.5 | Pending |
| CON-21 | Read retry | A Config query and a Naming query retry on a connection-class failure within the budget and succeed when a later attempt succeeds. | U | beta | Runtime 3.5 | Pending |
| CON-22 | `getServerStatus()` | Reports UP and DOWN during normal operation, an outage, and recovery, and follows the public contract after `close()`. Querying status does not create a connection. | U, R | rc | Impl 5.2 | Pending |

## Authentication

| ID | Scenario | Expected | Layer | Gate | Rule | Status |
| --- | --- | --- | --- | --- | --- | --- |
| AUTH-01 | Read-write identity | The functional suite passes. | I | beta | Runtime 5.1 | Partial |
| AUTH-02 | v3 login | The v3 path is used. | U | beta | Runtime 5.1 | Pending |
| AUTH-03 | v3 answers 404 or 501 | Falls back to v1. | U | beta | Runtime 5.1 | Pending |
| AUTH-04 | Wrong password | `ready()` rejects with `NacosAuthError`, and the client stops. | I | beta | Runtime 5.4 | Pending |
| AUTH-05 | Anonymous, auth on | Calls reject with `NacosAuthError`. | I | beta | Impl 6 | Pending |
| AUTH-06 | Identity with no permission | Rejects. Not a timeout, empty data, or snapshot. | I | beta | Impl 6 | Pending |
| AUTH-07 | Read-only identity | Reads pass and writes reject. | I | beta | Impl 6 | Pending |
| AUTH-08 | Auth off on the server | No token header. No refresh runs. | U | beta | Runtime 5.1 | Pending |
| AUTH-09 | Token refresh timing | Refreshes inside the window, with jitter. | U | beta | Runtime 5.2 | Pending |
| AUTH-10 | Short token TTL | Reads, writes, registration, and subscription keep working. | R | beta | Runtime 5.2 | Pending |
| AUTH-11 | Refresh, server unreachable | Keeps the token and retries. | U | beta | Runtime 5.2 | Pending |
| AUTH-12 | Refresh, credentials rejected | `error` is emitted, and later requests reject. | U | beta | Runtime 5.2 | Pending |
| AUTH-13 | 403 response | Marks refresh, at most once per 60 seconds. The request rejects. | U | beta | Runtime 5.2 | Pending |
| AUTH-14 | AK/SK over gRPC | Options match `aliyun_auth`, on Config and Naming. | U | beta | Runtime 5.3 | Pending |
| AUTH-15 | AK/SK on a real MSE instance | Works end to end. | I | ga | Runtime 5.3 | Documented gap |
| AUTH-16 | Secrets in logs and errors | Passwords, tokens, and keys do not appear. | U | beta | Impl 6 | Pending |
| AUTH-17 | Reconnect and redo | The same identity is kept, with no new client. | R | rc | Runtime 5 | Pending |

AUTH-15 needs an MSE account, which CI does not have. Maintainers have been asked to help at
rc. Without that, release notes must say that only signature vectors were tested.

## Wire Contract

| ID | Scenario | Expected | Layer | Gate | Rule | Status |
| --- | --- | --- | --- | --- | --- | --- |
| WIRE-01 | Request and response JSON | Matches vectors generated by Java. | W | beta | Test 2.2 | Pending |
| WIRE-02 | Fields that default to `false` or `true` | `healthy` and `enabled` survive the codec. | W | beta | Test 2.2 | Pending |
| WIRE-03 | Type registry | Every request and response in use is registered, including `PersistentInstanceRequest`, `BatchInstanceRequest`, and `NotifySubscriberResponse`. | W | beta | Runtime 3.1 | Pending |
| WIRE-04 | AK/SK signatures | Match fixed vectors. | W | beta | Runtime 5.3 | Pending |

## Config

| ID | Scenario | Expected | Layer | Gate | Rule | Status |
| --- | --- | --- | --- | --- | --- | --- |
| CFG-01 | Publish, then read | The content is returned. | I | beta | Impl 5.1 | Partial |
| CFG-02 | Remove, then read | Resolves `null`. | I | beta | Impl 5.1 | Partial |
| CFG-03 | Remove a missing config | Resolves `true`. | I | beta | Impl 5.1 | Pending |
| CFG-04 | Failover file exists | Wins over the server, and `localRead` is emitted. | U | rc | Config 4 | Partial |
| CFG-05 | Server query succeeds | The snapshot is updated. | U | rc | Config 4 | Partial |
| CFG-06 | Server confirms missing | Resolves `null`, and the snapshot is removed. | U | rc | Config 4 | Partial |
| CFG-07 | Query fails, snapshot present | The snapshot is served, and `localRead` is emitted. | U | rc | Config 4 | Partial |
| CFG-08 | Query fails, no snapshot | Rejects. | U | rc | Config 4 | Partial |
| CFG-09 | 401 or 403 with a snapshot present | Rejects, and the snapshot is not used. | U | rc | Config 4 | Pending |
| CFG-10 | Filter fails on read | Rejects, and no other source is tried. | U | rc | Config 4 | Pending |
| CFG-11 | Change push | Query, then deliver. | U, I | rc | Config 6 | Partial |
| CFG-12 | `changedConfigs` in a listen response | Each changed key is queried. | U | rc | Config 6 | Pending |
| CFG-13 | Overlapping queries, either order | Only the newest commits. | U | rc | Config 6 | Partial |
| CFG-14 | Periodic check and full sync | Run at 5 seconds and 3 minutes. | U | rc | Config 6 | Pending |
| CFG-15 | Entry using failover | Is not probed, and pushes are ignored. | U | rc | Config 6 | Partial |
| CFG-16 | Query fails during sync | The record is unchanged and the entry stays not consistent. | U | rc | Config 6 | Partial |
| CFG-17 | Server returns empty content, then is down after a restart | The empty string is served from the snapshot. | U | rc | Config 5 | Pending |
| CFG-18 | Config changes between `''` and missing | Each change is delivered, as `''` and `null`. | U | rc | Config 9.6 | Pending |
| CFG-19 | Authorization rejected, failover file present | The failover content is served. | U | rc | Config 4 | Pending |
| CFG-20 | `S -> F -> S`, server unchanged | Listener receives S, F, S. | U | rc | Config 12 | Pending |
| CFG-21 | `S -> F1 -> F2 -> S` | Listener receives S, F1, F2, S. | U | rc | Config 12 | Pending |
| CFG-22 | `F` has the same md5 as `S` | No extra callback, and no stale marker. | U | rc | Config 12 | Pending |
| CFG-23 | Failover removed, server down | `F` stays effective. Recovery follows when the server returns. | U | rc | Config 12 | Partial |
| CFG-24 | Server config deleted during failover | After failover ends, the listener receives `null`. | U | rc | Config 12 | Pending |
| CFG-25 | Filter fails, second listener joins, filter recovers | Both receive the value with no new publish. | U | rc | Config 12 | Pending |
| CFG-26 | Slow filter for A, newer B commits, either order | The listener receives B. | U | rc | Config 12 | Pending |
| CFG-27 | Failed A, newer B with another data key | A's retry is cancelled, and the listener ends on B. | U | rc | Config 12 | Pending |
| CFG-28 | Filter pending, failover appears | `F` is delivered at once. The late result does not replace it. | U | rc | Config 12 | Pending |
| CFG-29 | Remove one listener during a retry | The others still recover. | U | rc | Config 12 | Pending |
| CFG-30 | Remove the last listener, or `close()`, during a retry | Timers are cleared, and late results are silent. | U | rc | Config 12 | Partial |
| CFG-31 | Unsubscribe and subscribe during a filter call | The new subscription gets the value exactly once. | U | rc | Config 12 | Pending |
| CFG-32 | One listener throws | Others receive the value. The failed one stays due. | U | rc | Config 9.2 | Partial |
| CFG-35 | Two listeners, one rejects once, no new publish | The failed one receives the value on a retry. The other is not called again. | U | rc | Config 9.3 | Pending |
| CFG-36 | Same, with the filter failing first | Two cases. (a) The filter fails once and recovers; both callbacks succeed and each is invoked once. (b) The filter fails, then L1 rejects once and succeeds on retry; L1 is invoked twice and succeeds once, L2 is invoked once and succeeds once. Invocations and successful deliveries are counted separately. | U | rc | Config 9.3 | Pending |
| CFG-37 | Same, newer value before the retry | The failed listener receives only the newer value. | U | rc | Config 9.3 | Pending |
| CFG-38 | Same, config deleted before the retry | The failed listener receives `null`. | U | rc | Config 9.3 | Pending |
| CFG-39 | Same, failover appears before the retry | The failed listener receives `F`. | U | rc | Config 9.3 | Pending |
| CFG-33 | Disconnect, config changes, reconnect | The listener receives the change. | U, R | rc | Config 12 | Pending |
| CFG-34 | Snapshot write fails, then the server is down | The previous complete record is used. | U | rc | Config 12 | Pending |
| CFG-40 | Filter order | Ascending `order`, then order of addition. | U | rc | Config 8 | Pending |
| CFG-41 | Filter with a duplicate name | Ignored. | U | rc | Config 8 | Pending |
| CFG-42 | `onPublish` fails | The call rejects and nothing is sent. | U | rc | Config 8 | Pending |
| CFG-43 | `onResponse` for each source | Runs with the right `source`. | U | rc | Config 8 | Pending |
| CFG-44 | Transformed content | Never reaches a snapshot or the cache entry. | U | rc | Config 2 | Pending |
| CFG-45 | Several listeners, one version | The filter runs once per attempt. | U | rc | Config 9 | Pending |
| CFG-46 | `close()` with filters | Aborts running filters and calls `close` on each. | U | rc | Config 10 | Pending |
| CFG-47 | Non-retryable filter failure | No retry until `version` changes. | U | rc | Config 9.2 | Pending |
| CFG-48 | Retry delay | Starts at 1 second, caps at 60 seconds, and resets on a new `version`. | U | rc | Config 9.3 | Pending |
| CFG-49 | Listener busy, versions change | It receives only the latest when it finishes. | U | rc | Config 9.1 | Pending |
| CFG-50 | New listener, existing entry | Receives the current value without a new read. Others are undisturbed. | U | rc | Config 9.5 | Partial |
| CFG-51 | New listener, server confirms the config is missing | Receives `null` once, and no filter runs. A network failure with no snapshot is covered by CFG-64. | U | rc | Config 9.5 | Pending |
| CFG-52 | Config deleted | Listeners receive `null`. No filter runs. | U | rc | Config 9.6 | Pending |
| CFG-53 | Remote add and remove for one key | Reach the server in order. | U | rc | Config 10 | Partial |
| CFG-54 | Failed listener removed before the retry | It is not called again, and the other listener is unaffected. | U | rc | Config 9.3 | Pending |
| CFG-55 | `close()` before a listener retry | No callback. Timers are cleared. | U | rc | Config 10 | Pending |
| CFG-56 | Listener fails every time | Retried with a delay capped at 60 seconds. Other listeners are not called again. | U | rc | Config 9.3 | Pending |
| CFG-57 | Callback never settles, with a schedulable event loop | Not called again while the pending Promise is unsettled. One `NACOS_LISTENER_BLOCKED` error after 60 seconds. Others are unaffected. Synchronously blocking application code is not covered by this guarantee. | U | rc | Config 9.4 | Pending |
| CFG-58 | Callback settles after unsubscribe and subscribe again | Its outcome does not advance the new subscription. | U | rc | Config 9.4 | Pending |
| CFG-59 | Stub filter, records with and without `encryptedDataKey`, from each source | Each reaches the filter unchanged. The pipeline rejects none by itself. | U | rc | Config 11 | Pending |
| CFG-60 | Content and `encryptedDataKey` saved, then read from the snapshot | They come back as the same pair. | U | rc | Config 11 | Pending |
| CFG-61 | Stub filter fails asynchronously, from each source | No listener progress advances. | U | rc | Config 11 | Pending |
| CFG-62 | New listener, failover file exists | The failover content is effective, filters run, the listener receives it once, and `localRead` is emitted once. | U | rc | Config 9.5 | Pending |
| CFG-63 | New listener, network fails, snapshot present | The snapshot is effective, filters run, the listener receives it once, and `localRead` is emitted. After recovery the server value is committed and delivered when it differs. | U, R | rc | Config 9.5 | Pending |
| CFG-64 | New listener, network fails, no snapshot | The listener is not called and the failure goes to `error`. On connect or periodic sync the entry is queried directly; the first successful query delivers the first callback. | U, R | rc | Config 6, 9.5 | Pending |
| CFG-65 | New listener, 401 or 403, snapshot present | The snapshot is not used, the listener is not called, and the failure goes to `error`. | U | rc | Config 9.5 | Pending |
| CFG-66 | New listener, 401 or 403, failover present | The failover content is effective, filters run, and the listener receives it once. | U | rc | Config 9.5 | Pending |
| CFG-67 | New listener, server returns empty content | The listener receives `''` once, filters run, and it is distinct from `null`. | U | rc | Config 9.5 | Pending |
| CFG-68 | Stub filter `onPublish` for publish and CAS | The transformed content and optional metadata are what `publishSingle` and `publishConfigCas` send. The CAS comparison value is unchanged, and a filter failure sends no request. | U, I | rc | Config 8 | Pending |

## Encryption

These are plugin tests. The pipeline itself is tested with stub filters in CFG-59 to CFG-61.

| ID | Scenario | Expected | Layer | Gate | Rule | Status |
| --- | --- | --- | --- | --- | --- | --- |
| ENC-01 | Envelope `cipher-kms-aes-128-` and `cipher-kms-aes-256-` | Encrypts and decrypts with a data key. | U | kms | KMS 2 | Pending |
| ENC-02 | Direct `cipher-` | Decrypts with no data key. | U | kms | KMS 2 | Pending |
| ENC-03 | Envelope record without a data key | Fails as non-retryable. | U | kms | KMS 3 | Pending |
| ENC-04 | KMS outage | Fails as retryable, and recovers. | U | kms | KMS 3 | Pending |
| ENC-05 | Malformed data key or ciphertext | Fails as non-retryable. | U | kms | KMS 3 | Pending |
| ENC-06 | Publish, including CAS | Encrypts, and sets the data key in envelope mode. | U | kms | KMS 2 | Pending |
| ENC-07 | Data written by Java, Go, and Python | Decrypts, and the reverse. | W | kms | KMS 2 | Pending |
| ENC-08 | Failover record | Handled as the plugin spec decides. | U | kms | KMS 4 | Pending |
| ENC-09 | Not a `cipher-` record, or blank content | Passes through unchanged. | U | kms | KMS 1 | Pending |

## Naming

| ID | Scenario | Expected | Layer | Gate | Rule | Status |
| --- | --- | --- | --- | --- | --- | --- |
| NAM-01 | Register, then discover with default parameters | The instance is returned. | I | beta | Naming 1 | Pending |
| NAM-02 | Subscribe with default parameters | The listener receives the instance. | I | beta | Naming 1 | Pending |
| NAM-03 | `selectInstances`, `selectOneHealthyInstance` | Filter by health, enabled state, and weight. | U, I | beta | Naming 3 | Partial |
| NAM-04 | `subscribe: false` | Queries the server, and leaves the cache unchanged. | U | rc | Naming 3 | Pending |
| NAM-05 | Discovery fails, nothing cached | Rejects. | U | rc | Naming 3 | Pending |
| NAM-06 | Connection down, view cached | The cached view is served. | U | rc | Naming 3 | Pending |
| NAM-10 | Two instances of one service, one client | Both are visible. | I | rc | Naming 2.2 | Pending |
| NAM-11 | Deregister one of two | The other stays. | I | rc | Naming 2.2 | Pending |
| NAM-12 | Register the same `ip:port` again | Replaces that instance. | U | rc | Naming 2.2 | Pending |
| NAM-13 | `batchRegisterInstance` | Replaces the set. | I | rc | Naming 2.2 | Pending |
| NAM-14 | `batchDeregisterInstance` | Removes by `ip` and `port`, and keeps the rest. | I | rc | Naming 2.2 | Pending |
| NAM-15 | Concurrent calls for one service | Run in order, and the final set is correct. | U | rc | Naming 2.2 | Pending |
| NAM-16 | Persistent instance | The server shows `ephemeral=false`, and it survives `close()`. | I | rc | Naming 2.1 | Pending |
| NAM-17 | Persistent instance, ability absent | Goes over HTTP. | U | rc | Naming 2.1 | Pending |
| NAM-18 | Register rejected by the server | The call rejects, the latest intent stays, and redo retries later. | U | rc | Naming 2.3, 6.2 | Pending |
| NAM-19 | Register fails, connection down | The call rejects, the latest intent stays, and redo registers after reconnect. | U | rc | Naming 2.3 | Pending |
| NAM-20 | Deregister a missing instance | Succeeds. | I | rc | Naming 2.4 | Pending |
| NAM-21 | Deregister during an outage | The instance is gone after reconnect. | U, R | rc | Naming 2.4 | Pending |
| NAM-22 | Deregister an ephemeral instance | It is gone, and the record is removed. | I | rc | Naming 2.4 | Pending |
| NAM-23 | Deregister a persistent instance | Uses the persistent path, not `InstanceRequest`. | I | rc | Naming 2.4 | Pending |
| NAM-24 | Deregister a persistent instance, ability absent | Goes over HTTP. | U | rc | Naming 2.1 | Pending |
| NAM-25 | Deregister rejected by the server | The call rejects, the unregistered intent stays, and redo never re-registers the removed instance. | U | rc | Naming 2.4, 6.2 | Pending |
| NAM-26 | Deregister fails on a live connection, from a confirmed registration | The call rejects, redo retries until confirmed, and the eventual remote state is checked. | U | rc | Naming 2.4 | Pending |
| NAM-27 | Disconnect during deregistration | The instance is not registered again after reconnect. | U, R | rc | Naming 2.4 | Pending |
| NAM-28 | Remove one member after a batch, then reconnect | The others return, and the removed one does not. | U, R | rc | Naming 2.4 | Pending |
| NAM-29 | Persistent deregistration fails | The call rejects, and nothing is replayed. Bounded request retry does not introduce redo or reconnect replay. | U | rc | Naming 2.4 | Pending |
| NAM-33 | Register again during a pending removal | The instance stays registered. | U | rc | Naming 2.4 | Pending |
| NAM-30 | Invalid view, `hosts` missing | Ignored, with a success ACK. | U | rc | Naming 4.1 | Pending |
| NAM-31 | Cluster filter | Filters locally for reads and listeners. | U | rc | Naming 4 | Pending |
| NAM-32 | No polling on gRPC | No periodic query. | U | rc | Naming 4 | Pending |
| NAM-40 | Two listeners on one service | One server subscription. | U | rc | Naming 5 | Pending |
| NAM-41 | Last listener removed | One unsubscribe request. | U | rc | Naming 5 | Pending |
| NAM-42 | New listener | Receives the current view once, including an empty one. | U | rc | Naming 5 | Pending |
| NAM-43 | Other cluster changes | A filtered listener is not called. | U | rc | Naming 5 | Pending |
| NAM-44 | Listener throws | Others still run, the ACK is still sent, the cache is not rolled back, and there is no retry. | U | rc | Naming 5 | Pending |
| NAM-45 | After `unSubscribe` or `close()` | The listener is not called. | U | rc | Naming 5 | Pending |
| NAM-46 | Subscribe request fails | `error` is emitted, and redo retries. | U | rc | Naming 5 | Pending |
| NAM-50 | Reconnect with instances and subscriptions | All are restored. | U, R | rc | Naming 6 | Pending |
| NAM-51 | Late response from an old connection | The record stays unregistered, and redo runs. | U | rc | Naming 6.1 | Pending |
| NAM-52 | Redo fails once | Succeeds on a later run, and the timer keeps running. | U | rc | Naming 6.2 | Pending |
| NAM-53 | Disconnected | The redo task does nothing. | U | rc | Naming 6.2 | Pending |
| NAM-54 | Disconnect, instances change, reconnect | Listeners receive the change. | U, R | rc | Naming 6.2 | Pending |
| NAM-55 | Redo events | `redoPending` only if needed, then `redoRestored`. | U | rc | Naming 6.3 | Pending |
| NAM-56 | Persistent instance on reconnect | Not re-registered. | U | rc | Naming 6 | Pending |
| NAM-57 | `close()` during redo | Timers stop, and no late callback. | U | rc | Naming 7 | Pending |
| NAM-58 | `close()` | Sends no deregister request. | U | rc | Naming 7 | Pending |
| NAM-59 | Invalid local arguments | Rejected before any intent is recorded or request is sent. No redo record is created. | U | rc | Naming 2 | Pending |
| NAM-60 | Register fails, then connectivity or permissions recover | The call rejects, the intent stays, and redo registers the instance later. | U, R | rc | Naming 2.3, 6.2 | Pending |
| NAM-61 | Batch and ordering | Single → multiple → one → empty; a failed batch; deregister then register; late response from an old epoch. Both completion orders end at the latest intent and the correct members. | U | rc | Naming 2.3, 2.4, 2.2 | Pending |
| NAM-62 | `getAllInstances → subscribe(L) → unSubscribe(L) → getAllInstances` | Discovery subscribes, the listener reuses the subscription, the last removal unsubscribes but keeps the cache, and the final discovery re-establishes the subscription; a later service change reaches the listener again. | U, I | rc | Naming 3, 5 | Pending |
| NAM-63 | Resubscription fails | With a cached view the allowed view is returned; with no cache the call rejects. Both keep the recovery intent and see new data after recovery. | U, R | rc | Naming 3, 5 | Pending |
| NAM-64 | Multiple cluster-filtered listeners | One server subscription; removing one listener keeps the others subscribed and notified. | U | rc | Naming 5 | Pending |
| NAM-65 | `subscribe: false` | Queries the server without creating a lasting subscription and without disturbing an existing listener subscription. | U | rc | Naming 3 | Pending |
| NAM-66 | Normal valid push | The view is accepted, the cache is updated, notification is scheduled, and the outbound `NotifySubscriberResponse` is observed with its type, request ID, and result. Encoding is checked with a fixed vector. | U, W, I | rc | Naming 4.1, 5 | Pending |
| NAM-67 | Listener returns a pending Promise | The ACK is sent and the accepted cache is readable while the Promise is unsettled. Later settle or reject does not change or repeat that ACK. | U | rc | Naming 5 | Pending |
| NAM-68 | Listener throws or rejects | The ACK is sent, the failure goes to `error`, the accepted cache is not rolled back, and Config-style retry is not introduced. | U | rc | Naming 5 | Pending |
| NAM-69 | Duplicate push, malformed view, stale epoch, push after unsubscribe | Each case follows section 4.1; a decoded view gets a success ACK, and no removed listener starts a new callback. | U | rc | Naming 4.1, 5 | Pending |
| NAM-70 | Unsubscribe fails, resubscribe before the old unsubscribe completes, a late cleanup or redo response, `close()`, or unsubscribe during dispatch | Both completion orders; the latest intent wins, old work does not advance the new subscription, no removed listener starts a callback, and no write is required on an already closed stream. | U | rc | Naming 5 | Pending |
| NAM-72 | Registration may have applied without a confirmed response, then deregistration fails | The direct deregistration is attempted, and the documented Java-compatible state transitions occur. No stronger surviving-connection cleanup guarantee is asserted. | U | rc | Naming 2.4, 6.2 | Pending |
| NAM-71 | `selectOneHealthyInstance` boundaries | No eligible instance returns `null`; one eligible instance returns it; weighted selection uses controlled randomness at the weight boundaries. | U | beta | Impl 5.2 | Pending |

## Client Isolation

| ID | Scenario | Expected | Layer | Gate | Rule | Status |
| --- | --- | --- | --- | --- | --- | --- |
| ISO-01 | Two clients, two namespaces, one process | No data crosses. | I | beta | Arch 5 | Pending |
| ISO-02 | Two clients, two servers, one process | Each reaches its own server. | R | beta | Arch 5 | Pending |
| ISO-03 | Two processes, two servers | Each reaches its own server. | R | beta | Arch 5 | Pending |
| ISO-04 | Two identities, one process | Tokens are not shared. | I | beta | Arch 5 | Pending |
| ISO-05 | Closing one client | The other keeps working. | I | beta | Arch 5 | Pending |
| ISO-06 | Explicit `options.cluster` | Sharing stays, and the name includes address, namespace, and username. | U | beta | Arch 5 | Pending |

ISO-06 depends on the pending decision in the Architecture Spec.

## HTTP Regression

| ID | Scenario | Expected | Layer | Gate | Rule | Status |
| --- | --- | --- | --- | --- | --- | --- |
| HTTP-01 | Existing HTTP suite on 2.5.5 | Passes, with 2.x behavior. | I | beta | Impl 8 | Partial |
| HTTP-02 | Legacy config APIs on HTTP | Unchanged. | I | beta | Impl 5.3 | Partial |
| HTTP-03 | New API on HTTP | Rejects with `NacosUnsupportedError`. | U | rc | Impl 8 | Pending |

## Migration

These scenarios use released 2.6.3 as the baseline, not `master`.

| ID | Scenario | Expected | Layer | Gate | Rule | Status |
| --- | --- | --- | --- | --- | --- | --- |
| MIG-01 | 2.6.x usage with only the package changed | Config and naming work on the default transport. | I | rc | Impl 9.1 | Pending |
| MIG-02 | gRPC port not reachable | `ready()` fails as defined for each client. | I | rc | Impl 9.1 | Pending |
| MIG-03 | `transport: 'http'` | Writes, legacy APIs, and listeners behave as in 2.6.3. | I | rc | Impl 9.1 | Pending |
| MIG-04 | Snapshot written by 2.6.3 | 3.0 reads it, including an empty file. | U | rc | Config 5 | Pending |
| MIG-05 | `publishSingle`, `remove` on gRPC | `true` on success and rejection on failure, as in 2.6.3. | U | rc | Impl 9.1 | Pending |
| MIG-06 | First delivery and deletion on gRPC | Match 2.6.3: the current value at once, and `null` on deletion. | U | rc | Impl 9.1 | Pending |
| MIG-07 | Several instances of one service on gRPC | Both stay, as in 2.6.3 over HTTP. | I | rc | Impl 9.1 | Pending |

## Packaging

| ID | Scenario | Expected | Layer | Gate | Rule | Status |
| --- | --- | --- | --- | --- | --- | --- |
| PKG-01 | `require` and `import` of each entry point | Load and export the public classes. | P | beta | Impl 2 | Pending |
| PKG-02 | Types with `moduleResolution` `node` and `node16` | Compile. | P | beta | Impl 2 | Pending |
| PKG-03 | Internal paths | Not reachable through `exports`. | P | beta | Arch 3 | Pending |
| PKG-04 | Install from the tarball, no workspace | No missing file or dependency. | P | beta | Impl 2 | Pending |
| PKG-05 | Node.js outside the declared range | The declared `engines` range covers the supported versions, and an `engine-strict` fixture rejects installing on an older Node. Default-install behavior is unchanged. | P | beta | Impl 2 | Pending |
| PKG-06 | `@nacos-group/sdk-proto` | Is a regular pinned dependency, and a missing codec fails at load. | P | beta | Impl 2 | Pending |
| PKG-07 | Bridges `nacos`, `nacos-naming`, `nacos-config` | Re-export `@nacos-group/client`. | P | rc | Impl 2 | Pending |
| PKG-08 | No encryption plugin installed | The client loads and the pipeline works. | P | rc | Config 11 | Pending |
