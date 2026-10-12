"""01_minimal CLI：一条命令跑完主线，打印每个节点的 state 增量。"""
from __future__ import annotations

import asyncio
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from graph import build_graph  # noqa: E402


async def run(ticket: str, service: str, version: str) -> None:
    initial = {
        "ticket_id": ticket,
        "service": service,
        "version": version,
        "checks_passed": 0,
        "stages_completed": [],
    }
    graph = build_graph()
    cfg = {"configurable": {"thread_id": ticket}}
    async for ev in graph.astream(initial, config=cfg, stream_mode="updates"):
        for node, delta in ev.items():
            print(f"▶ {node}: {delta}")
    final = await graph.aget_state(cfg)
    print("\n终态：", final.values)


if __name__ == "__main__":
    os.environ.setdefault("REPORTS_DIR", str(Path(__file__).parent / "reports"))
    asyncio.run(run("DEMO-01", "auth-svc", "1.0.0"))
