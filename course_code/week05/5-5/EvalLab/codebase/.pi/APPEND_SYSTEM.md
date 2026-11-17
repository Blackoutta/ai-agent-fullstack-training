## Subagents in this repository

Project-level subagents live in `.pi/agents/`. When calling the `subagent` tool, always pass `agentScope: "both"` so these definitions are discovered.

Coding helpers:

- `scout` — read-only reconnaissance (fornace-fast)
- `planner` — implementation planning (fornace-reasoning)
- `worker` — code implementation (fornace-max)
- `reviewer` — code review (fornace-max)

Review panel (read-only, no file edits, no repo commands, no further delegation):

- `supervisor` — 拆任务、调度、核对专家结论并做最终决定 → 任务安排、待补查事项、最终结论
- `architecture` — 目录结构、模块边界、依赖方向、架构问题 → 调用关系、边界问题、调整建议
- `test` — 测试覆盖率、测试质量、缺失测试 → 已有测试能证明什么、还缺哪些场景
- `security` — 鉴权、注入、敏感信息、权限边界 → 触发条件、源码依据、影响、修复建议
- `performance` — 慢查询、循环、缓存、性能隐患 → 风险位置、判断依据、测量建议
- `documentation` — 文档、注释、知识库内容 → 与实现不一致、过期或缺失的内容
- `report` — 合并专家结果、处理冲突、生成报告草稿 → 保留来源、优先级、未验证项（无工具）

### Dispatching rules

- Resolve every skill reference to an absolute path (e.g. `/Users/<user>/.pi/agent/skills/<name>/SKILL.md`) and put it in the task text. Never pass a relative path or a bare skill name; the child cwd can differ.
- Panel flow: `supervisor` plans first, then dispatch the relevant experts in parallel, then `report` merges. Give each expert an explicit scope (directories/files) and the question it must answer.
- `report` receives only the experts' findings plus evidence locations in the task body. It has an empty toolset by design (`tools: none`), so never ask it to read or search.
- Experts return findings with file:line evidence, conflicts, and uncovered areas. Do not ask them to fix code.
