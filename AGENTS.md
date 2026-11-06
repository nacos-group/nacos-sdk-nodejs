# AGENTS.md

This file provides guidance to AI coding agents (Claude Code, Cursor, GitHub Copilot, etc.) when working with the Nacos Node.js SDK repository.

## AI Contribution Guidelines

- **Do NOT post AI-generated comments** on issues or PRs. Discussions are for humans only.
- **Discuss before implementing**: Ensure the implementation direction is agreed upon with maintainers in the issue comments before starting work.
- **Spec-first coding is mandatory**: Before changing behavior, public APIs,
  options, lifecycle, runtime flow, or error mapping, AI agents MUST read the
  relevant specs under [`specs/`](./specs/README.md) and treat them as the rule
  source for the implementation.
- **Discuss spec-impacting changes before coding**: If a change touches behavior
  covered by an existing spec, or exposes a gap between the code and the spec,
  AI agents MUST discuss the implementation direction and the required spec
  update with maintainers before starting the code change.
- **Update specs with the design**: Any design proposal that changes or
  clarifies spec-covered behavior MUST include the corresponding spec updates
  in the same change set. When the design is large or controversial, prefer a
  spec/design-only PR first, then follow with implementation PRs.
- **SDK scenario impact comes first**: Before adding, changing, deleting, or
  deprecating any public client method, option, model, listener behavior,
  lifecycle behavior, or error mapping, AI agents MUST analyze and update the
  test scenarios and coverage registry in the same change set. If the
  end-to-end success path is impractical, cover parameter validation, boundary
  behavior, and controlled errors, and document the uncovered path.
- **Disclose AI usage**: When a significant part of a commit is AI-generated, add a trailer to your commit message:
  ```
  Assisted-by: Claude Code
  ```

## Repository Overview

This repository contains the Node.js Client SDK for [Nacos](https://github.com/alibaba/nacos).

The 3.x work is tracked in [#162](https://github.com/nacos-group/nacos-sdk-nodejs/issues/162). It moves the SDK to a single `@nacos-group/client` package. Until that migration lands, the repository still has the 2.x layout:

| Package | Role |
| --- | --- |
| `packages/nacos` | Aggregate package. |
| `packages/nacos-common` | gRPC connection, payload codec, and shared transport code. |
| `packages/nacos-config` | Config client, HTTP agent, snapshot, and failover. |
| `packages/nacos-naming` | Naming client, proxies, and service cache. |

**Main Branch**: `master` | **Node.js**: CI runs 18, 20, and 22 | **Package manager**: pnpm

## Specs

Java is the baseline for shared SDK semantics. Shared rules live in the
[`alibaba/nacos` specs](https://github.com/alibaba/nacos/tree/3.3.0/specs) and
are referenced from this repository, not copied. This repository records the
Node.js implementation and its differences.

Start from the [spec index](./specs/README.md). If the intended behavior differs
from a spec, do not silently implement the code first.

## Build & Test Commands

Current commands, as run by [CI](./.github/workflows/ci.yml):

```bash
pnpm install
pnpm -r run build

# Unit tests, from a package directory
npx midway-bin test --ts -- --file <test-file> --timeout 30000
```

Integration tests need a running Nacos server. See the `integration-*` jobs in
the CI workflow for the server setup and test files.

These commands change when the toolchain migration lands. Update this section in
the same PR.

## Code Style

Follow the [Code Style Spec](./specs/en/design/code-style-spec.md).

## PR Convention

All PRs target `master`. Follow the [PR template](./.github/PULL_REQUEST_TEMPLATE.md).

**Title format**: Conventional Commits, for example
`feat: add selectOneHealthyInstance to naming client`.

Reference the issue in the PR body. A spec-only PR must not change code.

## Security Vulnerabilities

Do NOT report security vulnerabilities via GitHub Issues. Use [ASRC (Alibaba Security Response Center)](https://security.alibaba.com) instead.
