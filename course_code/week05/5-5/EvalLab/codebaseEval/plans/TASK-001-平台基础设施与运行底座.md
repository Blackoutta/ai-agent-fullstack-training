# TASK-001 平台基础设施与运行底座

## 1. 开发任务目标

搭建本地单体评测平台的数据、API 与界面底座，落实 `../requirements/platform.md` R1（Benchmark 管理）与 R3（策略对比配置），为 TASK-002/003/004 提供共享契约。

## 2. 开发任务周期

- 开发任务编号：001
- 排期：本地课程项目，按工作包顺序串行交付；实际验收日期见 `../check/validation.md`（2026-10-30）。
- 设计依据：`DES-TASK-001-平台基础设施与运行底座.md`、`../design/architecture.md`。

## 3. 工作包排序

工作包内联于本计划（粒度原则见 `README.md`），不另建 WP 文件。

| 序号 | 工作包 | 负责角色 | 依赖 | 产物 |
|------|--------|---------|------|------|
| 1 | WP-101 数据模型与存储：SQLite `entities(kind,id,data)`、`reviews` 账本，任务/策略字段与版本快照 | 后端开发 | 已确认设计 | `backend/store.py`、`backend/contracts.py` |
| 2 | WP-102 任务与策略 API：CRUD、JSON 导入导出、导入校验、同源 `/api` HTTP 骨架与健康检查 | 后端开发 | WP-101 | `backend/server.py`、`backend/common.py` |
| 3 | WP-103 前端底座：Vue 3 + TS + Vite 工程、八区域导航、DTO 集中管理、Benchmark 与策略表单 | 前端开发 | WP-102 API 契约 | `frontend/` |
| 4 | WP-104 底座验收：存储/HTTP/导入校验测试、前端类型检查与构建 | 测试 | WP-101~103 | `tests/test_platform.py`、`../check/validation.md` |

## 4. 风险与阻塞项

| 风险 | 影响 | 应对措施 |
|------|------|---------|
| 快照被后续编辑污染 | R3 对比失真 | 运行时冻结 task/strategy 快照，编辑不回写历史运行 |
| 密钥进入数据库或浏览器 | 凭据泄漏 | 策略只存 `api_key_env` 变量名；health 只报告 configured 布尔值 |
| 导入非法任务数据 | 评测程序崩溃 | 导入逐条校验字段与 check 类型，拒绝非法 JSON |
| 模型文本注入界面 | XSS | Vue 转义所有模型文本，禁止 v-html |

## 5. 交付物清单

- [x] 后端：`../backend/`（存储、契约、HTTP）
- [x] 前端：`../frontend/`（底座与 Benchmark/策略区域）
- [x] 测试：`../tests/test_platform.py`
- [x] 运维：N/A —— 本地 `npm run setup && npm start`，无容器化/外网部署

## 6. 验收标准

- [x] 任务新增、编辑、删除、JSON 导入导出可用；运行保留任务版本快照（R1）。
- [x] 策略含系统 Prompt、模型、基址、凭据环境变量名、价格、RAG 模式/top-k；配置快照不可被后续编辑改变（R3）。
- [x] `GET /api/state` 返回 tasks/strategies/experiments/runs/summary/clusters/health。
- [x] 数据默认写入 `~/.codebase-eval`（`EVAL_DATA_DIR` 可覆盖），不写入课程代码目录。
- [x] 后端测试、前端 strict 类型检查与生产构建通过（见 `../check/validation.md`）。

## 7. 权限与风险

自动执行：平台源代码、单元测试、离线端到端验证。
需确认：联网实际模型调用、部署到外网。
禁止：生产数据、写入原始 Codebase、提交密钥、把缺失价格当作免费。