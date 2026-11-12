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

# Nacos Node.js SDK Naming Runtime Spec

This document defines registration, discovery, subscription, and redo for the Node.js
SDK 3.x on the gRPC transport. HTTP is frozen and keeps its 2.6.x behavior.

Shared semantics come from these specs, which this document does not repeat:

- [Naming Instance Lifecycle Spec](https://github.com/alibaba/nacos/blob/3.3.0/specs/en/naming/naming-instance-lifecycle-spec.md)
- [Naming Discovery And Subscription Spec](https://github.com/alibaba/nacos/blob/3.3.0/specs/en/naming/naming-discovery-subscription-spec.md)
- [Client Local Cache And Redo Spec](https://github.com/alibaba/nacos/blob/3.3.0/specs/en/client/client-local-cache-redo-spec.md)

The reference implementation is Java `NamingClientProxyDelegate`,
`NamingGrpcClientProxy`, `NamingGrpcRedoService`, and `ServiceInfoHolder`.

## 1. Service Identity

Inside the SDK, a service is always identified by its grouped name,
`<groupName>@@<serviceName>`, in the bound namespace. `groupName` defaults to
`DEFAULT_GROUP`.

The server returns `name` and `groupName` separately. Every response and push is
normalized to the grouped name before it reaches the cache.

`master` caches a gRPC response under `svc` and reads it under `DEFAULT_GROUP@@svc`.
That is why discovery with default parameters returns nothing.

## 2. Registration

Local validation runs before any intent is recorded. A rejected argument creates no redo
record and sends no request.

### 2.1 Routing

The `ephemeral` flag of the instance selects the route, for registration and deregistration
alike. This is `NamingClientProxyDelegate#getExecuteClientProxy`.

| Instance | Request | Redo |
| --- | --- | --- |
| Ephemeral | `InstanceRequest` or `BatchInstanceRequest` | Yes |
| Persistent, server reports `SERVER_PERSISTENT_INSTANCE_BY_GRPC` | `PersistentInstanceRequest` | No |
| Persistent, any other ability status | HTTP, as in `NamingClientProxyDelegate` | No |

`ephemeral` defaults to `true`. Persistent state belongs to the server, so the SDK does
not restore it. An ability status other than `SUPPORTED` means HTTP, including `UNKNOWN`.

`master` sends `InstanceRequest` for every instance, so a persistent instance is
registered as ephemeral, and deregistered the same way.

### 2.2 Several Instances Per Service

One gRPC connection holds one publication per service on the server. A second
`InstanceRequest` for the same service replaces the first.

The SDK keeps a desired set of instances per grouped service, keyed by `ip:port`:

| Desired set | Request |
| --- | --- |
| One instance, never batched | `InstanceRequest` |
| Two or more instances | `BatchInstanceRequest` with the complete set |
| Previously batched, any size | `BatchInstanceRequest` with the complete remaining set |
| Last instance removed, never batched | `InstanceRequest` of type `deregisterInstance` |

So `registerInstance` for a second instance adds to the set. Registering the same
`ip:port` again replaces that instance.

This differs from Java, where a second `registerInstance` replaces the first, and
`batchRegisterInstance` is the only way to hold several. Node.js adds to the set
because 2.6.x over HTTP keeps both instances, and silently losing one on upgrade would be
a regression.

`batchRegisterInstance` replaces the desired set with the instances it receives, as in
Java. `batchDeregisterInstance` removes the given instances by `ip` and `port`, and sends
the rest. Both accept ephemeral instances only, and reject others with
`NacosValidationError`. Java's `batchRegisterService` has no ephemeral filter and writes a
redo record even for a persistent instance; Node.js does not copy that, and documents the
validation instead.

Requests for one service run in a per-service queue, because each batch carries the
complete set.

### 2.3 Registration Failure

An ephemeral registration records its intent before sending the request. A successful
response marks the intent registered. A failed call rejects the caller, and the intent stays
as the latest desired state; it is not rolled back to the previous one.

| Result of the request | Intent |
| --- | --- |
| Success | Kept, and marked registered. |
| Server rejected | Kept as the latest intent. The call rejects. Redo applies it later. |
| Connection unavailable or result unknown | Kept as the latest intent. The call rejects. Redo applies it later. |

A server rejection, a connection failure, and an unknown result follow the same rule: the
caller sees the failure, and retaining the intent never turns that failed call into a
success. This matches `NamingGrpcClientProxy#registerInstance`, which calls
`cacheInstanceForRedo` before sending and leaves the record unregistered when the request
fails.

The runtime retries the request within its own budget, as defined by
[Runtime Requests](../client/nodejs-runtime-spec.md#35-requests). Those foreground attempts
are separate from background redo. They share the same intent: after the call returns, redo
still owns the outcome.

An ephemeral registration that failed can become effective later through redo, for example
after connectivity or permissions recover. To cancel it, the caller calls
`deregisterInstance`. `close()` releases the connection-scoped state, including the intent.

Java behaves the same way. A rejected instance can therefore appear later in both SDKs,
which is why callers cancel the intent explicitly rather than relying on a rollback.

### 2.4 Deregistration

The request follows the route in section 2.1. A non-200 response rejects the call.
Deregistering an instance that is not registered succeeds, following the
[lifecycle spec](https://github.com/alibaba/nacos/blob/3.3.0/specs/en/naming/naming-instance-lifecycle-spec.md#4-deregistration).

**Ephemeral instances.** The instance leaves the desired set when the call starts, and its
record is marked unregistered before the request is sent. Removing one instance of a batch
sends the complete remaining set, as in section 2.2, so the others are not lost.

| Result of the request | Effect |
| --- | --- |
| Success | Confirmed. The record is removed if the set is now empty. |
| Server rejected | The call rejects. The unregistered intent stays. Redo converges and never re-registers the removed instance. |
| Connection unavailable or result unknown | The call rejects. The unregistered intent stays. Redo converges. |

The application-initiated deregistration always attempts the real request, even when the
record has never been confirmed registered (`registered` is false). `registered=false` alone
does not prove that the server holds no publication; it can also mean that an earlier
registration response was never confirmed. This is the same boundary as
`RedoData#getRedoType`, and it does not require a stronger result-unknown protocol.

A requested deregistration must never become a registration. After a reconnect, the server has
already dropped the publications of the old connection. Redo then sends only what remains in
the desired set, or removes the record if nothing remains.

Registering the same instance again while its removal is pending puts it back in the desired
set. This is the `registered=false`, unregistering, desired registered case in section 6.1,
which redo treats as `REGISTER`. The per-service queue keeps the two calls in order.

A removal record that is cleared by redo (`RedoType.REMOVE`) only discards local state. It is
not evidence that the server-side publication is gone.

`master` removes its local record before the request, and resolves on a non-200 response.

**Persistent instances.** There is no redo record, because the server owns the state. Any
failure rejects the call and the caller decides what to do. Nothing is retried or replayed, and
a persistent instance is never sent as an ephemeral registration.

## 3. Discovery

A cached view and an active subscription are separate facts.

| Call | Behavior |
| --- | --- |
| `subscribe` is `true` (default) | Returns the cached view when one exists. If the service is not subscribed, it subscribes first, even when a cached view exists, then returns the result. If the subscription fails and a cached view exists, it returns that view; with no cached view, it rejects. |
| `subscribe` is `false` | Queries the server. The result does not change the cache, and no lasting subscription is created. An existing subscription is not disturbed. |

These follow `NacosNamingService#getServiceInfo` and `tryToSubscribe`.

A cached view is served while the connection is down. If there is no cached view and the
query or subscription fails, the call rejects. It does not resolve to an empty list. An
empty list means that the server reported no instances.

Java checks a Naming failover directory before the cache. 3.0 does not implement Naming
failover, so this step is absent; see section 4.

`selectInstances` and `selectOneHealthyInstance` filter locally, as defined by
[SDK Selection](https://github.com/alibaba/nacos/blob/3.3.0/specs/en/naming/naming-discovery-subscription-spec.md#5-sdk-selection).

## 4. Service Cache

The cache holds one `ServiceInfo` per grouped service, with all clusters. Clusters are
filtered locally, for reads and for listeners, as in Java, where subscriptions carry no
cluster filter.

`master` keys the cache by cluster as well.

A view from a subscribe response or a push goes through one path:

1. Normalize the identity.
2. If `hosts` is missing, ignore the view.
3. Replace the cached view.
4. Compute the difference from the previous view.
5. If it changed, notify listeners.

On gRPC there is no polling, because Java leaves it off by default. Subscribe, push, and
redo keep the view current. `master` polls.

Disk cache, local failover, and push-empty protection are not planned for 3.0.

### 4.1 Push Acceptance

A push is accepted only when it arrives on the current connection and the service is still
subscribed.

| Case | Cache | Listeners | ACK |
| --- | --- | --- | --- |
| Valid push, filtered hosts changed | Replaced | Notified | Sent |
| Valid push, filtered hosts unchanged | Replaced, no change | Not notified | Sent |
| View without `hosts` | Unchanged | Not notified | Sent |
| Duplicate view | Unchanged | Not notified | Sent |
| Push from an earlier connection epoch | Unchanged | Not notified | Sent if the stream is writable |
| Push after unsubscribe or `close()` | Unchanged | No new callback | Sent if the stream is writable |
| View that cannot be decoded | Unchanged | Not notified | Error response, not an ACK |

`lastRefTime` is not used to reject a view, matching Java 3.3.0 `ServiceInfoHolder`. A view
older than the cached one may be logged, but it still replaces the cache when `hosts` is
present.

A stale subscription generation is handled like a stale connection epoch: an asynchronous
push that arrives after its subscription was replaced updates nothing and does not advance
the new subscription.

## 5. Subscription

The SDK holds one server subscription per grouped service, however many listeners exist.
The server subscription covers all clusters (`cluster = NULL`); cluster filters are local,
as in Java. Listeners are keyed by service and clusters. Removing the last listener of a
service sends the unsubscribe request and keeps the cached view.

Cache and subscription are separate facts. Removing the last listener does not discard the
cache, and a later discovery with `subscribe=true` checks the subscription state even when
a cached view exists and subscribes again when needed. If that resubscription fails,
discovery may return the cached view; with no cached view it propagates the failure. Both
cases keep the recovery intent.

`subscribe` stays synchronous and returns nothing. If the server request fails, the
failure goes to the `error` event, and redo keeps trying.

**Push acknowledgement.** A `NotifySubscriberResponse` acknowledges SDK protocol handling,
not completion of application work. The order is:

1. Decode and validate the push against the connection and subscription lifecycle.
2. Accept or ignore the view as defined in section 4.1.
3. Update the cache and schedule notification when applicable.
4. Send the matching response.

Notification runs independently of the response. The response never waits for a listener's
`Promise`, and a listener that throws or rejects goes to `error` without rolling back the
accepted view, turning the push into a receive failure, or being retried the way Config
retries a failed listener. A decoded view that is ignored or duplicated is still
acknowledged with a success response; only a view that cannot be decoded gets an error
response.

**Delivery.**

- A new listener receives the current view once, including an empty one, as in 2.6.x. Java
  only calls a listener on a change.
- A later change calls each listener whose view, after cluster filtering, changed.
- A listener that throws goes to `error`, and does not affect other listeners. It is not
  retried. This matches Java, where `NamingListenerInvoker` keeps no completion state and
  `DefaultPublisher` only logs the exception. Java also stops calling the remaining listeners
  of that event, which Node.js does not.
- After `unSubscribe` or `close()`, the listener is not called.

## 6. Redo

Redo restores runtime intent after reconnect, following the
[Redo Model](https://github.com/alibaba/nacos/blob/3.3.0/specs/en/client/client-local-cache-redo-spec.md#6-redo-model).
It covers ephemeral instances and subscriptions.

### 6.1 State

Each grouped service has two independent redo records.

| Record | Holds |
| --- | --- |
| Instances | The desired set, `registered`, and `dirty`. |
| Subscription | Whether it is wanted, and `registered`. |

`registered` means that a success response confirmed this publication or subscription on the
current connection. `registered=false` can also mean that no response was ever confirmed.
`dirty` means that the desired set differs from what the server last confirmed.

| Event | Effect |
| --- | --- |
| `disconnected` signal | Marks every record `registered: false`, and emits `redoPending`. |
| Desired set changes | Sets `dirty: true`. |
| Success response | Sets `registered: true` and `dirty: false`, only if the `epoch` is the one captured before sending. |

The `epoch` check stops a late response from an earlier connection from marking a record as
restored. Java added this for the same race.

A failed foreground call does not clear or roll back the record. The record keeps the latest
intent, and the redo task owns the next attempt.

### 6.2 Task

A timer runs every 3 seconds, and does nothing while disconnected. Each instance record is
reconciled as follows, using the requests in section 2.2.

| Desired set | `registered` | `dirty` | Action |
| --- | --- | --- | --- |
| Not empty | No | Any | Send the complete set. |
| Not empty | Yes | Yes | Send the complete set. |
| Not empty | Yes | No | Nothing. |
| Empty | Yes | Any | Send the removal. |
| Empty | No | Any | Remove the local record. This is not proof that the server holds no publication. |

This table is the equivalent of `RedoData#getRedoType`. With `expectedRegistered` true when
the desired set is not empty:

| Node.js state | Java `RedoType` |
| --- | --- |
| Not empty, not registered | `REGISTER` |
| Not empty, registered, dirty | `REGISTER` |
| Not empty, registered, clean | `NONE` |
| Empty, registered | `UNREGISTER` |
| Empty, not registered | `REMOVE` |

`registered=false` with a non-empty desired set is `REGISTER` even when a deregistration was
in progress. That is the `registered=false`, `unregistering=true`, `expectedRegistered=true`
row in Java.

The `Empty / No` row is Java's `REMOVE`. It discards local state only. `registered=false` does
not prove that the server holds no publication: it can also mean that no registration
response was ever confirmed. The application-initiated deregistration always sends the real
request (section 2.4), so the direct path still attempts the cancellation.

| Subscription wanted | `registered` | Action |
| --- | --- | --- |
| Yes | No | Subscribe. |
| Yes | Yes | Nothing. |
| No | Yes | Unsubscribe. |
| No | No | Remove the record. |

A failed redo logs, goes to the `error` event, and is retried on the next run. There is no
attempt limit; a record is removed only by `REMOVE` or `close()`. It never stops the timer.
Foreground request retries (Runtime 3.5) and redo are separate: foreground attempts happen
inside the call, and redo runs on the timer. Records run through the per-service queue, so
redo cannot interleave with a call from the application.

After a redo subscribe, the response goes through the cache path in section 4, so changes
missed during the outage reach listeners.

When no record is left to restore, the client emits `redoRestored`.

`master` tries once from the reconnect callback, and logs a failure.

### 6.3 Events

```ts
client.on('redoPending', (info: { instances: number; subscriptions: number }) => {});
client.on('redoRestored', () => {});
```

`redoPending` is emitted only if there is something to restore.

## 7. Close

`close()` stops the redo timer, removes all listeners, and closes the connection. It sends
no deregister requests: the server removes ephemeral instances when the connection closes.
This also ends any pending removal.

## 8. Required Behavior

The Test Design Spec turns these into scenarios.

| Case | Expected result | Rule |
| --- | --- | --- |
| Register, then discover with default parameters | The instance is returned. | 1 |
| Subscribe with default parameters | The listener receives the instance. | 1, 5 |
| Two instances of one service from one client | Both are visible. | 2.2 |
| Deregister one of two | The other stays. | 2.2 |
| Reconnect with two instances | Both are visible again. | 6 |
| Persistent instance | The server shows `ephemeral=false`. It survives `close()`. | 2.1 |
| Persistent instance, ability absent | Goes over HTTP. | 2.1 |
| Invalid arguments | No intent is recorded and no request is sent. | 2 |
| Register rejected by the server | The call rejects, the latest intent stays, and redo retries later. | 2.3, 6.2 |
| Register fails, connection down | The call rejects, and redo registers it after reconnect. | 2.3 |
| Foreground retry after `301` | The call retries within the request budget. If it still fails, the intent stays. | Runtime 3.2, 3.5; 2.3 |
| Deregister during an outage | The instance is gone after reconnect. | 2.4, 6.2 |
| Deregister an ephemeral instance | It is gone, and the record is removed. | 2.4 |
| Deregister a persistent instance | Uses the persistent path, not `InstanceRequest`. | 2.1, 2.4 |
| Deregister a persistent instance, ability absent | Goes over HTTP. | 2.1 |
| Deregister rejected by the server | The call rejects, the unregistered intent stays, and redo never re-registers it. | 2.4, 6.2 |
| Deregister fails on a live connection, from a confirmed registration | The call rejects, and redo retries until confirmed. | 2.4, 6.2 |
| Result unknown, then deregistration fails | Direct deregistration is attempted, and the documented Java-compatible transition applies. | 2.4, 6.2 |
| Disconnect during deregistration | The instance is not registered again after reconnect. | 2.4, 6.2 |
| Remove one member after a batch, then reconnect | The others return, and the removed one does not. | 2.4, 6.2 |
| Persistent deregistration fails | The call rejects, and nothing is replayed. | 2.4 |
| Register again during a pending removal | The instance stays registered. | 2.4 |
| Late response from an old connection | The record stays unregistered, and redo runs. | 6.1 |
| Redo fails once | It succeeds on a later run. | 6.2 |
| Disconnect, instances change, reconnect | Listeners receive the change. | 6.2 |
| Two listeners on one service | One server subscription. | 5 |
| Last listener removed | One unsubscribe request, and the cache stays. | 3, 5 |
| Discovery with a cache but no subscription | It subscribes again, and later changes reach listeners. | 3, 5 |
| Resubscription fails with a cache | The cached view is returned, and recovery keeps trying. | 3, 5 |
| Resubscription fails with no cache | The call rejects. | 3, 5 |
| Two cluster filters on one service | One server subscription; removing one listener keeps the other. | 5 |
| Discovery fails with nothing cached | The call rejects. | 3 |
| Listener with a cluster filter, other cluster changes | The listener is not called. | 4, 5 |
| Listener throws | Others still run. | 5 |
| Push with a listener that never settles | The ACK is sent, and the accepted cache is readable. | 5 |
| Ignored or duplicate push | A success ACK is sent, and no callback runs. | 4.1, 5 |
| Push after unsubscribe | A success ACK is sent, and the removed listener is not called. | 4.1, 5 |
| `close()` during redo | Timers stop. No late callback. | 7 |
