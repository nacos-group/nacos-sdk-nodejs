# 为 Nacos Node.js SDK 做贡献

[English](./CONTRIBUTING.md)

欢迎，感谢你为 Nacos Node.js SDK 贡献代码或文档。本文说明如何找到工作、认领 issue、报告问题，以及如何提交一个能快速 review 和合并的改动。

项目使用 [Apache License 2.0](./LICENSE) 发布。bug 和 feature 通过 GitHub issue 跟踪，代码通过 pull request 合并到 `master`。

## 开始之前

### 行为准则

请阅读并遵守 [Code of Conduct](./CODE_OF_CONDUCT.md)，在社区中保持尊重和建设性。

### AI 辅助贡献

欢迎使用 AI 工具，规则见 [AGENTS.md](./AGENTS.md)：

- 不要在 issue 或 pull request 下发布 AI 生成的评论。讨论由人类参与。
- 不要让 AI agent 代替你认领 issue。`/assign` 是人类动作。
- 如果一次提交的很大一部分由 AI 生成，在 commit message 里加 `Assisted-by: Claude Code`。
- 不要添加 `Co-Authored-By: Claude` 或其他 AI co-author trailer。

### Spec 优先

改行为之前先读 [spec 索引](./specs/README.md)。spec 是 3.x client 的契约。

如果改动涉及公开方法、配置项、model、listener、生命周期或错误映射，必须在同一个 change set 里更新对应 spec，以及 [test/SCENARIOS.md](./test/SCENARIOS.md) 和 [test/COVERAGE.md](./test/COVERAGE.md) 的场景和登记表。方向还没达成一致时，先在 issue 里讨论。

### 代码风格

遵循 [code style spec](./specs/en/design/code-style-spec.md)：2 空格缩进、TypeScript strict、Apache license header、公开 API 写 TSDoc、不要静默吞错。

## 找到可以做的 Issue

3.x 计划在 [#162](https://github.com/nacos-group/nacos-sdk-nodejs/issues/162) 跟踪。实现工作拆成了它下面的 sub-issue，包括 [#167](https://github.com/nacos-group/nacos-sdk-nodejs/issues/167) 到 [#178](https://github.com/nacos-group/nacos-sdk-nodejs/issues/178)。

- `good first issue`：适合新贡献者的聚焦任务。
- `help wanted`：需要更多人手实现的项。
- 未认领的 issue：[is:issue is:open no:assignee](https://github.com/nacos-group/nacos-sdk-nodejs/issues?q=is%3Aissue+is%3Aopen+no%3Aassignee)。

开始前先看 assignee，有些 issue 可能已经被认领。pull request 必须关联一个有效 issue；唯一例外是 typo 这类琐碎修改。

## 认领 Issue

为了避免重复工作、让状态可见：

1. 在 issue 下评论 `/assign`。如果没人认领，你会被自动分配。
2. 如果已有 assignee，请等待，或在评论里沟通分工。
3. 如果无法继续，评论 `/unassign` 释放。

提示：

- 复杂的 issue，先讨论实现方案再开始。
- 需要更多时间，就在 issue 里更新进展。
- 维护者可以手动释放长期没有进展的认领；没有自动超时。
- 认领必须由你本人操作，AI agent 不得代替你发 `/assign`。

## 报告 Bug

用 bug 模板开 issue，包含：

- Nacos Node.js SDK 版本、Node.js 版本、transport（`grpc` 或 `http`）、Nacos server 版本、操作系统。
- 复现步骤。
- 期望行为和实际行为。
- 相关日志或堆栈。

先搜索是否已有重复 issue。尽量用英文；可以同时附上中文原文。

## 报告安全问题

不要在 GitHub issue 里报告安全漏洞。请走 [ASRC（Alibaba Security Response Center）](https://security.alibaba.com)。

## 开发环境

Node.js 18+ 是支持与测试基线。CI 跑 18、20、22，3.x 目标矩阵会加上 24。当前包元数据里的 `engines` 还是 `>=8`，issue [#168](https://github.com/nacos-group/nacos-sdk-nodejs/issues/168) 会对齐到 3.0 基线。

前置条件：Node.js 18+ 和 pnpm。

```bash
pnpm install
pnpm -r run build
```

单元测试，在 package 目录下：

```bash
npx midway-bin test --ts -- --file <test-file> --timeout 30000
```

集成测试需要运行中的 Nacos server。server 搭建和测试文件见 [.github/workflows/ci.yml](./.github/workflows/ci.yml) 里的 `integration-*` job。

仓库目前还是 2.x 布局（lerna、`midway-bin`、多个 package）。issue #168 会迁移到 3.x 单包工具链并更新这些命令；本节会在那个 pull request 里一起改。

## 贡献流程

1. Fork 仓库并 clone 到本地。
2. 添加上游：`git remote add upstream https://github.com/nacos-group/nacos-sdk-nodejs.git`。
3. 从最新 `master` 建分支：`git checkout -b feat/my-change upstream/master`。
4. 完成改动，并在同一个 change set 里更新 spec、场景和登记表。
5. 跑 build 和受影响的测试。
6. 用 [Conventional Commits](https://www.conventionalcommits.org/) 提交，例如 `feat: add selectOneHealthyInstance`。用 `git commit --signoff` 签名，不要加 `Co-Authored-By: Claude`。
7. 向 `master` 开 pull request。使用 [PR 模板](./.github/PULL_REQUEST_TEMPLATE.md)，在 body 里引用 issue，并完成 checklist。
8. 处理 review 意见。一个 pull request 只聚焦一个 issue。

测试标题以场景 ID 开头，例如 `CFG-20: S -> F -> S`，这样矩阵可以和测试文件对上。失败的测试不允许靠重跑过关：修掉或删除，并把对应场景退回 `Pending`。

## 提问

用 question 模板开 issue，或先看 [#162](https://github.com/nacos-group/nacos-sdk-nodejs/issues/162) 里的 roadmap。尽量公开讨论，方便其他人查到答案。
