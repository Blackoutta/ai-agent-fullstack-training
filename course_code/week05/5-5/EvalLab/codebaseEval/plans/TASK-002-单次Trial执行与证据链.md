# TASK-002 单次Trial执行与证据链

## 1. 开发任务目标

实现任务 × 策略 × 重复次数的自动实验与单次 Trial 隔离执行，产出可追溯的 Trace / 审计 / 召回证据链，落实 `../requirements/platform.md` R2（自动评测）与 R4（Trace）。

## 2. 开发任务周期

- 开发任务编号：002
- 排期：本地课程项目，按工作包顺序串行交付；实际验收日期见 `../check/validation.md`（2026-10-30）。
- 设计依据：`../design/architecture.md`（数据模型、API、判定）；底座契约来自 TASK-001。

## 3. 工作包排序

工作包内联于本计划（粒度原则见 `README.md`），不另建 WP 文件。

| 序号 | 工作包 | 负责角色 | 依赖 | 产物 |
|------|--------|---------|------|------|
| 1 | WP-201 源码冻结与工作区：实验级干净基线、运行级独立副本、忽略清单、拒绝符号链接、source_hash | 后端开发 | TASK-001 存储 | `backend/engine.py` |
| 2 | WP-202 治理桥接：Node worker 调用现有 `buildPlatform → runManagedAgent`，固定只读六工具、保留审批、独立治理账本、可选模型事件 observer | 后端开发 | 现有 Codebase 接口 | `bridge/worker.ts`、`bridge/client.py` |
| 3 | WP-203 实验调度：任务交错策略串行、预算/超时/取消、进度与失败记录、重启后 `interrupted` 标记 | 后端开发 | WP-201、WP-202 | `backend/engine.py`、`backend/server.py` |
| 4 | WP-204 证据链与 Trace：实际模型消息、工具事件、审计、RAG 召回片段、时间轴；脱敏、不保存思维链 | 后端开发 | WP-203 | `backend/retrieval.py`、run 记录 |
| 5 | WP-205 实验与 Trace 界面：实验启动/取消、进度、Trace 时间轴与层级、冻结快照展示 | 前端开发 | WP-203 API 契约 | `frontend/src/views/ExperimentsView.vue`、`TraceView.vue` 等 |
| 6 | WP-206 执行与证据验收：桥接测试、证据契约回归、真实浏览器离线实验 | 测试 | WP-201~205 | `tests/test_evidence.py`、`bridge/worker.test.ts`、`../check/validation.md` |

## 4. 风险与阻塞项

| 风险 | 影响 | 应对措施 |
|------|------|---------|
| 运行间相互污染 | Trial 不独立 | 每次运行复制独立工作区，禁用共享记忆，新会话 |
| 源码或注释泄漏答案 | 成绩虚高 | 排除 `.env*`/密钥/数据库/参考实现目录；建题时人工审查 |
| 独立目录被误当沙箱 | 安全误解 | 文档明确"不是 OS 沙箱"，仅运行本机可信源码 |
| 取消/超时丢失用量 | 成本失真 | 保留已收到 usage，总用量与总费用标未知 |
| 重启后实验状态不明 | 自动重跑收费实验 | 未结束运行标 `interrupted`，不自动重跑 |

## 5. 交付物清单

- [x] 后端：`../backend/engine.py`、`../backend/retrieval.py`
- [x] 桥接：`../bridge/`
- [x] 前端：实验工作台与 Trace 区域
- [x] 测试：`../tests/test_evidence.py`、`../bridge/worker.test.ts`

## 6. 验收标准

- [x] 任务 × 策略 × 重复次数自动执行；独立源码副本、新会话、预算、取消、进度与失败记录（R2）。
- [x] Trace 含实际模型消息、受治理工具事件、审计、召回证据与时间轴；脱敏、不展示思维链（R4）。
- [x] 受治理工具固定只读（六个读取工具），保留审批，不自动批准；治理账本独立于 Codebase。
- [x] 执行错误、取消、中断与离线回答最终结果为 `unknown`；`completed` 不等于评测成功。
- [x] SSE 缺 DONE、非法 JSON、非法 usage、超时部分用量保留等证据回归通过（见 `../check/validation.md`）。
- [x] 浏览器离线实验跑通并显示真实 Runtime 工具与审计；真实联网仅验收 DeepSeek。

## 7. 权限与风险

自动执行：平台源代码、单元测试、离线端到端验证。
需确认：联网实际模型调用（在 UI 明确选择 live）。
禁止：执行用户上传的任意命令、写入原始 Codebase、访问生产、自动审批、提交密钥。