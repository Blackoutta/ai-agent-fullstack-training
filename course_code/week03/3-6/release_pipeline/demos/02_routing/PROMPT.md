# 提示词 P2：在 01 主线基础上加条件路由

把下面整段复制给 AI。它会读 `demos/01_minimal/` 已有代码，
然后在 `demos/02_routing/` 下生成**带条件分支**的下一格。

---

```
任务：在 demos/01_minimal/ 主线最小版的基础上，
新建 demos/02_routing/，加一个"变更等级路由"分支。

【本步骤业务目标】
工单受理后多走一步"变更分级"：根据 patch_diff 内容把变更打成 L / M / H 三档，
L 走自动放行，M 走 Tech Lead 一档审批，H 走双审批。
**本步骤不引入 interrupt，审批节点先用占位函数模拟通过**。

【State 在 01 基础上新增字段】
patch_diff: str                                # 入口提供
change_level: NotRequired[Literal["L","M","H"]]  # classify_change 写入
approver_count: NotRequired[int]                 # 审批节点写入：0/1/2

【节点清单（在 01 的 7 个节点基础上新增 4 个）】
classify_change    根据 patch_diff 计算等级，规则：
                   含 auth/payment/password/token → "H"
                   len(diff) > 800 → "M"
                   其余 → "L"
approval_auto_L    approver_count=0
approval_lead_M    approver_count=1
approval_dual_H    approver_count=2

【边（关键变化）】
START → intake → classify_change
classify_change 接 add_conditional_edges，路由函数：
  def route_by_level(state) -> Literal["L","M","H"]: return state["change_level"]
映射：{"L":"approval_auto_L","M":"approval_lead_M","H":"approval_dual_H"}
三个审批节点都各自 add_edge → deploy_staging
之后接 01 的 smoke_test → canary_10 → canary_50 → canary_100 → finalize → END

【Checkpointer】沿用 InMemorySaver()，本步骤还不需要持久化。

【验收 AC】
AC-1: 短 diff ("tiny config tweak") → change_level=="L", approver_count==0, outcome=="released"
AC-2: 长度 1200 的 diff → change_level=="M", approver_count==1
AC-3: 含 "auth token" 的 diff → change_level=="H", approver_count==2
AC-4: 三种 diff 都必须把 stages_completed 走完
      ["staging","smoke","canary_10","canary_50","canary_100"]

【明确不做】
- 不引入 @tool、ToolNode（下一步）
- 不引入 interrupt、Command（更后面的步骤）
- 不引入循环
- 不引入 SQLite Checkpointer
- 不接 DeepSeek（分级先用规则函数实现）

【风格】节点是函数；路由函数返回 Literal[...]；
add_conditional_edges 三参数形式（source, path, path_map）。
```

---

## 拿到生成结果后做什么

```bash
cd release_pipeline/demos/02_routing
python app.py                          # 看 3 种 diff 走 3 条分支
python -m pytest tests/ -v             # 4 条 AC 全过
```
