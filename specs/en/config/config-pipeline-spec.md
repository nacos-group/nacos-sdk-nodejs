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

# Nacos Node.js SDK Config Pipeline Spec

This document defines how the Node.js SDK 3.x moves config from the server to the
application. It is the contract for the Config refactor in
[#162](https://github.com/nacos-group/nacos-sdk-nodejs/issues/162) and for KMS
support in [#157](https://github.com/nacos-group/nacos-sdk-nodejs/pull/157).

Shared semantics come from these specs, which this document does not repeat:

- [Client Local Cache And Redo Spec](https://github.com/alibaba/nacos/blob/3.3.0/specs/en/client/client-local-cache-redo-spec.md)
- [Config Listener And Watch Spec](https://github.com/alibaba/nacos/blob/3.3.0/specs/en/config/config-listener-watch-spec.md)
- [Runtime Push And Reconnect Spec](https://github.com/alibaba/nacos/blob/3.3.0/specs/en/client/runtime-push-reconnect-spec.md)

The reference implementation is Java `ClientWorker`, `CacheData`, and
`ConfigFilterChainManager`.

## 1. Scope

This spec covers exact config reads and listeners on the gRPC transport. It does
not cover fuzzy watch, or KMS internals such as key caching and credentials.

## 2. Pipeline Boundaries

```text
Server ──> Fetch ──> Cache ──> Transform ──> Deliver ──> Application
Failover file ─────────┘
```

| Stage | Owns | Must not |
| --- | --- | --- |
| Fetch | Server queries, change pushes, listen requests, and probes. | Run filters, or call listeners. |
| Cache | The current raw record per key, its source, and the snapshot and failover files. | Hold transformed content. |
| Transform | Running the filter chain on a raw record. | Change cache state, or decide what to retry. |
| Deliver | Per-listener progress, retries, and callbacks. | Query the server, or change the raw record. |

Two rules hold across the stages:

- **Everything before Transform uses raw content.** For an encrypted config, raw
  content is the ciphertext and its `encryptedDataKey`. Listen md5 values, snapshot
  files, and change detection all use raw content.
- **Transformed content is never stored.** It exists only while one read or one
  delivery attempt runs. It is not written to disk or kept on the cache entry.

## 3. State Per Key

One `CacheEntry` exists per subscribed `dataId`, `group`, and namespace. Its object
identity is the subscription lifetime: removing the last listener discards the
entry, and a later subscribe creates a new one.

Three kinds of state stay separate, because they answer different questions.

| State | Fields | Question it answers |
| --- | --- | --- |
| Effective record | `content`, `encryptedDataKey`, `md5`, `type`, `source` | What should the application see now? |
| Server sync | `consistentWithServer` | Do we still need to check the server? |
| Delivery progress | One `deliveredMd5` per listener | Has this listener seen the effective record? |

`source` is `server`, `snapshot`, or `failover`.

`content` is `null` when the server confirmed that the config is missing. An empty string is
valid content, and it is not the same as `null`. The md5 of `null` is the empty string, as in
`CacheData#getMd5String`. Before the first commit the record is unknown, and has no `md5`.

Every commit to the effective record increments the entry's `version`. `version` is
not a delivery marker. It only lets asynchronous work detect that it is out of date.

### 3.1 Delivery Rule

A listener is **due** when the effective record is known and the listener's `deliveredMd5`
differs from the effective `md5`.

This is the `CacheData#checkListenerMd5` rule, and it is the only check that
decides whether to call a listener. Every path that changes the effective record
uses it: server updates, failover entry, change, and exit, and retries. No path
calls a listener directly.

This rule gives the correct result for `S -> F -> S` with unchanged server content.
After `F` is delivered, `deliveredMd5` identifies `F`, so a return to `S` is due.

An md5 delivered earlier is never proof of what the application currently holds.
Only the per-listener value is.

## 4. Read Path

`getConfig` follows the order in
[Config Local Recovery](https://github.com/alibaba/nacos/blob/3.3.0/specs/en/client/client-local-cache-redo-spec.md#2-config-local-recovery):

1. If a failover file exists, use it, and emit `localRead`.
2. Otherwise query the server. A successful response updates the snapshot, including when
   the content is empty. A confirmed missing config removes the snapshot and resolves to
   `null`.
3. If the query fails, use the snapshot, and emit `localRead`.

The selected record then goes through Transform before it is returned. If a filter
fails, `getConfig` rejects. It does not try the next source.

| Query failure | Result |
| --- | --- |
| `NacosAuthError` | Rejects. The snapshot is not used, so an old value cannot hide a rejection. |
| Any other failure, snapshot present | Resolves with the snapshot. |
| Any other failure, no snapshot | Rejects with the query failure. |

A failover file is a separate path that never reaches the query. A user who maintains one
still gets it when authorization would be rejected.

Differences from Java:

- Java skips the snapshot only for 403. Node.js also skips it for 401, because stale
  config must not hide wrong credentials.
- Java resolves `null` when the query fails and no snapshot exists. Node.js rejects,
  because `null` means the server confirmed the config is missing.

## 5. Snapshot And Failover

- Only a successful server query writes a snapshot. Failover content never does.
- A snapshot record is the content and its `encryptedDataKey`, as received.
- Empty content is a valid snapshot, and survives an outage and a restart. Only a confirmed
  missing config removes a snapshot, as in `LocalConfigInfoProcessor#saveSnapshot`.
- A reader must never pair content with the `encryptedDataKey` of another version.
  If an update fails partway, the previous complete record stays usable.
- A failed snapshot write goes to the `error` event. It does not fail the read.
- The file layout stays compatible with 2.6.x, so existing snapshot and failover files
  remain valid. 2.6.x wrote an empty file for a missing config, so such a file reads as
  empty content until the next successful query.

## 6. Server Sync

Sync restores read intent. It does not redo writes. The connection layer signals
connect and disconnect, as defined by the Node.js Runtime Spec. This section
defines what Config does with those signals.

| Trigger | Action |
| --- | --- |
| Disconnect | Mark every entry not consistent with the server. |
| Connect | Send a batch listen for every entry not using failover, with its current `md5`. |
| Periodic check, every 5 seconds | Check failover files. Send a batch listen for entries that are not consistent. |
| Full sync, every 3 minutes | Send a batch listen for every entry not using failover. |
| `ConfigChangeNotifyRequest` | Mark the entry not consistent and query it. A push carries identity, not content. |
| `changedConfigs` in a listen response | Query each changed entry. |
| Listen request fails | Leave entries not consistent. The periodic check retries. |

Entries using failover are never probed, and pushes for them are ignored.

The intervals match Java, where the 3-minute value is `ALL_SYNC_INTERNAL`. All
timers are unreferenced.

**Commit rule for queries.** Queries for one key may overlap. A query result commits
only if it is the newest query started for that entry, the entry is still active, and
the entry is not using failover. Any other result is dropped.

A query failure leaves the effective record unchanged and the entry not consistent.
It goes to the `error` event.

A confirmed missing config commits an effective record with `content: null`. It also
removes the snapshot.

## 7. Failover Transitions

| Event | Effect on the effective record |
| --- | --- |
| Failover file appears | `source` becomes `failover`, with the file content and `md5`. |
| Failover file changes | Same, with the new content and `md5`. |
| Failover file disappears | Leaves the failover content in place, marks the entry not using failover and not consistent, and queries the server. |

Following `ClientWorker#checkLocalConfig`, the entry keeps the failover `md5` until
the server query commits. Listeners are not told anything in between, and the
failover content stays effective if the server is down. Once the query commits, the
Delivery Rule restores the server value. If the query fails, sync retries.

The same query path handles recovery, so a snapshot fallback never counts as a
return to the server. Sync queries use the server only.

## 8. Transform

Transform runs the filter chain. It runs in two places: on a read or delivery, and
on publish.

```ts
interface ConfigFilter {
  readonly name: string;
  readonly order: number;
  onPublish?(context: ConfigFilterContext): void | Promise<void>;
  onResponse?(context: ConfigFilterContext): void | Promise<void>;
  close?(): void | Promise<void>;
}

interface ConfigFilterContext {
  readonly dataId: string;
  readonly group: string;
  readonly namespace: string;
  readonly source?: 'server' | 'snapshot' | 'failover';  // Absent on publish.
  readonly signal: AbortSignal;  // Aborted when the result is no longer needed.
  content: string;
  encryptedDataKey?: string;
}
```

`client.addConfigFilter(filter)` registers a filter, matching Java
`ConfigService#addConfigFilter`. A filter with the name of an existing filter is
ignored. Filters run in ascending `order`, and equal values keep the order in which
they were added.

Rules:

- `onPublish` runs for `publishSingle` and `publishConfigCas`. If it fails, the call
  rejects and nothing is sent.
- `onResponse` runs for every source, because
  [filters apply after content is selected](https://github.com/alibaba/nacos/blob/3.3.0/specs/en/client/client-local-cache-redo-spec.md#2-config-local-recovery).
  A filter uses `source` and `encryptedDataKey` to decide what to do.
- A filter works on a copy of the raw record. It cannot change cache state.
- Node.js uses hooks in place of Java's `IConfigFilterChain`. A filter cannot stop
  the chain except by failing.
- A filter fails by throwing. An error with `retryable: false` tells Deliver that
  retrying cannot help. Any other failure is retryable.
- `close()` on the client calls `close` on each filter.

## 9. Delivery

Delivery runs for an entry whenever a listener is due.

1. Take the effective record and its `version`. Abort any attempt for an older
   `version`.
2. Run `onResponse` once for this attempt.
3. Check that the entry is active and its `version` is unchanged. If not, drop the
   result.
4. Call each listener that is still due and has no callback in progress.

The filter runs once per attempt, not once per listener as in Java. KMS calls then
scale with config versions, not with listeners.

Filters do not run inside the per-key queue. A slow or hanging filter must not delay
a newer version or a failover switch. A newer `version` starts its own attempt, and
the result of the older attempt is dropped.

### 9.1 Latest State Only

A listener receives the latest effective state, not every version. If versions
change while a callback is in progress, the listener gets the latest one when it
finishes. This matches `inNotifying` in `CacheData`, which skips a busy listener and
tries again later. Pending work never accumulates per version.

A callback is in progress until it returns. If it returns a `Promise`, it is in
progress until that settles.

### 9.2 Outcomes

| Outcome | `deliveredMd5` | Next step |
| --- | --- | --- |
| Callback returned or resolved | Set to the delivered `md5` | None |
| Callback threw or rejected | Set to the delivered `md5` | Goes to `error`. Not retried. |
| Retryable filter failure | Unchanged | Goes to `error`. Retried for the same `version`. |
| Non-retryable filter failure | Unchanged | Goes to `error`. Retried only when `version` changes. |
| Dropped as out of date | Unchanged | The current `version` has its own attempt. |

Each listener runs independently. One that throws does not affect the others.

Java leaves `lastCallMd5` unchanged when a callback throws, so it replays the
callback on a later cycle. Node.js does not, for two reasons. A callback that always
fails would otherwise trigger filter calls forever, and a callback error is an
application bug that a retry cannot fix. The
[Agent Watch contract](https://github.com/alibaba/nacos/blob/3.3.0/specs/en/client/runtime-push-reconnect-spec.md)
has the same rule: an invoked callback that throws is not automatically replayed.

### 9.3 Retry

Retry state is a property of the entry, not of a timer. An entry has at most one
retry scheduled, and it applies to the current `version`.

- The delay starts at 1 second, doubles, and is capped at 60 seconds.
- The retry runs for every listener that is due at that moment, including listeners
  added since the failure.
- A new `version` cancels the retry and resets the delay.
- Removing one listener leaves the retry in place for the others.
- Removing the last listener, or calling `close()`, cancels it.

### 9.4 First Delivery

A new listener has no `deliveredMd5`, so it is due as soon as the record is known. It receives
the current value without waiting for a change. If the config is missing, that value is
`null`. If the first query fails, the record stays unknown and the listener is not called.

This keeps the 2.6.x behavior. It differs from Java, where `addListener` starts from the
cached `md5`, and `getConfigAndSignListener` covers the initial read.

Adding a listener never disturbs the progress of other listeners.

### 9.5 Deletion And Empty Content

A deleted config has `content: null`. Listeners receive `null`, as in Java and 2.6.x, and
filters do not run.

An empty string is an ordinary value. Listeners receive `''`, filters run, and it is distinct
from `null`, so a change between the two is delivered.

## 10. Unsubscribe And Close

| Action | Effect |
| --- | --- |
| Remove one of several listeners | That listener gets no more callbacks. Other listeners are unaffected. |
| Remove the last listener | Discards the entry, cancels its work, and sends one un-listen request. |
| Unsubscribe, then subscribe again | Creates a new entry. Nothing from the old entry reaches the new one. |
| `close()` | Cancels all work, stops all timers, aborts filters, and closes them. |

An active callback cannot be stopped, but no further one starts.

After every `await`, code checks that the client is open, that the entry is the same
object, and that the listener is still registered. This is the rule in
[Async Code](../design/code-style-spec.md#7-async-code).

Remote listen and un-listen requests for one key run in a per-key queue, so they
reach the server in order. Short state commits use the same queue. Filters and
callbacks do not.

## 11. Encryption

Config encryption is a `ConfigFilter`. It is not a separate path, and the pipeline
has no knowledge of KMS.

| Direction | Hook | Behavior |
| --- | --- | --- |
| Publish | `onPublish` | For a `cipher-` dataId, encrypts `content` and sets `encryptedDataKey`. |
| Read and delivery | `onResponse` | For a `cipher-` dataId, decrypts `content` with `encryptedDataKey`. |

Rules for the filter:

- A `failover` record with no `encryptedDataKey` is plaintext. The filter returns it
  unchanged, and makes no KMS call. Emergency config never waits for KMS.
- A `server` or `snapshot` record with no `encryptedDataKey` fails with
  `retryable: false`. Ciphertext is never delivered as if it were plaintext.
- A KMS outage fails as retryable.

The rest of the KMS design follows in its own PR.

## 12. Required Behavior

These cases come from the review of #157. The Test Design Spec turns them into
scenarios, for plain and `cipher-` dataIds.

| Case | Expected result | Rule |
| --- | --- | --- |
| `S -> F -> S`, server unchanged | Listener receives S, F, S. | 3.1, 7 |
| `S -> F1 -> F2 -> S` | Listener receives S, F1, F2, S. | 3.1, 7 |
| `F` has the same md5 as `S` | No extra callback, and no stale marker. | 3.1 |
| Failover removed, server down | `F` stays effective. Recovery happens once the server returns. | 7 |
| Server config deleted during failover | After failover ends, the listener receives `null`. | 7, 9.5 |
| Filter fails, second listener joins, filter recovers | Both listeners receive the value with no new publish. | 9.3 |
| Slow filter for A, newer B commits | The listener receives B. A is dropped, in either completion order. | 9 |
| Failed A, newer B with another data key | A's retry is cancelled, and the listener ends on B. | 9.3 |
| Filter pending, failover appears | The listener receives `F` at once. The late server result does not replace it. | 6, 9 |
| Removing one listener during a retry | Others still recover. | 9.3, 10 |
| Removing the last listener, or `close()`, during a retry | Timers are cleared and late results are silent. | 10 |
| Unsubscribe and subscribe again during a filter call | The new subscription gets the value exactly once. | 3, 10 |
| One listener throws | Others receive the value. No filter retry follows. | 9.2 |
| Disconnect, config changes, reconnect | The listener receives the change. | 6 |
| Snapshot write fails, then the server is down | The previous complete record is used. | 5 |
| Server returns empty content, then is down after a restart | The empty string is served from the snapshot. | 4, 5 |
| Config changes between `''` and missing | Each change is delivered, as `''` and `null`. | 3, 9.5 |
| Authorization rejected, failover file present | The failover content is served. | 4 |

## 13. Open Questions

- **HTTP transport:** The Node.js implementation spec freezes HTTP, so this pipeline
  and `addConfigFilter` are gRPC only, and KMS would not work over HTTP in 3.x. #157
  implements both transports. Confirm that gRPC only is acceptable.
- **Decrypt fallback:** On a KMS decrypt failure, Java can fall back to an in-memory
  plaintext cache. #157 does not, to avoid keeping plaintext in memory, and section 2
  forbids it. Confirm with the KMS PR.
