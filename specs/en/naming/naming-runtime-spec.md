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
`NacosValidationError`.

Requests for one service run in a per-service queue, because each batch carries the
complete set.

### 2.3 Registration Failure

Every non-200 response is a server rejection and rejects the call. No response turns into a
returned value.

| Result of the request | Desired set |
| --- | --- |
| Success | Kept, and marked registered. |
| Server rejected | Restored to its previous value. The call rejects. |
| Connection unavailable or result unknown | Kept. The call rejects, and redo repairs it. |

If the server rejected the request, a retry cannot help, and the caller was told it
failed. Java keeps its redo data in this case, so a rejected instance can appear later.
Node.js does not.

When the connection failed, the caller still sees a rejection, and the instance may
appear once redo runs. To stop that, the caller calls `deregisterInstance`.

### 2.4 Deregistration

The request follows the route in section 2.1. A non-200 response rejects the call.
Deregistering an instance that is not registered succeeds, following the
[lifecycle spec](https://github.com/alibaba/nacos/blob/3.3.0/specs/en/naming/naming-instance-lifecycle-spec.md#4-deregistration).

**Ephemeral instances.** The instance leaves the desired set when the call starts, but the
redo record stays until the server confirms. Removing one instance of a batch sends the
complete remaining set, as in section 2.2, so the others are not lost.

| Result of the request | Effect |
| --- | --- |
| Success | Confirmed. The record is removed if the set is now empty. |
| Server rejected | The call rejects. The instance returns to the desired set, because the server still holds it. Redo does not retry. |
| Connection unavailable or result unknown | The call rejects. The instance stays out of the desired set, and redo converges. |

A requested deregistration must never become a registration. After a reconnect, the server has
already dropped the publications of the old connection. Redo then sends only what remains in
the desired set, or removes the record if nothing remains.

Registering the same instance again while its removal is pending puts it back in the desired
set. The per-service queue keeps the two calls in order.

`master` removes its local record before the request, and resolves on a non-200 response.

**Persistent instances.** There is no redo record, because the server owns the state. Any
failure rejects the call and the caller decides what to do. Nothing is retried or replayed, and
a persistent instance is never sent as an ephemeral registration.

## 3. Discovery

| Call | Behavior |
| --- | --- |
| `subscribe` is `true` (default) | Returns the cached view. With no subscription yet, it subscribes first, and that subscription stays active until `close()`. |
| `subscribe` is `false` | Queries the server. The result does not change the cache. |

These are the same paths as Java `NacosNamingService#getServiceInfo`.

A cached view is served while the connection is down. If there is no cached view and the
query or subscription fails, the call rejects. It does not resolve to an empty list. An
empty list means that the server reported no instances.

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

## 5. Subscription

The SDK holds one server subscription per grouped service, however many listeners exist.
Listeners are local, and are keyed by service and clusters. Removing the last listener of
a service sends the unsubscribe request.

`subscribe` stays synchronous and returns nothing. If the server request fails, the
failure goes to the `error` event, and redo keeps trying.

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

`registered` means that the current connection holds this publication or subscription. `dirty`
means that the desired set differs from what the server last confirmed.

| Event | Effect |
| --- | --- |
| `disconnected` signal | Marks every record `registered: false`, and emits `redoPending`. |
| Desired set changes | Sets `dirty: true`. |
| Success response | Sets `registered: true` and `dirty: false`, only if the `epoch` is the one captured before sending. |

The `epoch` check stops a late response from an earlier connection from marking a record as
restored. Java added this for the same race.

### 6.2 Task

A timer runs every 3 seconds, and does nothing while disconnected. Each instance record is
reconciled as follows, using the requests in section 2.2.

| Desired set | `registered` | `dirty` | Action |
| --- | --- | --- | --- |
| Not empty | No | Any | Send the complete set. |
| Not empty | Yes | Yes | Send the complete set. |
| Not empty | Yes | No | Nothing. |
| Empty | Yes | Any | Send the removal. |
| Empty | No | Any | Remove the record. The closed connection already removed the publication. |

The last two rows match `RedoType.UNREGISTER` and `RedoType.REMOVE` in Java `RedoData`.

| Subscription wanted | `registered` | Action |
| --- | --- | --- |
| Yes | No | Subscribe. |
| Yes | Yes | Nothing. |
| No | Yes | Unsubscribe. |
| No | No | Remove the record. |

A failed redo logs, goes to the `error` event, and is retried on the next run. It never stops
the timer. Records run through the per-service queue, so redo cannot interleave with a call
from the application.

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
| Register rejected by the server | The call rejects, and redo does not retry. | 2.3 |
| Register fails, connection down | The call rejects, and redo registers it after reconnect. | 2.3 |
| Deregister during an outage | The instance is gone after reconnect. | 2.4, 6.2 |
| Deregister an ephemeral instance | It is gone, and the record is removed. | 2.4 |
| Deregister a persistent instance | Uses the persistent path, not `InstanceRequest`. | 2.1, 2.4 |
| Deregister a persistent instance, ability absent | Goes over HTTP. | 2.1 |
| Deregister rejected by the server | The call rejects, the instance stays in the desired set, and redo does not retry. | 2.4 |
| Deregister fails on a live connection | The call rejects, and redo retries until confirmed. | 2.4, 6.2 |
| Disconnect during deregistration | The instance is not registered again after reconnect. | 2.4, 6.2 |
| Remove one member after a batch, then reconnect | The others return, and the removed one does not. | 2.4, 6.2 |
| Persistent deregistration fails | The call rejects, and nothing is replayed. | 2.4 |
| Register again during a pending removal | The instance stays registered. | 2.4 |
| Late response from an old connection | The record stays unregistered, and redo runs. | 6.1 |
| Redo fails once | It succeeds on a later run. | 6.2 |
| Disconnect, instances change, reconnect | Listeners receive the change. | 6.2 |
| Two listeners on one service | One server subscription. | 5 |
| Last listener removed | One unsubscribe request. | 5 |
| Discovery fails with nothing cached | The call rejects. | 3 |
| Listener with a cluster filter, other cluster changes | The listener is not called. | 4, 5 |
| Listener throws | Others still run. | 5 |
| `close()` during redo | Timers stop. No late callback. | 7 |
