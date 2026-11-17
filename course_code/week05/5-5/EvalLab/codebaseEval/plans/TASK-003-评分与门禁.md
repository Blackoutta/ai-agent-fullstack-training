# TASK-003 评分与门禁

## 1. 开发任务目标

实现程序检查、证据约束 LLM Judge 与人工评审三层评分及其优先级判定，并定义回归门禁规则，落实 `../requirements/platform.md` R5（评分）与 R9 的门禁判定部分。

## 2. 开发任务周期

- 开发任务编号：003
- 排期：本地课程项目，按工作包顺序串行交付；实际验收日期见 `../check/validation.md`（2026-10-30）。
- 设计依据：`../design/architecture.md` §判定；执行与证据链来自 TASK-002。

## 3. 工作包排序

工作包内联于本计划（粒度原则见 `README.md`），不另建 WP 文件。

| 序号 | 工作包 | 负责角色 | 依赖 | 产物 |
|------|--------|---------|------|------|
| 1 | WP-301 程序检查器：`contains/regex/tool_called/no_tool_errors` 四类 check 执行与结果记录 | 后端开发 | TASK-002 run 记录 | `backend/judge.py` |
| 2 | WP-302 证据约束 LLM Judge：仅核对提供的证据、结构化 pass/fail/unknown、证据不足必须 unknown、不用于 offline | 后端开发 | WP-301 | `backend/judge.py`、`POST /api/runs/:id/judge` |
| 3 | WP-303 人工评审账本：评审者/结论/理由必填、历史追加不可变、不能覆盖程序失败或运行错误 | 后端开发 | TASK-001 reviews 表 | `backend/store.py`、`POST /api/runs/:id/reviews` |
| 4 | WP-304 总体判定与门禁：核心任务程序失败优先、Judge 未执行/unknown 总体 unknown、回归 hold 规则 | 后端开发 | WP-301~303 | `backend/analysis.py` |
| 5 | WP-305 评审中心界面：Judge 重评、人工评审表单、评分历史与分歧展示 | 前端开发 | WP-302/303 API 契约 | `frontend/src/views/ReviewsView.vue`、`components/ReviewPanel.vue` |
| 6 | WP-306 评分验收：判定优先级、重复 Judge 费用累计、缓存计价、证据键校验回归 | 测试 | WP-301~305 | `tests/test_evidence.py`、`../check/validation.md` |

## 4. 风险与阻塞项

| 风险 | 影响 | 应对措施 |
|------|------|---------|
| 人工把运行错误改成成功 | 成绩造假 | 判定优先级硬编码：程序失败/执行错误不可被人工覆盖 |
| Judge 无证据瞎判 | 结论不可信 | 只核对提供的证据键，证据截断/不足必须 unknown |
| 同模型自评偏差 | 结论偏乐观 | README 明示同模型自评局限，重要结论需独立人工定标 |
| 重复 Judge 费用漏计 | 成本低估 | Judge Token/时间/费用累计计入运行成本并单列 |
| 离线样本混入真实成绩 | 门禁误放行 | offline 运行不参与 Judge，报告永远 hold |

## 5. 交付物清单

- [x] 后端：`../backend/judge.py`、`../backend/analysis.py`（判定部分）
- [x] 前端：评审中心区域
- [x] 测试：判定与费用相关回归用例

## 6. 验收标准

- [x] 程序检查、证据约束 LLM Judge、带评审者和理由的人工评分历史可用（R5）。
- [x] 运行错误不能被人工改成成功；Judge 与人工分歧保留。
- [x] 核心任务程序失败优先；程序通过但 Judge 未执行/unknown 时总体 unknown。
- [x] live 回答须同时通过程序检查和 Judge 或人工语义评审才为 `pass`。
- [x] 门禁规则：缺配对、核心任务失败/未知、退化、offline 实验均 `hold`，不允许发布通过（R9 判定部分，报告实现见 TASK-004）。
- [x] 重复 Judge 费用/Token/时间累计、缓存计价、非法证据键回归通过（见 `../check/validation.md`）。
- [ ] 追加人工评审的浏览器端到端操作（IDE WebView 超时未完成；人工历史与优先级已由后端与前端组件测试覆盖，见 `../check/validation.md`）。

## 7. 权限与风险

自动执行：评分器源代码、单元测试、离线判定验证。
需确认：真实 Judge 联网调用（消耗真实 Token）。
禁止：自动审批、伪造评分、把离线/未知样本放行门禁、提交密钥。