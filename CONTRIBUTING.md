# Contributing to Nacos Node.js SDK

[中文](./CONTRIBUTING_zh.md)

Welcome, and thank you for contributing to the Nacos Node.js SDK. This document explains how to find work, claim an issue, report a problem, and send a change that can be reviewed and merged quickly.

The project is released under the [Apache License 2.0](./LICENSE). We use GitHub issues for bug reports and feature requests, and pull requests targeting `master`.

## Before You Get Started

### Code of Conduct

Read and follow our [Code of Conduct](./CODE_OF_CONDUCT.md). We expect everyone in the community to be respectful and constructive.

### AI-Assisted Contributions

AI tools are welcome. The rules are in [AGENTS.md](./AGENTS.md):

- Do not post AI-generated comments on issues or pull requests. Discussions are for humans.
- Do not let an AI agent claim an issue on your behalf. `/assign` is a human action.
- When a significant part of a commit is AI-generated, add `Assisted-by: Claude Code` to the commit message.
- Do not add `Co-Authored-By: Claude` or any other AI co-author trailer.

### Spec-First Changes

Read [the spec index](./specs/README.md) before changing behavior. The specs are the contract for the 3.x client.

If a change affects a public method, option, model, listener, lifecycle, or error mapping, update the matching spec and the test scenarios in [test/SCENARIOS.md](./test/SCENARIOS.md) and [test/COVERAGE.md](./test/COVERAGE.md) in the same change set. If the direction is not agreed yet, discuss it in the issue before writing code.

### Code Style

Follow [the code style spec](./specs/en/design/code-style-spec.md): 2-space indentation, TypeScript strict mode, Apache license headers, TSDoc for public APIs, and no silently swallowed errors.

## Finding Issues to Work On

The 3.x plan is tracked in [#162](https://github.com/nacos-group/nacos-sdk-nodejs/issues/162). The implementation work is split into sub-issues there, including [#167](https://github.com/nacos-group/nacos-sdk-nodejs/issues/167) to [#178](https://github.com/nacos-group/nacos-sdk-nodejs/issues/178).

- `good first issue`: a focused task that is good for newcomers.
- `help wanted`: implementation work where we need more hands.
- Unassigned issues: [is:issue is:open no:assignee](https://github.com/nacos-group/nacos-sdk-nodejs/issues?q=is%3Aissue+is%3Aopen+no%3Aassignee).

Check the assignee before you start; some issues may already be claimed. A pull request must reference a valid issue. The only exception is a trivial change such as a typo fix.

## Issue Assignment

To avoid duplicate work and keep the status visible:

1. Comment `/assign` on the issue. You are assigned automatically if nobody else has claimed it.
2. If the issue already has an assignee, wait, or discuss the work in the comments.
3. Comment `/unassign` to release an issue you cannot continue.

Tips:

- For a complex issue, discuss your approach in the issue before you start.
- If you need more time, comment with a status update.
- A maintainer may release an assignment that has had no activity for a long time. There is no automatic timeout.
- Claim an issue yourself. An AI agent must not post `/assign` for you.

## Reporting Bugs

Open an issue with the bug template. Include:

- Nacos Node.js SDK version, Node.js version, transport (`grpc` or `http`), Nacos server version, and operating system.
- Steps to reproduce the problem.
- Expected behavior and actual behavior.
- Relevant logs or stack traces.

Check for duplicates first. Use English if you can; a Chinese original alongside it is fine.

## Reporting Security Bugs

Do not report security vulnerabilities in GitHub issues. Use [ASRC (Alibaba Security Response Center)](https://security.alibaba.com) instead.

## Development

Node.js 18+ is the supported and tested baseline. CI runs 18, 20, and 22, and the 3.x target matrix adds 24. The current package metadata still declares `engines >=8`; issue [#168](https://github.com/nacos-group/nacos-sdk-nodejs/issues/168) aligns it with the 3.0 baseline.

Prerequisites: Node.js 18+ and pnpm.

```bash
pnpm install
pnpm -r run build
```

Unit tests, from a package directory:

```bash
npx midway-bin test --ts -- --file <test-file> --timeout 30000
```

Integration tests need a running Nacos server. See the `integration-*` jobs in [.github/workflows/ci.yml](./.github/workflows/ci.yml) for the server setup and test files.

The repository is still on the 2.x layout (lerna, `midway-bin`, several packages). Issue #168 migrates it to the 3.x single-package toolchain and updates these commands; this section changes in that pull request.

## Contribution Flow

1. Fork the repository and clone your fork.
2. Add upstream: `git remote add upstream https://github.com/nacos-group/nacos-sdk-nodejs.git`.
3. Create a branch from the latest `master`: `git checkout -b feat/my-change upstream/master`.
4. Make the change. Update the spec and the scenario and coverage entries in the same change set.
5. Run the build and the affected tests.
6. Commit with [Conventional Commits](https://www.conventionalcommits.org/), for example `feat: add selectOneHealthyInstance`. Sign off the commit with `git commit --signoff`, and do not add a `Co-Authored-By: Claude` trailer.
7. Open a pull request against `master`. Use the [PR template](./.github/PULL_REQUEST_TEMPLATE.md), reference the issue in the body, and complete the checklist.
8. Address review comments. Keep the pull request focused on one issue.

Test titles start with the scenario ID, such as `CFG-20: S -> F -> S`, so the matrix can be checked against the test files. A failing test is never retried to make it pass: fix it or remove it, and return its scenario to `Pending`.

## Questions

Open an issue with the question template, or check the roadmap in [#162](https://github.com/nacos-group/nacos-sdk-nodejs/issues/162). We prefer public discussion so others can find the answer.
