# Week 05

| 小节 | 主题 | 主要内容 |
| --- | --- | --- |
| [5-1](./5-1/) | Multi-Agent 与 Subagent | 先判断任务是否真的需要拆分，区分 Multi-Agent 协作形态与主从式 Subagent；用“能否独立产出、信息是否不同、结果能否合并”三个问题筛选子任务，理解 Supervisor、Planner/Executor、Reviewer 三种模式，以及并行依赖、上下文/工具/权限三层隔离、全局预算与冲突交接。最后在 pi 中安装 `pi-subagent-extension`，用 parallel 模式委托两个只读 `course-scout`，并从 `runSingleAgent`、`spawn`、`mapWithConcurrencyLimit` 对照观察独立状态、并发上限与取消回传。 |
| [5-2](./5-2/) | Subagent 任务委托 | 把子任务提示词写成可验收契约：任务目标、输入上下文、可调用工具、权限边界、预期输出、输出格式、超时限制、评价标准与写操作限制九项缺一不可；再将契约结构化为 `task_id`、`parent_run_id`、`snapshot_id`、`policy_id`、`limits` 等字段。结果侧按“格式校验 → 证据校验 → 去重 → 排序 → 建议”聚合，冲突不靠投票而按范围、版本、证据仲裁；串行任务用 chain 模式与 `{previous}` 交接，并区分超时、临时错误、权限拒绝和输入缺失的失败处理。 |
| [5-3](./5-3/) | Skill：把经验变成可复用能力 | 区分 Tool（执行动作）、Prompt（表达指令）、Skill（保存可复用方法与材料）与 Agent（选择方法并处理当前任务）；把订单接口审查写成带 `SKILL.md` 元数据、输入、步骤、边界和验收标准的 Skill，并配套 `references/report-template.md` 与 `scripts/check_orders.py`。先在 pi 中显式 `/skill:order-list-review` 验证加载链路，再新开会话验证自动选择；理解“目录先出现、正文后读取”的渐进式披露，以及 Skill、工具治理/宿主、Sandbox 三层权限分工，最后用正例、负例、缺输入三类任务验证“选对、做对、说对”，并按五步法从真实任务提炼 Skill。 |
| [5-4](./5-4/) | Agent 评测：标准对齐、分层验收与工程迭代 | 以库存预占服务重构为案例，把“Agent 说完成了”变成可核对的事实：从结果、过程、效率、风险四层验收，用业务指标搭桥并让专家先统一“什么叫好”；把标准下钻为二元化 Rubric，做人工对齐与 Judge 校准。随后建立 Task/Trial 评测集、隔离环境与完整证据包，按“程序评分 → 模型评分 → 人工争议”组合判分并设置分层发布门禁；失败时沿 Trace 分层归因，用固定条件、多次 Trial、pass@k 与 pass^k 比较新旧版本，再把评测方法落回 AI Coding 的规范、SOP、Pre-PR 与测试设计，最终接入线上反馈形成 Case 飞轮。 |
| [5-5](./5-5/) | 项目演进阶段五：Multi-Agent & Evaluation | 在 Codebase Agent 上完成一次接近真实交付的升级：把公共 Skills（grill-me、audit-ticket、deep-research、security-review、code-review、simplify 等）和自建 `software-delivery` 全栈交付 Skills 接入 pi 工作流；用 Supervisor + Architecture/Test/Security/Performance/Documentation/Report 七个角色组成巡检流程，通过 subagent 并行检查并汇总冲突。最终以 PM、架构师、后端、前端、测试技能串起需求、契约、开发与验收，交付本机可运行的 Eval Web 平台（Vue 3 + Python API + SQLite + Node worker），覆盖题库、策略、实验、Trace、程序检查、LLM Judge、人工评审与回归对比，并明确 completed/pass、离线/live、费用未知、只读边界等易混口径。 |

## 5-1 目录说明

- `demo/`：订单接口审查与评测演示工程。`fixtures/project/` 提供带用户隔离缺失与逐单查询缺陷的订单示例（`app/orders.py`、`docs/current.md`、`docs/legacy.md`、`tests/test_orders.py`）；`cases.json` 定义 understand、retrieve、review、fix 四类任务。
- `demo/prompts/`：普通审查提示词与显式 `/skill:order-list-review` 提示词，用于对照 Skill 加载前后的行为。
- `demo/scripts/`：`pi_runner.py` 启动独立 pi 子进程并保存事件；`delegation.py` / `delegate_run.py` 演示 parallel 委托、证据校验与冲突聚合；`acceptance.py` / `probe_orders.py` 用真实 SQLite 探针独立验收；`graders.py` / `judge.py` 分别做程序评分与模型评审；`trace_analysis.py` 分析工具调用；`benchmark.py` / `compare.py` 跑基准并比较版本；`platform.py` 汇总入库；`setup_demo.py` / `skill_manifest.py` 生成 Skill、Agent 与能力包清单；`inject_demo.py` 构造越权证据和矛盾结论用于治理演示。
- `demo/tests/test_integrity.py`：校验演示数据、脚本与验收约束的完整性测试。

## 5-2 目录说明

- `demo/`：在 5-1 演示工程上增加 Skill 选择与委托结果处理。`scripts/skill_selection.py` 用正例、负例、缺输入三类任务运行 pi，并从 Trace 中判断模型是否真的读取了目标 `SKILL.md`，而不是只看回答像不像。
- `demo/_smoke/`：保留三类选择任务的实际运行记录、`selection-results.json` 与每次运行的 prompt、事件、答案和输入快照，可直接对照“命中 / 正确未选 / 漏选 / 误选”。
- `demo/injected/`：主动构造的越权证据、相互矛盾的结论和缺失任务聚合结果，用于演示 `rejected`、`conflicts`、`incomplete` 与 `needs_review` 的处理路径。
- `demo/fixtures/project/`：订单审查示例工程，与 5-1 同源，保留未按当前用户过滤和逐单查询的缺陷；`prompts/` 提供普通审查与显式 Skill 两种提示词。

## 5-3 目录说明

- `project/`：Skill 审查的目标订单工程。`app/orders.py` 中的 `list_orders` 同时存在未按当前用户过滤与逐单查询明细的问题；`docs/current.md` 是当前有效业务规则，`docs/legacy.md` 是已废弃旧规则，`tests/test_orders.py` 是现有测试。可用于练习 `SKILL.md` 的显式加载、自动选择、静态审查、证据引用与“未运行测试”标注。

## 5-4 目录说明

- `eval_lab.zip`：Agent 评测实验工程，按 zip 原名保留。解压后 `eval_lab/` 以真实 pi + DeepSeek Flash 为主、Python 标准库实现评测链路：`step_00`–`step_13` 覆盖环境检查、Rubric 校准、题目自检、Trial 隔离运行、证据采集、程序评分、LLM Judge、分层发布门禁、Trace 归因、新旧版本比较、Pre-PR 预审、测试设计、失败回流和影子重放。
- 压缩包内 `tasks/`、`rubrics/`、`fixtures/`、`references/`、`skills/`、`reports/` 分别保存题库、评分标准、库存示例工程、参考实现、不同版本的修复 Skill 与本地验证记录；`README.md` 写明真实模型运行、离线自检、证据口径和未验证边界。

## 5-5 目录说明

- `EvalLab.zip`：阶段五完整项目，按 zip 原名保留。解压后 `EvalLab/` 包含 `codebase/`（受治理的 Codebase Agent）、`codebaseEval/`（本地 Eval Web 平台）、`skills/`（software-delivery 系列交付技能）、`skills_public/`（grill-me、audit-ticket、deep-research、security-review、ultrareview 等公共技能）、`requirements.txt` 与《Eval 平台开发需求.pdf》。
- `codebaseEval/`：Vue 3 + TypeScript 前端、Python 标准库 API、SQLite 与独立 Node worker。支持 Benchmark 题库、策略配置、实验工作台、Trace、评审中心、评测概览/失败聚类和回归对比；`offline` 可先验证链路，`live` 才调用真实模型，默认只读审查本地可信仓库。
- 平台口径以项目 README 为准：`completed` 只表示执行结束，不等于 `pass`；未知、取消、离线结果单列；Judge 使用与被评策略相同的模型；RAG 为关键词/BM25 检索；独立工作区不是操作系统沙箱。
