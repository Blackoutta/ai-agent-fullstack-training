"""03 CLI：跑一张工单，重点观察 ToolNode 4 路并行产生的 ToolMessage。"""
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
        "messages": [],
        "checks": [],
    }
    graph = build_graph()
    cfg = {"configurable": {"thread_id": ticket}}
    async for ev in graph.astream(initial, config=cfg, stream_mode="updates"):
        for node, delta in ev.items():
            keys = sorted((delta or {}).keys())
            print(f"▶ {node}: {keys}")
    return (await graph.aget_state(cfg)).values


if __name__ == "__main__":
    os.environ.setdefault("REPORTS_DIR", str(Path(__file__).parent / "reports"))
    out = asyncio.run(run("R-03-demo", "modify auth token"))
    print(f"\n→ level={out['change_level']} checks_passed={out['checks_passed']}")
    print(f"→ 4 项检查：{[c['name'] for c in out['checks']]}")
