# DES-TASK-001 平台基础设施与运行底座

> 架构师产出。引用 `../design/architecture.md` 已有设计，不重复抄写；不修改 `design/` 原有文件。
> 对应开发任务计划：`TASK-001-平台基础设施与运行底座.md`。

## 1. 概要

本地单体评测平台底座：Python 标准库 HTTP + SQLite 提供任务/策略存储与同源 `/api`，Vue 3 + TypeScript + Vite 提供八区域工作台，为后续 Trial 执行、评分与分析提供共享数据契约。

## 2. 技术栈

| 层 | 技术选型 | 说明 |
|----|---------|------|
| 架构类型 | 本地单体 | 用户确认，见 `../design/architecture.md` §决策与事实 |
| 后端 | Python 3.10+ 标准库 HTTP + SQLite | 无第三方 Web 框架；Java 示例不作为技术栈要求 |
| 桥接 | Node 22.19+ worker | 调用现有 Codebase `buildPlatform → runManagedAgent`，不复刻 Agent Loop |
| 前端 | Vue 3 + TypeScript(strict) + Vite | DTO 集中管理，禁止 v-html |
| 数据库 | SQLite | 数据默认 `~/.codebase-eval`，`EVAL_DATA_DIR` 可覆盖 |

## 3. 接口设计（api）

| 接口 | 方法 | 路径 | 说明 | 详见 |
|------|------|------|------|------|
| 全局状态 | GET | /api/state | tasks/strategies/experiments/runs/summary/clusters/health | `../design/architecture.md` §API |
| 任务保存 | POST | /api/tasks | 有 id 则编辑 | 同上 |
| 任务删除 | DELETE | /api/tasks/:id | — | 同上 |
| 任务导入 | POST | /api/tasks/import | {tasks:[...]}，逐条校验 | 同上 |
| 任务导出 | GET | /api/tasks/export | {tasks:[...]} | 同上 |
| 策略保存/删除 | POST/DELETE | /api/strategies、/api/strategies/:id | — | 同上 |

同源 `/api`、JSON、防跨站请求；health 只报告凭据变量名与 configured 布尔值，不包含密钥值。

## 4. 数据库设计（db）

| 表名 | 变更类型 | 说明 | 详见 |
|------|---------|------|------|
| entities(kind,id,data) | 新增 | 任务、策略、实验、运行统一存储 | `../design/architecture.md` §数据模型 |
| reviews(id,run_id,data) | 新增 | 不可变人工评分历史账本 | 同上 |

关键字段：任务 id/name/prompt/tags/required/checks[]/rubric/version；策略 id/name/system_prompt/model/base_url/api_key_env/rag_mode(`off|keyword|bm25`)/top_k/input_price/output_price/cache_price（美元每百万 Token，允许 null）。运行保存 task/strategy 快照，编辑不回写历史。

## 5. 前端设计（frontend）

| 页面/组件 | 路径 | 说明 | 详见 |
|----------|------|------|------|
| 工作台骨架 | frontend/src/App.vue | 深色侧边栏 + 浅色工作台，八区域导航 | `../design/architecture.md` §界面 |
| Benchmark | frontend/src/views/BenchmarkView.vue | 题目 CRUD、JSON 导入导出 | 同上 |
| 策略配置 | frontend/src/views/StrategiesView.vue | 系统 Prompt/模型/基址/价格/RAG 表单 | 同上 |
| DTO 与 API 层 | frontend/src/types/index.ts、src/api/index.ts | 界面 DTO 集中管理 | 同上 |
| 通用组件 | frontend/src/components/ | StatusBadge/EmptyState/ModalPanel 等 | 同上 |

空状态不伪造成绩；离线标记常驻；错误可见；Vue 转义所有模型文本。

## 6. 移动端设计（mobile）

N/A - 本次开发任务无移动端功能。

## 7. 业务流程

```
用户 → Benchmark/策略表单 → POST /api/tasks|strategies → 导入/字段校验 → SQLite entities
界面轮询 GET /api/state → 渲染题库/策略/健康状态
启动实验（TASK-002）→ 冻结 task/strategy 快照 + 源码基线 → 每次 Trial 复制独立工作区
```

## 8. 关键算法/规则

- 快照不可变：运行引用冻结的 task/strategy 快照与 source_hash，后续编辑不影响历史运行。
- 导入校验：逐条校验必填字段与 check 类型（`contains|regex|tool_called|no_tool_errors`），非法即拒绝。
- 凭据边界：只存 `api_key_env` 变量名，密钥来自服务进程环境或被 Git 忽略的 `.env`，不进数据库/浏览器。
- 判定契约（供 TASK-003 实现）：`execution_status` 与 `outcome(pass|fail|unknown)` 分离；`completed` 不等于成功。

## 9. 运维/部署设计（ops）

N/A - 本次开发任务无容器化/CI/CD 变更。本地运行：`npm run setup && npm start`，只监听 127.0.0.1（`EVAL_PORT` 可覆盖），不是外网部署方案。重启保留历史，未结束运行标 `interrupted`。

## 10. 约束与边界

- 仅运行本机可信 Codebase 源码快照；独立目录不是 OS 沙箱。
- 源码来自固定的同级 `codebase`，不接受任意工作路径；忽略 `.git/node_modules/dist/data/artifacts/.env/密钥/数据库`，拒绝符号链接。
- 规模上限（由后续任务实现）：最多两个实验 worker、三个排队或运行实验，实验上限 100 次运行。
- 无多用户认证、分布式队列、外网 TLS；不修改 `eval_lab` 或口播稿，不自动提交或推送。