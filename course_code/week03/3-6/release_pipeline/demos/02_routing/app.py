"""02 CLI：演示 3 种 diff 走 3 条路径。"""
from __future__ import annotations

import asyncio
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from graph import build_graph  # noqa: E402


async def run(ticket: str, diff: str) -> dict:
    initial = {
        "ticket_id": ticket,
        "service": "auth-svc",
        "version": "1.0.0",
        "patch_diff": diff,
        "checks_passed": 0,
        "stages_completed": [],
    }
    graph = build_graph()
    cfg = {"configurable": {"thread_id": ticket}}
    async for ev in graph.astream(initial, config=cfg, stream_mode="updates"):
        for node, delta in ev.items():
            print(f"▶ {node}: {delta}")
    return (await graph.aget_state(cfg)).values


if __name__ == "__main__":
    os.environ.setdefault("REPORTS_DIR", str(Path(__file__).parent / "reports"))
    cases = [
        ("R-02-L", "tiny config tweak"),
        ("R-02-M", "x" * 1200),
        ("R-02-H", "modify auth token rotation logic"),
    ]
    for tid, diff in cases:
        print(f"\n=== {tid} ===")
        out = asyncio.run(run(tid, diff))
        print(f"→ level={out['change_level']} approvers={out['approver_count']} outcome={out['outcome']}")
