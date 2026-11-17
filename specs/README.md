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

# Nacos Node.js SDK Specs

This directory defines the target behavior of the Node.js SDK 3.x. Specs are the
source for implementation, tests, and user documentation. The work is tracked in
[#162](https://github.com/nacos-group/nacos-sdk-nodejs/issues/162).

## Relationship To The Main Repository

The [`alibaba/nacos` specs](https://github.com/alibaba/nacos/tree/3.3.0/specs)
define shared SDK semantics, and Java is their baseline. The
[SDK Spec](https://github.com/alibaba/nacos/blob/3.3.0/specs/en/sdk/sdk-spec.md#8-multi-language-alignment)
asks other languages to align with those semantics and to document their
differences in language implementation specs. These specs are that record.

- Shared semantics are referenced, not copied.
- Links to the main repository are pinned to tag `3.3.0`. Update them together
  when the baseline moves.
- If a spec here conflicts with a main repository spec, the main repository wins
  unless this repository documents the difference and the reason.

## Rules

- Read the matching spec before changing behavior, public APIs, options,
  lifecycle, runtime flow, or error mapping.
- A change that alters spec-covered behavior updates the spec in the same PR.
- A large or controversial change starts with a spec-only PR.
- Each spec describes the 3.x target. Where `master` differs, the spec says so,
  and the [Feature Matrix](./en/sdk/feature-matrix-spec.md) records the gap.

## Index

| Spec | Purpose | Status |
| --- | --- | --- |
| [Feature Matrix](./en/sdk/feature-matrix-spec.md) | Capability alignment with Java, by target version. | Draft |
| [Node.js SDK Implementation Spec](./en/sdk/sdk-nodejs-impl-spec.md) | Entry points, options, lifecycle, public API, error model, breaking changes. | Draft |
| [Architecture Spec](./en/design/architecture-spec.md) | Layers, module boundaries, and mapping to Java responsibilities. | Draft |
| [Code Style Spec](./en/design/code-style-spec.md) | Language, formatting, and code rules. | Draft |
| [Config Pipeline Spec](./en/config/config-pipeline-spec.md) | Fetch, cache, transform, and delivery boundaries; filter contract. | Draft |
| [KMS Encryption Plugin Spec](./en/config/kms-encryption-plugin-spec.md) | Aliyun KMS formats, data key rules, and failure classification. | Draft, completed with the KMS PR |
| [Naming Runtime Spec](./en/naming/naming-runtime-spec.md) | Registration, subscription, service cache, and redo. | Draft |
| [Node.js Runtime Spec](./en/client/nodejs-runtime-spec.md) | Addressing, connection, ability negotiation, and auth. | Draft |
| Test Design Spec | Test layers, scenario matrix, and release gates. | Planned |

English is the first language. A Simplified Chinese copy can follow under
`specs/zh-cn/`, using the same layout as the main repository.
