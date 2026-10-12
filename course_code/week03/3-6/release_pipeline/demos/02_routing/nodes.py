"""02 节点：在 01 主线基础上加 classify_change 与 3 个等级审批节点（占位）。"""
from __future__ import annotations

import json
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Literal

from state import ReleaseState


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def intake(state: ReleaseState) -> dict:
    return {"checks_passed": 4, "stages_completed": []}


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
        "change_level": state.get("change_level"),
        "approver_count": state.get("approver_count", 0),
        "outcome": "released",
        "stages_completed": state["stages_completed"],
        "generated_at": _now(),
    }, ensure_ascii=False, indent=2), encoding="utf-8")
    return {"outcome": "released", "report_path": str(path)}
