"""01_minimal 验收测试。"""
from __future__ import annotations

import asyncio
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
os.environ["REPORTS_DIR"] = str(ROOT / "reports")

from graph import build_graph  # noqa: E402


def _initial(ticket: str) -> dict:
    return {
        "ticket_id": ticket, "service": "auth-svc", "version": "1.0.0",
        "checks_passed": 0, "stages_completed": [],
    }


def _drive(ticket: str) -> dict:
    async def go():
        g = build_graph()
        cfg = {"configurable": {"thread_id": ticket}}
        await g.ainvoke(_initial(ticket), config=cfg)
        return (await g.aget_state(cfg)).values
    return asyncio.run(go())


def test_ac1_outcome_released():
    out = _drive("01-AC1")
    assert out["outcome"] == "released"


def test_ac2_stages_in_order():
    out = _drive("01-AC2")
    assert out["stages_completed"] == [
        "staging", "smoke", "canary_10", "canary_50", "canary_100",
    ]


def test_ac3_checks_passed():
    out = _drive("01-AC3")
    assert out["checks_passed"] == 4


def test_ac4_report_written():
    out = _drive("01-AC4")
    assert Path(out["report_path"]).exists()
    Path(out["report_path"]).unlink()
