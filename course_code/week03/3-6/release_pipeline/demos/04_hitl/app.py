"""04 CLI：submit / status / approve 三件套，演示跨进程恢复。"""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
os.environ.setdefault("REPORTS_DIR", str(Path(__file__).parent / "reports"))

from langgraph.types import Command  # noqa: E402

from checkpointer import open_checkpointer  # noqa: E402
from graph import build_graph  # noqa: E402


def _initial(ticket: str, service: str, version: str, diff: str) -> dict:
    return {
        "ticket_id": ticket, "service": service, "version": version,
        "patch_diff": diff, "checks_passed": 0,
        "stages_completed": [], "messages": [], "checks": [], "approvals": [],
    }


def _print_pending(snapshot) -> None:
    pendings = []
    for task in (snapshot.tasks or []):
        for intr in (task.interrupts or []):
            pendings.append(intr.value)
    if not pendings:
        return
    print("\n⏸  待审批：")
    for p in pendings:
        print(f"   {p['interrupt_id']} role={p['role']} ticket={p['ticket_id']}")


def submit(ticket: str, service: str, version: str, diff: str) -> None:
    with open_checkpointer() as cp:
        graph = build_graph(cp)
        cfg = {"configurable": {"thread_id": ticket}}
        graph.invoke(_initial(ticket, service, version, diff), config=cfg)
        snap = graph.get_state(cfg)
        print(f"next={snap.next} outcome={snap.values.get('outcome')}")
        _print_pending(snap)


def status(ticket: str) -> None:
    with open_checkpointer() as cp:
        graph = build_graph(cp)
        cfg = {"configurable": {"thread_id": ticket}}
        snap = graph.get_state(cfg)
        if not snap.values:
            print(f"未找到工单 {ticket}")
            return
        print(json.dumps({
            "ticket_id": snap.values.get("ticket_id"),
            "outcome": snap.values.get("outcome"),
            "change_level": snap.values.get("change_level"),
            "approver_count": snap.values.get("approver_count"),
            "stages_completed": snap.values.get("stages_completed"),
            "next": list(snap.next or []),
        }, ensure_ascii=False, indent=2))
        _print_pending(snap)


def approve(ticket: str, action: str, actor: str, feedback: str = "") -> None:
    with open_checkpointer() as cp:
        graph = build_graph(cp)
        cfg = {"configurable": {"thread_id": ticket}}
        snap = graph.get_state(cfg)
        if not snap.next:
            print("该工单没在等待审批。")
            return
        graph.invoke(
            Command(resume={"action": action, "actor": actor, "feedback": feedback}),
            config=cfg,
        )
        snap = graph.get_state(cfg)
        print(f"after resume: next={snap.next} outcome={snap.values.get('outcome')}")
        _print_pending(snap)


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("用法: python app.py {submit|status|approve} [args]")
        sys.exit(1)
    cmd = sys.argv[1]
    if cmd == "submit":
        submit(sys.argv[2], sys.argv[3], sys.argv[4], sys.argv[5])
    elif cmd == "status":
        status(sys.argv[2])
    elif cmd == "approve":
        approve(sys.argv[2], sys.argv[3], sys.argv[4],
                sys.argv[5] if len(sys.argv) > 5 else "")
    else:
        print(f"未知命令 {cmd}")
