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

# Nacos Node.js SDK KMS Encryption Plugin Spec

This document holds the rules that belong to the Aliyun KMS encryption plugin. It is a
`ConfigFilter`, as defined by the
[Config Pipeline Spec](./config-pipeline-spec.md#11-encryption), and the pipeline knows
nothing about it.

**Status: draft.** It records the rules known today, so that they are not lost when they
leave the pipeline spec. The KMS PR completes it with the author of #157.

The reference implementation is the Java
[nacos-client-mse-extension](https://github.com/nacos-group/nacos-client-mse-extension/tree/61f78cb165607ae3cbc955f1d39137c32806ac72),
mainly `AliyunConfigFilter` and `KmsEncryptor`.

## 1. Which Records It Handles

The plugin handles a record only if its `dataId` starts with `cipher-`. Any other record
passes through unchanged. Blank content also passes through unchanged, as in
`AliyunConfigFilter`.

## 2. Formats

| `dataId` prefix | Mode | Data key |
| --- | --- | --- |
| `cipher-kms-aes-128-` | Envelope: KMS `GenerateDataKey` with `AES_128`, then AES on the content | `encryptedDataKey` is required |
| `cipher-kms-aes-256-` | Envelope, with `AES_256` | `encryptedDataKey` is required |
| Any other `cipher-` | Direct: KMS encrypts the content itself | None |

So a missing `encryptedDataKey` is a fault only in envelope mode. In direct mode it is
expected.

On publish, the plugin encrypts the content, and in envelope mode sets `encryptedDataKey`.
The pipeline sends both unchanged.

Encrypted data must stay readable by the Java, Go, and Python SDKs, and the reverse. Plaintext
is passed to KMS as-is, and AES content is UTF-8.

## 3. Failure Classification

| Failure | `retryable` |
| --- | --- |
| Envelope record without `encryptedDataKey` | `false` |
| Malformed `encryptedDataKey` or ciphertext | `false` |
| KMS unavailable, throttled, or timed out | `true` |
| Missing credentials or KMS client configuration | `false` |

## 4. Open Questions

- **Failover records.** Java runs the plugin on failover content like any other source,
  using the failover data key file. #157 instead treats a failover record without a data key
  as plaintext, so that emergency config never waits for KMS. If that stays, it must be an
  explicit plaintext emergency-override mode of this plugin, not a pipeline rule.
- **Local plaintext cache.** When KMS fails, Java can fall back to `KmsLocalCache`, which holds
  the plain data key or the plain content, and it is on by default. #157 does not, so that no
  plaintext is kept, and its author prefers to keep it that way. Confirm before the KMS PR.
- **HTTP.** 3.x runs the plugin on gRPC only. See the
  [Config Pipeline Spec](./config-pipeline-spec.md#13-transport).
