# Week 03

| 小节 | 主题 | 主要内容 |
| --- | --- | --- |
| [3-1](./3-1/) | 从 Runtime 到 Agent Loop | 将第二章 Tool Runtime 接入 pi 的 `runAgentLoop`，让 Tool Result 回写 Context 驱动多轮循环；区分 Function Calling、Tool Runtime、Agent Loop 与 LoopGuard 四层职责，实现最大轮数、重复动作指纹、完成条件校验与 Follow-up 等循环保护，并预留中断与恢复的快照接口，以"对登录仓库做代码理解并生成 `artifacts/login-flow.md`"为案例完成 TDD 验收。 |
| [3-2](./3-2/) | Planning 与任务拆解 | 在 3.1 的 Agent Loop 上叠加计划层，把"修复登录会话过期边界 bug"拆成带依赖、验收标准与证据的六步计划；新增 `plan-store`（依赖检查、证据校验、原子修订）、`plan-tools`、`completion-contract` 与 `planning-prompt`，pi 的 Agent Loop 一行不改，并用同一条提示词对照 Codebase Agent 与 Planning Agent 的真实运行。 |

## 3-1 目录说明

- `login_demo/`：被分析的登录示例仓库，代码理解任务的目标仓库。
- `codebase_agent_demo/`：第一版 Codebase Agent，内嵌 `fixtures/demo-app` 目标代码，并保留一次真实运行的产物 `artifacts/login-flow.md`。
- `codebasedemo/`：补齐测试后的最终版本，覆盖 `loop-guard`、`model`、`pi-tools`、`runtime` 各层的 vitest 用例与测试 harness。

## 3-2 目录说明

- `codebase_agent_demo/`：对照组，3.1 的 Loop 加上修复任务所需的 fixtures 测试与可注入完成契约。
- `planning_agent_demo/`：实验组，Loop 加计划层，含 18 个测试用例（13 个计划层规则 + 5 个 Loop 集成）与一次真实运行的交付物 `artifacts/login-fix.md`。
- `compare-agents.sh`：用同一条提示词依次运行两个 Agent，并把过程分别写入运行记录。
- `codebase.md` / `planning.md`：两次真实 Gateway 运行的过程与结果记录（8 轮 38 条工具调用 vs 17 轮 77 条工具调用）。
