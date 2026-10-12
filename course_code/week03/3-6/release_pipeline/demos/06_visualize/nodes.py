"""05 节点：在 04 的中断审批之上，加两处循环。

循环 A（修订）：审批给 "revise" → begin_revision 计数 +1 → 边退回 intake 重跑。
循环 B（灰度回滚）：canary_step → monitor_window，指标不健康 → auto_rollback →
                     退回 canary_step 重跑同一阶段（游标先 -1 再 +1）。
两处循环都有预算上限，超限即收尾，绝不无限打转。
"""
from __future__ import annotations

import json
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Literal

from langchain_core.messages import AIMessage, ToolMessage
from langgraph.types import interrupt

from state import Approval, MetricSample, ReleaseState

STAGE_BY_CURSOR = {1: "canary_10", 2: "canary_50", 3: "canary_100"}


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _as_approval(decision: object, iid: str, role: str) -> Approval:
    d = decision if isinstance(decision, dict) else {}
    action = d.get("action", "reject")
    if action not in ("approve", "reject", "revise", "abort"):
        action = "reject"
    return Approval(interrupt_id=iid, role=role, action=action,
                    actor=str(d.get("actor", "unknown")),
                    feedback=str(d.get("feedback", "")))


def intake(state: ReleaseState) -> dict:
    fanout = AIMessage(
        content="",
        tool_calls=[
            {"name": "build_service",
             "args": {"service": state["service"], "version": state["version"]},
             "id": "call_build"},
            {"name": "run_unit_tests",
             "args": {"service": state["service"]}, "id": "call_unit"},
            {"name": "security_scan",
             "args": {"diff": state.get("patch_diff", "")}, "id": "call_scan"},
            {"name": "dependency_audit",
             "args": {"service": state["service"]}, "id": "call_audit"},
        ],
    )
    return {"messages": [fanout]}


def collect_checks(state: ReleaseState) -> dict:
    results = []
    for msg in state.get("messages", []):
        if not isinstance(msg, ToolMessage):
            continue
        try:
            payload = json.loads(msg.content)
        except (TypeError, json.JSONDecodeError):
            payload = {"tool": msg.name, "passed": False, "summary": ""}
        results.append({"name": payload.get("tool", msg.name or "unknown"),
                        "passed": bool(payload.get("passed", False)),
                        "summary": payload.get("summary", "")})
    return {"checks": results, "checks_passed": sum(1 for r in results if r["passed"]),
            "messages": []}


def classify_change(state: ReleaseState) -> dict:
    diff = state.get("patch_diff", "")
    lowered = diff.lower()
    if any(k in lowered for k in ("auth", "payment", "password", "token")):
        level: Literal["L", "M", "H"] = "H"
    elif len(diff) > 800:
        level = "M"
    else:
        level = "L"
    return {"change_level": level}


def approval_auto_L(state: ReleaseState) -> dict:
    return {"approver_count": 0}


def approval_m(state: ReleaseState) -> dict:
    decision = interrupt({
        "interrupt_id": "INT-1", "role": "tech_lead",
        "ticket_id": state["ticket_id"],
        "revision_count": state["revision_count"],
        "actions": ["approve", "reject", "revise"],
    })
    return {"approvals": [_as_approval(decision, "INT-1", "tech_lead")]}


def approval_h_lead(state: ReleaseState) -> dict:
    decision = interrupt({
        "interrupt_id": "INT-2A", "role": "tech_lead",
        "ticket_id": state["ticket_id"],
        "actions": ["approve", "reject", "revise"],
    })
    return {"approvals": [_as_approval(decision, "INT-2A", "tech_lead")]}


def approval_h_security(state: ReleaseState) -> dict:
    decision = interrupt({
        "interrupt_id": "INT-2B", "role": "security",
        "ticket_id": state["ticket_id"],
        "actions": ["approve", "reject", "revise"],
    })
    return {"approver_count": 2,
            "approvals": [_as_approval(decision, "INT-2B", "security")]}


def begin_revision(state: ReleaseState) -> dict:
    # 只递增计数 + 清空本轮 checks；approvals 是审计，保留累计不清。
    # change_level 不重置：退回 intake 后会由 classify_change 重新覆盖。
    return {"revision_count": state["revision_count"] + 1, "checks": []}


def deploy_staging(state: ReleaseState) -> dict:
    return {"stages_completed": state["stages_completed"] + ["staging"]}


def canary_step(state: ReleaseState) -> dict:
    # 游标在"返回时"才提交；resume 后节点从头重跑，读到的仍是暂停前的旧游标，
    # 因此重算得到相同 cursor，不会重复推进（前提：interrupt 前无写副作用）。
    cursor = state["canary_cursor"] + 1
    stage = STAGE_BY_CURSOR[cursor]
    decision = interrupt({
        "interrupt_id": f"INT-3-{stage}", "role": "sre", "stage": stage,
        "ticket_id": state["ticket_id"],
        "actions": ["approve", "abort"],
    })
    ap = _as_approval(decision, f"INT-3-{stage}", "sre")
    if ap["action"] == "abort":
        return {"approvals": [ap], "outcome": "rejected"}
    return {"canary_cursor": cursor, "approvals": [ap],
            "current_stage": {"stage": stage, "started_at": _now()}}


def monitor_window(state: ReleaseState) -> dict:
    stage = (state.get("current_stage") or {}).get("stage", "canary")
    # 演示用确定性规则：service 以 "flaky" 开头时，canary_10 首遍监控判为不健康；
    # 该阶段一旦回滚过（已有 ≥1 条同阶段采样），重跑即判健康，从而能继续推进。
    seen_here = sum(1 for s in state.get("metric_samples", []) if s["stage"] == stage)
    unhealthy = (state["service"].startswith("flaky")
                 and stage == "canary_10" and seen_here == 0)
    healthy = not unhealthy
    sample = MetricSample(ts=_now(), stage=stage, error_rate=0.0 if healthy else 0.24,
                          healthy=healthy)
    return {"metric_samples": [sample],
            "current_stage": {"stage": stage,
                              "status": "healthy" if healthy else "unhealthy"}}


def auto_rollback(state: ReleaseState) -> dict:
    stage = (state.get("current_stage") or {}).get("stage", "canary")
    return {"rollback_count": state["rollback_count"] + 1,
            "canary_cursor": max(0, state["canary_cursor"] - 1),
            "stages_completed": state["stages_completed"] + [f"rolled_back:{stage}"]}


def finalize(state: ReleaseState) -> dict:
    outcome = state.get("outcome") or _infer(state)
    reports_dir = Path(os.environ.get("REPORTS_DIR", "./reports"))
    reports_dir.mkdir(parents=True, exist_ok=True)
    path = reports_dir / f"{state['ticket_id']}.json"
    path.write_text(json.dumps({
        "ticket_id": state["ticket_id"], "outcome": outcome,
        "change_level": state.get("change_level"),
        "revision_count": state["revision_count"],
        "rollback_count": state["rollback_count"],
        "canary_cursor": state["canary_cursor"],
        "stages_completed": state["stages_completed"],
        "generated_at": _now(),
    }, ensure_ascii=False, indent=2), encoding="utf-8")
    return {"outcome": outcome, "report_path": str(path)}


def _infer(state: ReleaseState) -> str:
    approvals = state.get("approvals", [])
    if any(a["action"] in ("reject", "abort") for a in approvals):
        return "rejected"
    if state["rollback_count"] >= state["max_rollbacks"]:
        return "rolled_back"
    if state["canary_cursor"] >= 3:
        return "released"
    return "incomplete"
