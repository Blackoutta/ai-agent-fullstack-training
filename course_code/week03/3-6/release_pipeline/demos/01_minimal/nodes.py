"""主线 7 节点：受理 → 预发 → 冒烟 → 10% → 50% → 100% → 完成报告。

每个节点就是一个普通 Python 函数：读 state，干一件事，返回字典。
检查/部署在这里用同步内联函数模拟，后续步骤再把它们升级为 ToolNode 工具。
"""
from __future__ import annotations

import json
import os
from datetime import datetime, timezone
from pathlib import Path

from state import ReleaseState


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _run_one_check(name: str) -> bool:
    """内联检查：返回 True 表示通过。后续 03 会把这层换成 ToolNode。"""
    return True


def intake(state: ReleaseState) -> dict:
    """受理工单 + 跑 4 项前置检查（构建 / 单测 / 安全扫描 / 依赖审计）。"""
    checks = ["build", "unit_test", "security_scan", "dep_audit"]
    passed = sum(1 for c in checks if _run_one_check(c))
    return {"checks_passed": passed, "stages_completed": []}


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
        "outcome": "released",
        "stages_completed": state["stages_completed"],
        "generated_at": _now(),
    }, ensure_ascii=False, indent=2), encoding="utf-8")
    return {"outcome": "released", "report_path": str(path)}
