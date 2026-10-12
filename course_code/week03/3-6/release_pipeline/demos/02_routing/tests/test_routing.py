"""02 验收测试：3 条分支路径都走通。"""
from __future__ import annotations

import asyncio
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
os.environ["REPORTS_DIR"] = str(ROOT / "reports")

from graph import build_graph  # noqa: E402


def _drive(ticket: str, diff: str) -> dict:
    async def go():
        g = build_graph()
        cfg = {"configurable": {"thread_id": ticket}}
        await g.ainvoke({
            "ticket_id": ticket, "service": "auth-svc", "version": "1.0.0",
            "patch_diff": diff, "checks_passed": 0, "stages_completed": [],
        }, config=cfg)
        return (await g.aget_state(cfg)).values
    return asyncio.run(go())


def test_ac1_short_diff_is_L():
    out = _drive("02-AC1", "tiny config tweak")
    assert out["change_level"] == "L"
    assert out["approver_count"] == 0
    assert out["outcome"] == "released"


def test_ac2_long_diff_is_M():
    out = _drive("02-AC2", "x" * 1200)
    assert out["change_level"] == "M"
    assert out["approver_count"] == 1


def test_ac3_auth_diff_is_H():
    out = _drive("02-AC3", "modify auth token rotation logic")
    assert out["change_level"] == "H"
    assert out["approver_count"] == 2


def test_ac4_all_paths_complete_stages():
    for tid, diff in [("02-AC4a", "small"), ("02-AC4b", "x" * 1200), ("02-AC4c", "payment")]:
        out = _drive(tid, diff)
        assert out["stages_completed"] == [
            "staging", "smoke", "canary_10", "canary_50", "canary_100",
        ], f"{tid} 主线没走完"
