# Week 03

| 小节 | 主题 | 主要内容 |
| --- | --- | --- |
| [3-1](./3-1/) | 从 Runtime 到 Agent Loop | 将第二章 Tool Runtime 接入 pi 的 `runAgentLoop`，让 Tool Result 回写 Context 驱动多轮循环；区分 Function Calling、Tool Runtime、Agent Loop 与 LoopGuard 四层职责，实现最大轮数、重复动作指纹、完成条件校验与 Follow-up 等循环保护，并预留中断与恢复的快照接口，以"对登录仓库做代码理解并生成 `artifacts/login-flow.md`"为案例完成 TDD 验收。 |
| [3-2](./3-2/) | Planning 与任务拆解 | 在 3.1 的 Agent Loop 上叠加计划层，把"修复登录会话过期边界 bug"拆成带依赖、验收标准与证据的六步计划；新增 `plan-store`（依赖检查、证据校验、原子修订）、`plan-tools`、`completion-contract` 与 `planning-prompt`，pi 的 Agent Loop 一行不改，并用同一条提示词对照 Codebase Agent 与 Planning Agent 的真实运行。 |
| [3-3](./3-3/) | State Machine 与 Checkpoint | 先用 pi 原生 `--session-dir` / `-c` 验证会话续接，指出"能继续对话 ≠ 能恢复现场"；在 3.2 的 Planning Agent 上补齐业务三件套：任务状态机（九态显式迁移）、步骤执行记录（工具调用、失败原因、重试与证据）与业务 Checkpoint（原子存档、恢复前三态判定、patchHash 绑定的人工审批、独立工作区重跑），按最小规格 R1–R5 实现并以 A1–A8 场景验收。 |
| [3-4](./3-4/) | Sandbox 与执行边界 | 从任务出发确定文件、命令、网络、资源四类允许的副作用，理清 Tool Runtime（检查放行）、Sandbox（限制影响范围）与 Harness（组织执行）的分工；本地用 pi-sandbox 配置 `sandbox.json`，以三条提示词验证产物可写、受保护文件拒绝写入、未授权域名阻断；再用 OpenSandbox 以 Python 驱动 Docker 沙箱跑通"创建 → 执行 → 取回结果 → 销毁"闭环，并讨论统一执行入口、取消传播与审计。 |
| [3-5](./3-5/) | Agent Harness：把一次代码修改做完整 | 以修复登录会话过期为案例，把 Loop、Context、Tool Runtime、State/Checkpoint、Governance 与 Sandbox 连成完整闭环：测试证据关联实际受测内容、每个验证范围取最新有效结果、取消信号覆盖真实执行路径、恢复前先核对现场、真实错误与完成缺项进入下一轮上下文；最后对照阅读 Anthropic commerce-agents 的手写 Messages API Loop（`ToolOutcome` 同时交给模型与宿主、Provenance/Guardrail/Approval 三道门禁、ChangeLedger 暂存与应用分离）。 |
| [3-6](./3-6/) | LangGraph 与 Agent 编排 | 以一张微服务发布审批流程覆盖 LangGraph 六个核心机制：State/节点/边、`add_conditional_edges` 条件分支（L/M/H 变更分级路由）、ToolNode 四路并行前置检查、`interrupt()` + `Command(resume=...)` 人工审批、SqliteSaver Checkpoint 跨进程恢复、带预算上限的修订与灰度回滚循环，以及 Mermaid / stream / get_state / langgraph dev 调试可视化；工程按 demos/01_minimal → 06_visualize 六步演进（P1–P6 提示词驱动、每步带 pytest 验收），顶层 release_pipeline 合成完整案例。 |
| [3-7](./3-7/) | 项目演进阶段三：Codebase Agent | 把 Loop、Planning、State/Checkpoint、Sandbox、Harness 与审批组合成完整项目 `project3/v2`（TypeScript Agent + Python LangGraph 审批服务）：十件仓库工具经 JSON Schema 契约校验、按 read/write/execute 风险分级审批，上下文受单轮截断与历史压缩预算约束，审计与 Trace 落 SQLite 账本；代码理解与测试修复两类任务端到端验收，`cli eval` 用独立工作副本生成评估报告。 |

## 3-1 目录说明

- `login_demo/`：被分析的登录示例仓库，代码理解任务的目标仓库。
- `codebase_agent_demo/`：第一版 Codebase Agent，内嵌 `fixtures/demo-app` 目标代码，并保留一次真实运行的产物 `artifacts/login-flow.md`。
- `codebasedemo/`：补齐测试后的最终版本，覆盖 `loop-guard`、`model`、`pi-tools`、`runtime` 各层的 vitest 用例与测试 harness。

## 3-2 目录说明

- `codebase_agent_demo/`：对照组，3.1 的 Loop 加上修复任务所需的 fixtures 测试与可注入完成契约。
- `planning_agent_demo/`：实验组，Loop 加计划层，含 18 个测试用例（13 个计划层规则 + 5 个 Loop 集成）与一次真实运行的交付物 `artifacts/login-fix.md`。
- `compare-agents.sh`：用同一条提示词依次运行两个 Agent，并把过程分别写入运行记录。
- `codebase.md` / `planning.md`：两次真实 Gateway 运行的过程与结果记录（8 轮 38 条工具调用 vs 17 轮 77 条工具调用）。

## 3-3 目录说明

- `login_demo/`：登录示例仓库，与 3-1 中相同，本节继续作为代码理解与修复的目标仓库。
- `planning_agent_demo/`：在 3.2 计划层之上补齐任务状态机、步骤执行记录、Checkpoint 与人工接管（`task-record.ts`、`checkpoint.ts`、`resume.ts`、`approval.ts` 等），含 A1–A10 验收用例与真实运行产物 `artifacts/`。
- `3-3-交付说明.md`：工程内交付文档——最小规格、需求/改动/验证对应表与实际运行证据。

## 3-4 目录说明

- `pi-boundary-demo/`：pi-sandbox 本地边界验收的运行现场，`artifacts/ok.txt` 即提示词一要求写入的 `sandbox-ok`；`.pi/sandbox.json` 等配置步骤见课件 2.2 节。
- `opensandbox-demo/`：OpenSandbox Docker 沙箱演示：`sandbox_demo.py`（创建容器 → 执行固定测试 → 取回结果 → 销毁）、`sandbox.toml` 服务配置，以及 `host-only-marker.txt` / `sandbox-result.json`（验证容器内看不到宿主标记文件）。

## 3-5 目录说明

- `harness_agent/`：在 3.3 工程上继续完善的 Harness 版本，新增 `test-process.ts` 与 `harness-evidence.test.ts` 等：测试证据绑定实际受测内容、各验证范围取最新有效结果、取消覆盖真实执行路径、恢复先核对现场；运行入口见 `package.json` 的 `lab:harness`（固定动作）与 `lab:cycle`（真实模型）。
- `commerce-agents/`：Anthropic 开源的 Claude Commerce Agents（shopping-agent 与 merchant-agent），课程第六节用它阅读手写 Harness：`ToolOutcome` 双消费者、`gates.py` 三道门禁、`changes.py` 变更账本；含四个垂直行业 `examples/`（已剔除 node_modules 等依赖与构建产物）。

## 3-6 目录说明

- `release_pipeline/`：LangGraph 发布审批流水线教学案例，同时是 `prompts/SDD-TEMPLATE.md` 的参考实现；未配置 `DEEPSEEK_API_KEY` 时自动降级为规则实现，无密钥可跑。
- `release_pipeline/demos/01_minimal/` 至 `06_visualize/`：六个渐进式 demo——主线 → 条件路由 → ToolNode 并行 → interrupt + Checkpoint 人工审批 → 带预算循环 → 可视化，每个自带 pytest 验收用例；`demos/final/` 为合成版本。
- 顶层 `app.py`（`submit` / `status` / `approve` / `tail` / `demo` 子命令）、`docker-compose.yml` 与 `config/` 合成完整案例；`samples/patch.diff` 为演示用变更样例。

## 3-7 目录说明

- `project3/`：项目阶段三 Codebase Agent。`v2/` 是工程主体：pi 循环（`src/pi/`）、十件仓库工具（`src/tools/`）、契约校验与沙箱边界（`src/contract.ts` / `src/sandbox.ts`）、审批服务（`hitl/`：FastAPI + LangGraph 审批图）、SQLite 账本（`src/store.ts`）与评估入口。
- `samples/1_login_demo/`：任务一（代码理解，只读 + 写一份文档）样本仓库；`samples/2_bug_fix/demo-app/`：任务二（跑测试 + 只改 src）样本，预置会话过期边界缺陷与失败测试，`package.json` 的 test 口径已按课程优化为匹配 `tests/**/*.test.ts`。两个样本以普通目录发布（原包内嵌的 baseline `.git` 未随包发布）；如需 `git diff` / `git status` 验证，先在样本内 `git init && git add -A && git commit -m baseline` 重建基线。
- `v2/artifacts/eval_report.md`（含 `.json`）：`cli eval` 对两类任务的评估报告交付物。
- `v2/data/platform.db` 与 `.eval-runs/` 为可再生的运行账本与评估工作副本，按工程自身 `.gitignore` 不入库（本地保留）。
