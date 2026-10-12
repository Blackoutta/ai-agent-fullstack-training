# SDD：微服务发布审批流水线（参考样例）

> 本文件是 `SDD-TEMPLATE.md` 的完整填写示例，对应 `release_pipeline/` 工程。
> 复用方法：复制本文件 → 改 §0/§1 → 按新场景重写 §3/§4/§5/§9 → 喂给 AI。

---

## §0 身份卡

**一句话定位**：
> 本系统是一个**微服务发布审批工作流引擎**，它在**开发者提交上线工单**后，按
> **自动检查 → 变更分级 → 多级人工审批 → 预发部署 → 灰度推进 → 监控/回滚** 顺序执行，
> 最终产出**带审计记录的发布报告**。

**关键词清单**：发布、审批、灰度、回滚、checkpoint、interrupt、ToolNode、Mermaid。

**边界**：关键词外不引入新概念（不做服务网格、不做多集群编排）。

---

## §1 业务场景

**触发条件**：CLI `submit` 命令或外部 webhook 调用入口，提交一张工单。

**主要角色**：
- **开发者**：提交工单与 diff
- **Tech Lead**：M/H 级审批人
- **Security**：H 级第二审批人
- **SRE**：每次灰度推进的确认人
- **Agent**：编排执行体，不做决策只做调度

**最终产出**：`reports/<ticket>.json` + 终态 `outcome ∈ {released, rejected, rolled_back, blocked, incomplete}`。

**边界**：角色清单闭包；不引入 PM、QA、Compliance 等额外角色。

---

## §2 技术栈

```
langgraph>=0.2.50
langchain-core>=0.3
langchain-openai>=0.2
langgraph-checkpoint-sqlite>=2.0
pydantic>=2.7
python-dotenv>=1.0
PyYAML>=6.0
typer>=0.12
rich>=13.7
httpx>=0.27
pytest>=8.0
pytest-asyncio>=0.23
```

Python 3.11+。

---

## §3 状态契约

```python
class ReleaseState(TypedDict):
    ticket_id: str
    service: str
    version: str
    patch_diff: str
    revision_count: int
    rollback_count: int
    max_revisions: int
    max_rollbacks: int
    canary_cursor: int
    messages: NotRequired[Annotated[list[AnyMessage], add_messages]]
    checks: NotRequired[Annotated[list[CheckResult], add]]
    approvals: NotRequired[Annotated[list[Approval], add]]
    change_level: NotRequired[Literal["L","M","H"]]
    current_stage: NotRequired[DeployStage]
    metric_samples: NotRequired[Annotated[list[MetricSample], add]]
    outcome: NotRequired[Literal["released","rejected","rolled_back","blocked","incomplete"]]
    report_summary: NotRequired[str]
    report_path: NotRequired[str]
```

子结构：`CheckResult / Approval / DeployStage / MetricSample`（见 `state.py`）。

---

## §4 节点清单（仅签名）

| # | 节点名 | 类型 | 输入 | 输出 |
|---|---|---|---|---|
| 1 | `intake` | 普通 | ticket_id, service, version, patch_diff | messages（带 4 路 tool_calls） |
| 2 | `tool_checks` | **ToolNode** | messages | messages（追加 4 条 ToolMessage） |
| 3 | `collect_checks` | 普通 | messages | checks, messages=[] |
| 4 | `classify_change` | LLM 结构化 | patch_diff, checks | change_level |
| 5 | `approval_m` | **interrupt** INT-1 | ticket, diff, checks | approvals |
| 6 | `approval_h_lead` | **interrupt** INT-2A | ticket, diff | approvals |
| 7 | `approval_h_security` | **interrupt** INT-2B | ticket, diff | approvals |
| 8 | `deploy_staging` | ToolNode(deploy) | service, version | current_stage |
| 9 | `smoke_test` | ToolNode(query_metrics) | service | metric_samples, current_stage |
| 10 | `begin_revision` | 普通 | revision_count | revision_count+1, 清空字段 |
| 11 | `canary_step` | **interrupt** INT-3-* + ToolNode | canary_cursor | canary_cursor+1, current_stage |
| 12 | `monitor_window` | ToolNode(query_metrics) | current_stage | metric_samples, current_stage |
| 13 | `auto_rollback` | ToolNode(rollback) | current_stage | rollback_count+1, canary_cursor-1 |
| 14 | `finalize` | LLM + 落盘 | 全部 | outcome, report_summary, report_path |

签名：
```python
def intake(state: ReleaseState) -> dict: ...
def collect_checks(state: ReleaseState) -> dict: ...
def classify_change(state: ReleaseState) -> dict: ...
def approval_m(state: ReleaseState) -> dict: ...
def approval_h_lead(state: ReleaseState) -> dict: ...
def approval_h_security(state: ReleaseState) -> dict: ...
async def deploy_staging(state: ReleaseState) -> dict: ...
async def smoke_test(state: ReleaseState) -> dict: ...
def begin_revision(state: ReleaseState) -> dict: ...
async def canary_step(state: ReleaseState) -> dict: ...
async def monitor_window(state: ReleaseState) -> dict: ...
async def auto_rollback(state: ReleaseState) -> dict: ...
def finalize(state: ReleaseState) -> dict: ...   # sync：内部用同步文件 I/O，避免 langgraph dev blockbuster 拦截
```

---

## §5 边与路由

```
START -> intake -> tool_checks -> collect_checks
collect_checks -[route_after_checks]-> {ok: classify_change, blocked: finalize}
classify_change -[route_by_level]-> {L: deploy_staging, M: approval_m, H: approval_h_lead}
approval_m -[route_approval]-> APPROVAL_MAP
approval_h_lead -> approval_h_security -[route_approval]-> APPROVAL_MAP
APPROVAL_MAP = {approve: deploy_staging, revise: begin_revision, reject: finalize, stop: finalize}
deploy_staging -> smoke_test
smoke_test -[route_after_smoke]-> {pass: canary_step, fail: begin_revision, stop: finalize}
begin_revision -> intake                                       # 循环 1
canary_step -> monitor_window
monitor_window -[route_after_monitor]-> {advance: canary_step, unhealthy: auto_rollback, released: finalize}
auto_rollback -[route_after_rollback]-> {retry: canary_step, abort: finalize}  # 循环 2/3
finalize -> END
```

路由签名：
```python
def route_after_checks(state) -> Literal["ok","blocked"]: ...
def route_by_level(state) -> Literal["L","M","H"]: ...
def route_approval(state) -> Literal["approve","revise","reject","stop"]: ...
def route_after_smoke(state) -> Literal["pass","fail","stop"]: ...
def route_after_monitor(state) -> Literal["advance","unhealthy","released"]: ...
def route_after_rollback(state) -> Literal["retry","abort"]: ...
```

循环预算：`max_revisions=2`，`max_rollbacks=2`。

---

## §6 工具

| 工具 | real | mock | 故障开关 |
|---|---|---|---|
| `build_service` | `./scripts/build.sh` | 固定 JSON | `simulate_build_fail` |
| `run_unit_tests` | `npm test` | 42/0 | — |
| `security_scan` | `./scripts/scan.sh` | 无高危 | `simulate_security_block` |
| `dependency_audit` | `npm audit` | 无 CVE | — |
| `deploy` | `kubectl apply` | 部署成功 | — |
| `query_metrics` | Prometheus | 随机健康 | `simulate_canary_unhealthy` |
| `rollback` | `kubectl rollout undo` | 成功 | — |

切换：`config/tools.yaml` 中每个工具的 `mode: real|mock`。

**Studio / dev server 集成**：`langgraph.json` + `studio_graph.py` 暴露 `graph = build_graph(None)`，
由 `langgraph dev` 注入内存 checkpointer，HTTP API 端口 8123；生产仍走 `app.py` + AsyncSqliteSaver。

---

## §7 Interrupt 与 Checkpoint

| 编号 | 节点 | payload 关键字段 | 恢复 schema |
|---|---|---|---|
| INT-1 | `approval_m` | ticket_id, diff, checks_summary | `{action, actor, feedback, role:"tech_lead"}` |
| INT-2A | `approval_h_lead` | ticket_id, diff | `{action, actor, feedback, role:"tech_lead"}` |
| INT-2B | `approval_h_security` | ticket_id, diff | `{action, actor, feedback, role:"security"}` |
| INT-3-* | `canary_step` | stage, ticket_id | `{action, actor, feedback, role:"sre"}` |

`thread_id = ticket_id`。Checkpointer：`AsyncSqliteSaver`，路径 `$CHECKPOINT_DB`。

跨进程恢复：重启后入口需重建 model 客户端 + 重读 tools.yaml；State 由 Checkpointer 还原。

---

## §8 验收标准

```
AC-1: L 级 diff（短、无 auth/payment 关键字）→ 跳过 INT-1/INT-2，仅需 3 次 INT-3 SRE 确认 → outcome=released
AC-2: M 级 diff（长度 > 800）→ 1 次 tech_lead 审批 → released
AC-3: H 级 diff（含 auth/payment）→ tech_lead + security 两次审批 → released
AC-4: 任一审批 reject → outcome=rejected，未发生 deploy
AC-5: simulate_canary_unhealthy=true → 触发 auto_rollback；达 max_rollbacks 后 outcome=rolled_back
AC-6: finalize 必须落盘 reports/<ticket>.json
AC-7: state 字段集合 ⊆ ReleaseState.__annotations__（闭包检查）
AC-8: 进程在 INT-1 处被杀，重启后 status 能读出待审批 payload
AC-9: begin_revision 回环受 max_revisions 限制，不出现无限循环
AC-10: ToolNode 并行执行 4 个工具，checks 列表长度为 4
AC-11: route_by_level 返回值 ⊆ {"L","M","H"}
AC-12: Mermaid 文本与 PNG 至少一个能产出
```

---

## §9 明确不做

- 不做真实 Kubernetes 集成（mock 即够演示）
- 不做权限/认证系统（actor 字段由 CLI 显式传入）
- 不做 Web UI（仅 CLI + Mermaid 可视化）
- 不做多租户隔离
- 不做服务网格 / 多集群编排
- 不做指标存储（MetricSample 仅在内存 + checkpoint）
- 不做 Slack/邮件通知
- 不实现真实回滚的时间旅行

---

## 附：交付物

见 `GENERATION-ORDER.md`。
