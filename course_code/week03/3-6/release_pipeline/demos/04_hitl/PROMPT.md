# 提示词 P4：把占位审批升级为真 interrupt + SQLite Checkpoint

把下面整段复制给 AI。它会读 `demos/03_toolnode/`，在 `demos/04_hitl/` 下生成新格。

---

```
任务：在 demos/03_toolnode/ 的基础上，新建 demos/04_hitl/，
把"3 个审批节点的占位返回值"升级为真正的 LangGraph interrupt 暂停 +
Command 恢复 + SQLite Checkpoint 跨进程持久化。

【本步骤业务目标】
M 级需要 tech_lead 批准（INT-1）。
H 级需要两段串行审批：先 tech_lead（INT-2A），再 security（INT-2B）。
图执行到审批节点时要"暂停并返回待批内容"，用户稍后提交决定再继续。
进程退出后，凭同一个 thread_id + 同一个 SQLite 文件能找回待批位置。

【State 在 03 基础上新增字段】
class Approval(TypedDict):
    interrupt_id: Literal["INT-1", "INT-2A", "INT-2B"]
    role:   Literal["tech_lead", "security"]
    action: Literal["approve", "reject"]
    actor: str
    feedback: str

approvals: NotRequired[Annotated[list[Approval], add]]   # add reducer：多次审批累加审计

【新增文件 checkpointer.py】
用 langgraph.checkpoint.sqlite 的同步 SqliteSaver。
@contextmanager open_checkpointer()：读 env CHECKPOINT_DB（默认 ./checkpoints_04.sqlite），
mkdir 父目录后 from_conn_string 打开，yield saver。

【nodes.py 三个审批节点改成真 interrupt】
approval_m(state):        decision = interrupt({...INT-1, role=tech_lead, diff_preview, actions})
approval_h_lead(state):   decision = interrupt({...INT-2A, role=tech_lead})
approval_h_security(state):decision = interrupt({...INT-2B, role=security})
每个节点用 _as_approval(decision, iid, role) 把 resume 回来的 dict 转成 Approval，
返回 {"approvals": [ ... ]}。approval_auto_L 仍返回 approver_count=0，不 interrupt。

【graph.py 边变化】
审批节点后面全部改成 add_conditional_edges：
  route_after_approval(state): 任一 approval.action=="reject" → "reject"，否则 "approve"
  approval_m        → approve:deploy_staging  / reject:finalize
  approval_h_lead   → approve:approval_h_security / reject:finalize
  approval_h_security → approve:deploy_staging / reject:finalize

【新增 app.py：submit / status / approve 三个命令行】
submit ticket service version diff   → invoke 初始状态，打印 next + 待审批清单
status ticket                        → get_state 打印快照 JSON + 待审批
approve ticket action actor [feedback] → get_state 确认在等待后，invoke(Command(resume={...}))
待审批从 snapshot.tasks[*].interrupts[*].value 读取，不要用 __interrupt__ 旧写法。

【验收 AC】
AC-1: M 级（长 diff）invoke 后 snap.next == ("approval_m",)，
      snap.tasks[0].interrupts[0].value["interrupt_id"] == "INT-1"
AC-2: resume approve 后 outcome=="released"，approvals 角色列表 == ["tech_lead"]
AC-3: H 级先停在 approval_h_lead（INT-2A），resume 后停在 approval_h_security（INT-2B），
      再 resume 后 released，approvals 长度 == 2
AC-4: 跨进程：第一个 contextmanager 跑到 INT-1 暂停后关闭；
      新进程重新 open_checkpointer() 打开同一个 SQLite，get_state 能找回 ticket 与 next，
      Command(resume) 后 released，approvals[0].actor == 提交的 actor
AC-5: reject 短路：M 级 resume reject 后 outcome=="rejected"，stages_completed == []

【明确不做】
- 不引入循环 / 重试 / 回滚（下一步）
- 不引入可视化、langgraph dev（下一步）
- 不调真实大模型，审批决定全部由 Command(resume=...) 人工传入
- 不用 AsyncSqliteSaver，本格用同步 SqliteSaver 让 CLI 演示更直接

【风格】interrupt 载荷只用可 JSON 序列化的字段；
_as_approval 对非法 action 一律降级为 reject（安全默认）；
approvals 用 add reducer，节点只返回"本次新增的一条"，不要回传整个列表。
```

---

## 拿到生成结果后做什么

```bash
cd release_pipeline/demos/04_hitl
python -m pytest tests/ -v

# 手动体验跨进程恢复（两次独立进程）：
python app.py submit T-042 auth-svc 1.0.0 "$(python -c 'print("x"*1200)')"
python app.py status T-042
python app.py approve T-042 approve alice "看起来没问题"
```
