# 平台设计与 API 契约

## 决策与事实

本地单体，Python 3.10+ 标准库 HTTP/SQLite；Vue 3 + TypeScript + Vite 界面。
后端调用 Node worker，由 worker 调用现有 `buildPlatform → runManagedAgent`，不复刻 Agent Loop。
源码来自固定的同级 `codebase`，不接受任意工作路径。每次实验复制一次干净基线，每次运行再复制基线。
忽略 `.git/node_modules/dist/data/artifacts/.env/密钥/数据库`，拒绝符号链接。
受治理工具固定只读，保留审批，不自动批准。SQLite 独立账本，模型事件经可选 observer 记录。

## 数据模型

SQLite `entities(kind,id,data)` 存任务、策略、实验、运行；`reviews(id,run_id,data)` 存不可变人工评分历史。
任务字段：id/name/prompt/tags/required/checks[]/rubric/version。
check：id/type(`contains|regex|tool_called|no_tool_errors`)/value。
策略字段：id/name/system_prompt/model/base_url/api_key_env/rag_mode(`off|keyword|bm25`)/top_k、
input_price/output_price/cache_price（美元每百万 Token，允许 null）。
实验字段：id/name/mode(`live|offline`)/task_ids/strategy_ids/trials/status/created_at/total/completed。
运行保存 task/strategy 快照、trial、source_hash、answer、trace[]、audit[]、retrieval[]、checks[]、
judge、metrics、execution_status、outcome(`pass|fail|unknown`)、error。
运行目录与 SQLite 路径只在后端内部使用。数据默认放 `~/.codebase-eval`（可通过 EVAL_DATA_DIR 覆盖）。

## API（同源 `/api`，JSON）

- GET `/api/state` → {tasks,strategies,experiments,runs,summary,clusters,health}
- POST `/api/tasks`、`/api/strategies` → 保存对象（有 id 则编辑）；DELETE `/api/tasks/:id`、`/api/strategies/:id`
- POST `/api/tasks/import` → {tasks:[...]}; GET `/api/tasks/export` → {tasks:[...]}
- POST `/api/experiments` → {name,mode,task_ids,strategy_ids,trials,timeout,max_tokens}；返回 experiment
- POST `/api/experiments/:id/cancel` → experiment
- GET `/api/runs/:id` → 完整 run（列表返回不带 trace/audit/answer）
- POST `/api/runs/:id/judge` → 完整 run（独立真实 Judge，不用于 offline）
- POST `/api/runs/:id/reviews` → {reviewer,status:pass|fail|unknown,reason}；返回完整 run
- GET `/api/compare?baseline=:strategyId&candidate=:strategyId&experiment=:experimentId` → comparison
- GET `/api/reports?baseline=...&candidate=...&experiment=...&format=md|json` → 回归报告下载

summary：runs/passed/failed/unknown/success_rate/known_cost_usd/unknown_cost_runs/total_tokens/
unknown_token_runs/mean_seconds/tool_calls/tool_errors/by_strategy[]。
comparison：baseline/candidate/rows[{task_id,task_name,trial,before,after,change}]/summary/gate/note。
clusters：[{category,count,run_ids}]。
health：node_ready/credentials[{env,configured}]/codebase_path（不包含密钥值）。

## 界面

深色侧边栏、浅色工作台，八个区域：概览、Benchmark、策略、实验、Trace、评审、失败聚类、回归对比。
空状态不伪造成绩；离线标记常驻；错误可见；表单、JSON 导入导出、实验启动/取消可操作。
界面 DTO 集中管理，Vue 转义所有模型文本，禁止 v-html。

## 判定

核心任务程序失败优先；程序通过但 Judge 未执行/unknown 时总体 unknown。
人工结果可补充语义评审，不能覆盖程序失败/运行错误；Judge 与人工分歧保留。
费用按实际 usage 和配置价格估算，任何缺失明确计数；Judge 费用单列并纳入合计。
对比必须使用同一实验的同题快照与源码，offline 报告永远 hold，不允许发布通过。
