# 提示词 P5：给审批加修订循环、给灰度加监控回滚循环

把下面整段复制给 AI。它会读 `demos/04_hitl/`，在 `demos/05_loops/` 下生成新格。

---

```
任务：在 demos/04_hitl/ 的基础上，新建 demos/05_loops/，
加两处"循环"，并给每处循环配一个预算上限，保证不会无限打转。

【本步骤业务目标】
循环 A（修订）：审批人可以选择 "revise"（打回修订）。选 revise 时计数 +1，
图退回 intake 重跑一遍检查→分级→审批；修订次数用尽则收尾为 incomplete。
循环 B（灰度回滚）：灰度阶段部署后拉指标，若某阶段不健康则自动回滚，
回滚后退回该阶段重跑；回滚次数用尽则收尾为 rolled_back。

【State 在 04 基础上新增字段】
revision_count: int      # 入口给 0
max_revisions: int       # 入口给（如 2）
rollback_count: int      # 入口给 0
max_rollbacks: int       # 入口给（如 2）
canary_cursor: int       # 入口给 0；1=10% 2=50% 3=100%
current_stage: NotRequired[dict]
metric_samples: NotRequired[Annotated[list[MetricSample], add]]
MetricSample TypedDict：ts / stage / error_rate / healthy
Approval.action 增加 "revise"、"abort"；outcome 增加 "rolled_back"、"incomplete"

【新增工具（04 的 4 个检查工具之外）】
deploy(stage, service, version) → JSON passed=true
query_metrics(service, stage)   → JSON error_rate/p99_ms（固定值即可）

【nodes.py 新增/改动节点】
begin_revision(state): return {revision_count+1, checks:[]}   # 计数递增 + 清本轮 checks
canary_step(state):  cursor = state["canary_cursor"] + 1
                     decision = interrupt({INT-3-<stage>, role=sre, actions:[approve,abort]})
                     # 关键：cursor 只在 return 时提交；resume 后节点从头重跑，
                     # 读到的仍是旧 cursor，因此重算得到同一个 cursor，不会重复推进
                     abort → {outcome:"rejected"}；否则 {canary_cursor:cursor, current_stage}
monitor_window(state):  stage = current_stage.stage
                        # 确定性演示规则：service 以 "flaky" 开头时，canary_10 首遍判不健康；
                        # 该阶段只要回滚过一次（同阶段已有≥1 条 metric_samples）即判健康，能继续
                        metric_samples 追加一条 + current_stage.status=healthy/unhealthy
auto_rollback(state):  {rollback_count+1, canary_cursor:max(0,cursor-1),
                        stages_completed+[f"rolled_back:{stage}"]}
approval_m/h_security 的 actions 里加 "revise"

【graph.py 边变化（循环靠"条件边指回更早的节点"实现）】
route_approval(state) 读 approvals[-1].action：
  approve→deploy_staging  reject/abort→finalize
  revise→ (revision_count>=max_revisions? "stop"→finalize : "revise"→begin_revision)
approval_m / approval_h_security 用 route_approval + APPROVAL_MAP
approval_h_lead approve→approval_h_security，其余同上
begin_revision  → add_edge 回 intake           # ← 循环 A
deploy_staging  → canary_step
canary_step    → route_after_canary {monitor→monitor_window, finalize→finalize}
monitor_window → route_after_monitor {advance→canary_step, unhealthy→auto_rollback, released→finalize}
auto_rollback  → route_after_rollback {retry→canary_step, abort→finalize}  # ← 循环 B

【app.py】submit/status/approve 保留；再加一个 demo()：
场景 A 先 revise 再 approve 再 3 次 SRE approve → 期望 released、revision_count==1
场景 B flaky 服务（max_rollbacks=2）approve + 4 次 SRE → 期望 released、rollback_count==1

【验收 AC】
AC-1: M 级 resume "revise" 后 revision_count==1，且仍停在 approval_m（INT-1）
AC-2: revise→approve→3×SRE approve 后 outcome=="released"，revision_count==1
AC-3: max_revisions=1，连点两次 revise 后 revision_count==1、next==()、outcome=="incomplete"
AC-4: flaky 服务 max_rollbacks=2，approve+4×SRE 后 rollback_count==1、outcome=="released"、
      stages_completed 含以 "rolled_back:" 开头的一项
AC-5: flaky 服务 max_rollbacks=0，approve+SRE 后 rollback_count==1、outcome=="rolled_back"、next==()

【明确不做】
- 不引入 Mermaid/langgraph dev/可视化（下一步）
- 不接真实大模型、不接真实 metrics（回滚由确定性 mock 规则触发）
- approvals / metric_samples 用 add reducer，只返回本次新增一条，不要回传整个列表

【风格】interrupt 载荷可 JSON 序列化；
begin_revision 只动计数与 checks，不重置 change_level（下一轮 classify_change 覆盖）；
auto_rollback 把 canary_cursor 减 1，使下一轮 canary_step 重新部署同一阶段。
```

---

## 拿到生成结果后做什么

```bash
cd release_pipeline/demos/05_loops
python app.py                 # 跑两个 demo 场景
python -m pytest tests/ -v    # 5 条 AC
```
