"""03 节点：intake 改为发 4 路 tool_calls；新增 collect_checks 解析 ToolMessage。"""
from __future__ import annotations

import json
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Literal

from langchain_core.messages import AIMessage, ToolMessage

from state import CheckResult, ReleaseState


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def intake(state: ReleaseState) -> dict:
    """受理工单 + 一次性发出 4 个 tool_calls 给下游 ToolNode 并行执行。"""
    fanout = AIMessage(
        content="",
        tool_calls=[
            {"name": "build_service",
             "args": {"service": state["service"], "version": state["version"]},
             "id": "call_build"},
            {"name": "run_unit_tests",
             "args": {"service": state["service"]},
             "id": "call_unit"},
            {"name": "security_scan",
             "args": {"diff": state.get("patch_diff", "")},
             "id": "call_scan"},
            {"name": "dependency_audit",
             "args": {"service": state["service"]},
             "id": "call_audit"},
        ],
    )
    return {"messages": [fanout], "stages_completed": []}


def collect_checks(state: ReleaseState) -> dict:
    """解析 ToolNode 追加的 4 条 ToolMessage，转成结构化 checks。"""
    results: list[CheckResult] = []
    for msg in state.get("messages", []):
        if not isinstance(msg, ToolMessage):
            continue
        try:
            payload = json.loads(msg.content)
        except (TypeError, json.JSONDecodeError):
            payload = {"tool": msg.name, "passed": False, "summary": str(msg.content)}
        results.append(CheckResult(
            name=payload.get("tool", msg.name or "unknown"),
            passed=bool(payload.get("passed", False)),
            summary=payload.get("summary", ""),
        ))
    return {
        "checks": results,
        "checks_passed": sum(1 for r in results if r["passed"]),
    }


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


def approval_lead_M(state: ReleaseState) -> dict:
    return {"approver_count": 1}


def approval_dual_H(state: ReleaseState) -> dict:
    return {"approver_count": 2}


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
    reports_dir = Path(os.environ.get("REPORTS_DIR", "./reports"))
    reports_dir.mkdir(parents=True, exist_ok=True)
    path = reports_dir / f"{state['ticket_id']}.json"
    path.write_text(json.dumps({
        "ticket_id": state["ticket_id"],
        "service": state["service"],
        "version": state["version"],
        "checks": state.get("checks", []),
        "change_level": state.get("change_level"),
        "approver_count": state.get("approver_count", 0),
        "outcome": "released",
        "stages_completed": state["stages_completed"],
        "generated_at": _now(),
    }, ensure_ascii=False, indent=2), encoding="utf-8")
    return {"outcome": "released", "report_path": str(path)}
