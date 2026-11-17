# ultrareview

[English](README.md) | [简体中文](README.zh-CN.md)

> 一套可复用的多 Agent 代码审查工作流，强调高信号问题、交叉验证和结构化输出。

`ultrareview` 的核心不是“让一个模型看代码”，而是把代码审查做成一套更可靠的系统：并行派发多个专项审查 Agent，让它们互相验证彼此的结论，最后把确认过的问题汇总成一份更可执行的报告。

## 为什么做这个

很多 AI 代码审查现在本质上还是：
- 一个模型
- 一轮输出
- 一堆混在一起的评论

这种方式在轻量场景下够用，但在下面这些场景里会明显吃力：
- 重要改动的合并前审查
- 安全敏感代码
- 大型 diff
- 边界条件密集的逻辑
- 误报太多、不方便落地

`ultrareview` 采用的是另一种模式：
- **专项审查员**，而不是一个泛化 reviewer
- **并行审查**，而不是串行思考
- **交叉验证**，而不是第一眼像 bug 就直接报
- **统一汇总**，而不是把原始笔记直接扔给你

所以它更适合做高风险改动审查、Bug Hunting、安全导向 review，以及更强调正确性的工程场景。

## 这个仓库是什么

这个仓库是一个可复用的 Skill 包，用来在你自己的环境里跑一套多 Agent 审查工作流。

它适合这样的使用方式：
- 用你自己的 agent runtime
- 用你自己的模型供应商
- 用你自己的本地或自托管基础设施

这个仓库**不包含**任何托管式私有审查后端，也**不意味着**模型调用免费。它提供的是一套可以迁移、改造、复用的 workflow pattern、角色提示词和落地说明。

## 核心工作流

`ultrareview` 会把代码审查拆成四步：

1. **收集上下文**
   - 文件、目录、PR diff 或整个仓库
   - 项目特定规则，例如 `CLAUDE.md`、`REVIEW.md`

2. **并行派发专项 Agent**
   常见角色包括：
   - Logic Verifier
   - Security Sentinel
   - Performance Oracle
   - Boundary Inspector
   - Architecture Reviewer

3. **交叉验证问题**
   - Agent 尝试证伪彼此的结论
   - 弱结论或未确认问题被丢弃
   - 重复发现被合并去重

4. **输出结构化报告**
   - Critical
   - Warning
   - Pre-existing

## Quick Start

### 方案 1：直接作为 Skill 使用

把这个仓库放进你的 skill 目录，或者直接复用下面这些文件：

```text
ultrareview/
|-- SKILL.md
`-- references/
    |-- architecture.md
    `-- diy-setup.md
```

适合的触发场景包括：
- 深度代码审查
- 安全审计
- 大型 PR review
- 正确性优先的合并前检查

示例 prompt：

```text
Run ultrareview on src/auth/
Review this PR diff with logic, security, performance, and edge-case agents
Do a deep pre-merge audit for this refactor
```

### 方案 2：接入你自己的 coding agent

如果你的环境支持：
- subagents
- team / parallel agent execution
- slash-command prompt files
- CI headless CLI review

那就可以直接把下面这些内容接进去：
- `SKILL.md`
- `references/diy-setup.md`

## 示例输出

```markdown
# Ultrareview Report
**Scope**: `src/auth/`, `src/session.ts`
**Agents**: 5 | **Duration**: 2m 41s | **Findings**: 4

## Critical (1)
### [C1] Session token can be reused after logout
- **Location**: `src/session.ts:88-121`
- **Issue**: Logout clears client state but does not revoke the persisted server-side token.
- **Root cause**: Token invalidation path is missing in the logout flow.
- **Fix**: Revoke the token on logout and reject stale tokens during session validation.

## Warning (2)
### [W1] User lookup can trigger N+1 queries during permission checks
- **Location**: `src/auth/permissions.ts:41-79`
- **Issue**: Role expansion performs repeated DB reads inside a loop.
- **Fix**: Batch-load role mappings before permission evaluation.

### [W2] Null email path produces silent fallback behavior
- **Location**: `src/auth/user.ts:24-37`
- **Issue**: Missing email falls through to guest behavior without explicit handling.
- **Fix**: Fail closed or return an explicit typed error.

## Pre-existing (1)
### [P1] Legacy password hash path lacks migration guard
- **Location**: `src/auth/hash.ts:12-33`
- **Issue**: Old hash format is still accepted without progressive upgrade.
```

## 仓库结构

```text
ultrareview/
|-- README.md
|-- README.zh-CN.md
|-- SKILL.md
|-- LICENSE
`-- references/
    |-- architecture.md
    `-- diy-setup.md
```

## 文件说明

- `SKILL.md` - 主 Skill 定义，包含审查流程、报告格式和接入路径
- `references/architecture.md` - 多 Agent 审查架构说明，包括角色分工、交叉验证和评估思路
- `references/diy-setup.md` - 实操指南，覆盖 Agent Teams、自定义 subagents、插件化方案和 CI/CD 集成

## 4 种落地方式

这个仓库整理了四种比较实用的接入路径：

1. **原生 Agent Teams**  
   适合支持团队式并行 agent 的 coding agent。

2. **插件式方案**  
   适合已经接入 compound orchestration 之类插件的环境。

3. **自定义 subagents**  
   适合想完全控制角色、prompt 和汇总逻辑的场景。

4. **CI/CD 集成**  
   适合做 PR 自动审查流水线。

## 定位

这个仓库真正有价值的不是“让一个强模型看代码”，而是背后的系统设计：
- 多个 reviewer
- 明确角色分工
- 证伪和交叉验证
- 最终统一汇总

这套模式可以迁移到不同 runtime、不同 provider、以及不同的工程流程里。

## 建议的 GitHub 元信息

**仓库描述**

> Multi-agent code review workflow with specialized reviewers, cross-validation, and structured reporting.

**建议 topics**

```text
code-review
multi-agent
ai-code-review
agent-workflow
prompt-engineering
security-review
static-analysis
developer-tools
```

## 延伸阅读

- `references/architecture.md`
- `references/diy-setup.md`
- `README.md`

## License

MIT
