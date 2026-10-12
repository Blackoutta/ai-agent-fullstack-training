"""03 验收测试：ToolNode 4 路并行 → checks 长度 4 + 名字齐全。"""
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
            "messages": [], "checks": [],
        }, config=cfg)
        return (await g.aget_state(cfg)).values
    return asyncio.run(go())


def test_ac1_four_checks_present():
    out = _drive("03-AC1", "tiny")
    assert len(out["checks"]) == 4
    assert {c["name"] for c in out["checks"]} == {
        "build", "unit_test", "security_scan", "dep_audit"
    }


def test_ac2_checks_passed_count():
    out = _drive("03-AC2", "tiny")
    assert out["checks_passed"] == 4


def test_ac3_routing_still_works():
    out = _drive("03-AC3", "modify auth token")
    assert out["change_level"] == "H"
    assert out["approver_count"] == 2
    assert out["outcome"] == "released"


def test_ac4_messages_channel_present():
    out = _drive("03-AC4", "tiny")
    msgs = out.get("messages", [])
    names = {type(m).__name__ for m in msgs}
    assert "AIMessage" in names or "ToolMessage" in names
    tool_msgs = [m for m in msgs if type(m).__name__ == "ToolMessage"]
    assert len(tool_msgs) == 4
