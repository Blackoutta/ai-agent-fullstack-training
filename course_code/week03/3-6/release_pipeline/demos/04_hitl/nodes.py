"""04 节点：3 处审批节点改成真 interrupt；H 级两段串行审批。"""
from __future__ import annotations

import json
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Literal

from langchain_core.messages import AIMessage, ToolMessage
from langgraph.types import interrupt

from state import Approval, ReleaseState


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _as_approval(decision: object, iid: str, role: str) -> Approval:
    d = decision if isinstance(decision, dict) else {}
    action = d.get("action", "approve")
    if action not in ("approve", "reject"):
        action = "reject"
    return Approval(
        interrupt_id=iid, role=role, action=action,
        actor=str(d.get("actor", "unknown")),
        feedback=str(d.get("feedback", "")),
    )


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
    return {"messages": [fanout], "stages_completed": [], "approvals": []}


def collect_checks(state: ReleaseState) -> dict:
    results = []
    for msg in state.get("messages", []):
        if not isinstance(msg, ToolMessage):
            continue
        try:
            payload = json.loads(msg.content)
        except (TypeError, json.JSONDecodeError):
            payload = {"tool": msg.name, "passed": False, "summary": ""}
        results.append({
            "name": payload.get("tool", msg.name or "unknown"),
            "passed": bool(payload.get("passed", False)),
            "summary": payload.get("summary", ""),
        })
    return {"checks": results,
            "checks_passed": sum(1 for r in results if r["passed"])}


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
        "interrupt_id": "INT-1",
        "role": "tech_lead",
        "ticket_id": state["ticket_id"],
        "service": state["service"],
        "version": state["version"],
        "diff_preview": state.get("patch_diff", "")[:300],
        "actions": ["approve", "reject"],
    })
    return {"approver_count": 1,
            "approvals": [_as_approval(decision, "INT-1", "tech_lead")]}


def approval_h_lead(state: ReleaseState) -> dict:
    decision = interrupt({
        "interrupt_id": "INT-2A",
        "role": "tech_lead",
        "ticket_id": state["ticket_id"],
        "diff_preview": state.get("patch_diff", "")[:300],
        "actions": ["approve", "reject"],
    })
    return {"approvals": [_as_approval(decision, "INT-2A", "tech_lead")]}


def approval_h_security(state: ReleaseState) -> dict:
    decision = interrupt({
        "interrupt_id": "INT-2B",
        "role": "security",
        "ticket_id": state["ticket_id"],
        "diff_preview": state.get("patch_diff", "")[:300],
        "actions": ["approve", "reject"],
    })
    return {"approver_count": 2,
            "approvals": [_as_approval(decision, "INT-2B", "security")]}


def deploy_staging(state: ReleaseState) -> dict:
    return {"stages_completed": state["stages_completed"] + ["staging"]}


def smoke_test(state: ReleaseState) -> dict:
    return {"stages_completed": state["stages_completed"] + ["smoke"]}


def canary_10(state: ReleaseState) -> dict:
    return {"stages_completed": state["stages_completed"] + ["canary_10"]}


def canary_50(state: ReleaseState) -> dict:
    return {"stages_completed": state["stages_completed"] + ["canary_50"]}


def canary_100(state: ReleaseState) -> dict:
    return {"stages_completed": state["stages_completed"] + ["canary_100"]}


def finalize(state: ReleaseState) -> dict:
    rejected = any(a["action"] == "reject" for a in state.get("approvals", []))
    outcome: Literal["released", "rejected"] = "rejected" if rejected else "released"
    reports_dir = Path(os.environ.get("REPORTS_DIR", "./reports"))
    reports_dir.mkdir(parents=True, exist_ok=True)
    path = reports_dir / f"{state['ticket_id']}.json"
    path.write_text(json.dumps({
        "ticket_id": state["ticket_id"],
        "service": state["service"],
        "version": state["version"],
        "outcome": outcome,
        "change_level": state.get("change_level"),
        "approvals": state.get("approvals", []),
        "stages_completed": state["stages_completed"],
        "generated_at": _now(),
    }, ensure_ascii=False, indent=2), encoding="utf-8")
    return {"outcome": outcome, "report_path": str(path)}
