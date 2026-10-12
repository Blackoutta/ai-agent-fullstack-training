# 提示词 P1：生成主线最小版

把下面整段复制给 AI（Cursor / Qoder / Claude / 通义灵码都行），
让它生成 `demos/01_minimal/` 全套文件。

---

```
任务：用 LangGraph 生成一个微服务发布审批流水线工程的"主线最小版"。

【工程目录】release_pipeline/demos/01_minimal/
【要生成的文件】
  state.py    状态 TypedDict
  nodes.py    7 个节点函数
  graph.py    StateGraph 装配
  app.py      一行命令能跑完的 CLI
  tests/test_minimal.py  验收测试

【业务目标（本步骤只跑主线，不含任何分支）】
开发者提交工单 → 跑 4 项前置检查（构建/单测/安全扫描/依赖审计，全部直接通过）
→ 预发部署 → 冒烟测试 → 灰度 10% → 灰度 50% → 灰度 100% → 输出发布报告。

【State 字段（TypedDict，闭世界，不要新增）】
class ReleaseState(TypedDict):
    ticket_id: str
    service: str
    version: str
    checks_passed: int
    stages_completed: NotRequired[list[str]]
    outcome: NotRequired[str]
    report_path: NotRequired[str]

【节点清单（7 个，函数命名锁定）】
intake          受理 + 跑 4 项检查（用同步内联函数模拟，不要调工具）
deploy_staging  往 stages_completed 追加 "staging"
smoke_test      追加 "smoke"
canary_10       追加 "canary_10"
canary_50       追加 "canary_50"
canary_100      追加 "canary_100"
finalize        写 reports/{ticket_id}.json，置 outcome="released"

【边（线性，普通 add_edge，不要条件路由）】
START → intake → deploy_staging → smoke_test → canary_10 → canary_50 → canary_100 → finalize → END

【Checkpointer】用 langgraph.checkpoint.memory.InMemorySaver()，不要 SQLite。

【验收 AC（写成 pytest 用例，每条一个 test_ 函数）】
AC-1: ainvoke 跑完后 outcome == "released"
AC-2: stages_completed 依次为 ["staging","smoke","canary_10","canary_50","canary_100"]
AC-3: checks_passed == 4
AC-4: report_path 文件存在且能加载

【明确不做】
- 不引入 langchain 工具、不引入 @tool、不引入 ToolNode
- 不做 interrupt、不做 Command
- 不做条件路由（add_conditional_edges 一次都不要出现）
- 不做循环（任何回边都不要）
- 不写多租户、权限、Web UI

【风格】节点是函数不要类；状态用 TypedDict；类型注解齐全；不写注释；
所有文件总行数控制在 200 行以内。

【依赖】langgraph>=0.2 / Python 3.11+ / pytest。无需 DeepSeek 密钥
（本步骤零 LLM 调用）。
```

---

## 拿到生成结果后做什么

```bash
cd release_pipeline/demos/01_minimal
python -m app                              # 看到 7 行 ▶ 节点输出 + 终态
python -m pytest tests/ -v                 # 4 条 AC 全过
```

跑完即可进入 P2（条件路由）。
