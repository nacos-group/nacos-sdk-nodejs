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

# Nacos Node.js SDK Code Style Spec

These rules apply to new and changed code in 3.x. Existing code is not reformatted
on its own. The toolchain migration adds the lint and format configuration, and
that configuration then enforces these rules.

## 1. Language

- TypeScript with `strict` enabled.
- Target Node.js 18. Do not add polyfills for older versions.
- Public APIs have explicit types. Do not use `any` in a public signature.
- Prefer `unknown` to `any` for untrusted data, such as server payloads.

## 2. Formatting

| Rule | Value |
| --- | --- |
| Indentation | 2 spaces |
| Line length | 100 characters |
| Quotes | Single quotes |
| Semicolons | Required |
| Trailing commas | Required in multi-line literals |
| Braces | Required for all `if`, `else`, `for`, and `while` blocks |

## 3. Naming

| Item | Convention | Example |
| --- | --- | --- |
| Variables, functions, methods | `camelCase` | `getConfig` |
| Classes, interfaces, types | `PascalCase` | `NacosConfigClient` |
| Constants | `UPPER_SNAKE_CASE` | `DEFAULT_GROUP` |
| Files | `snake_case.ts` | `client_worker.ts` |
| Test files | `<name>.test.ts` | `payload_codec.test.ts` |

Use the TypeScript `private` modifier, not a leading underscore. Names that cross
the wire keep their Nacos spelling, such as `dataId` and `tenant`.

## 4. License Header

Every new source file starts with the Apache License 2.0 header used by the main
Nacos repository:

```ts
/*
 * Copyright 1999-${year} Alibaba Group Holding Ltd.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
```

## 5. Comments And Documentation

- Comments and log messages are in English.
- Every public class, method, and option has TSDoc.
- Comment on why, not what. Link the spec section when a rule comes from one.

## 6. Errors

- Do not swallow errors. An empty `catch`, or `.catch(() => {})`, needs a comment
  that says why dropping the error is correct.
- Throw only the error types in the
  [error model](../sdk/sdk-nodejs-impl-spec.md#6-error-model). Keep the original
  error as `cause`.
- Do not convert a failure to `false`, `null`, or an empty result, unless the
  implementation spec defines that result.
- Do not log secrets. This covers passwords, tokens, secret keys, and signatures.

## 7. Async Code

- Use `async` and `await`. Do not mix them with callback-style control flow.
- Do not leave a floating promise. Await it, return it, or attach a handler that
  routes the failure to the `error` event.
- Every timer, stream, and listener has an owner that releases it in `close()`.
- Background timers call `unref()`.
- After every `await` in long-lived state logic, recheck that the client and the
  subscription are still active.

## 8. Module Rules

- No mutable state at module level.
- No `process.exit`, and no handlers on `process` events.
- Import across layers only as allowed by the
  [Architecture Spec](./architecture-spec.md#2-layers).
- A new runtime dependency needs a reason in the PR description.
