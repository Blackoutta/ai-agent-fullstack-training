# check 目录 — 审查文档（输出）

本目录存放 skill 执行过程中自动生成的审查与报告文档。

## 产物清单

| 文件 | 阶段 | 说明 |
|------|------|------|
| `00-env/` | 0 环境准备 | 环境准备阶段产物（路径确认、输入状态、关键指标、范围定义、架构决策、流水线状态、流程检查清单） |
| `01-requirements.md` | 1 需求分析 | PM 产出的需求理解要点与确认记录 |
| `02-design.md` | 2/3 设计评审 | 由设计文档生成的可勾选检查单 |
| `04-review.md` | 4 设计符合性 | 代码与设计的逐条符合性核对报告 |
| `05-quality.md` | 5 代码质量 | 后端阿里规范 + 前端规范违反项审查报告 |
| `06-coverage.md` | 6 测试覆盖 | 后端 Jacoco + 前端 Vitest 覆盖率汇总与明细 |
| `07-delivery.md` | 7 交付汇总 | 最终交付清单与质量门禁结论 |

## 模板文件与 check 文件对应关系

| check 文件 | 对应模板文件 | 生成时机 | 生成角色 |
|------------|-------------|---------|---------|
| `00-env/*` | 无模板，直接生成 | 阶段 0 | 所有角色 |
| `01-requirements.md` | 无模板，直接生成 | 阶段 1 | PM |
| `02-design.md` | `templates/design-review-checklist.md` | 阶段 2 或 3 | 架构师 |
| `03-framework.md` | `templates/framework-delivery-checklist.md` | 阶段 3 | 架构师 |
| `04-review.md` | `templates/design-conformance-review.md` | 阶段 4 | 架构师（主审） |
| `05-quality.md` | `templates/code-quality-review.md` | 阶段 5 | 架构师（主审） |
| `06-coverage.md` | `templates/test-coverage-report.md` | 阶段 6 | 架构师（汇总） |
| `07-delivery.md` | `templates/delivery-summary.md` | 阶段 7 | 运维角色（汇总） |

## 规则

- 审查文档由 skill 自动生成，每次审查后覆盖更新，保持与最新代码一致。
- 引用代码位置统一用 `文件路径:行号`。
- 审查未全部通过前，`07-delivery.md` 不得标记为「交付完成」。
