"""05 CLI：submit / status / approve（同 04），外加 demo 一把演示两处循环。"""
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


def _initial(ticket, service, version, diff, max_rev=2, max_rb=1) -> dict:
    return {"ticket_id": ticket, "service": service, "version": version,
            "patch_diff": diff, "checks_passed": 0,
            "revision_count": 0, "max_revisions": max_rev,
            "rollback_count": 0, "max_rollbacks": max_rb, "canary_cursor": 0,
            "stages_completed": [], "messages": [], "checks": [],
            "approvals": [], "metric_samples": []}


def _pending(snap):
    out = []
    for task in (snap.tasks or []):
        for intr in (task.interrupts or []):
            out.append(intr.value)
    return out


def submit(ticket, service, version, diff):
    with open_checkpointer() as cp:
        g = build_graph(cp)
        cfg = {"configurable": {"thread_id": ticket}}
        g.invoke(_initial(ticket, service, version, diff), config=cfg)
        snap = g.get_state(cfg)
        print(f"next={snap.next}")
        for p in _pending(snap):
            print(f"  ⏸ {p['interrupt_id']} role={p['role']}")


def status(ticket):
    with open_checkpointer() as cp:
        g = build_graph(cp)
        cfg = {"configurable": {"thread_id": ticket}}
        snap = g.get_state(cfg)
        v = snap.values
        print(json.dumps({
            "ticket_id": v.get("ticket_id"), "outcome": v.get("outcome"),
            "change_level": v.get("change_level"),
            "revision_count": v.get("revision_count"),
            "rollback_count": v.get("rollback_count"),
            "canary_cursor": v.get("canary_cursor"),
            "stages_completed": v.get("stages_completed"),
            "next": list(snap.next or []),
        }, ensure_ascii=False, indent=2))
        for p in _pending(snap):
            print(f"  ⏸ {p['interrupt_id']} role={p['role']}")


def approve(ticket, action, actor, feedback=""):
    with open_checkpointer() as cp:
        g = build_graph(cp)
        cfg = {"configurable": {"thread_id": ticket}}
        snap = g.get_state(cfg)
        if not snap.next:
            print("未在等待。")
            return
        g.invoke(Command(resume={"action": action, "actor": actor,
                                 "feedback": feedback}), config=cfg)
        snap = g.get_state(cfg)
        print(f"after resume: next={snap.next} outcome={snap.values.get('outcome')}")
        for p in _pending(snap):
            print(f"  ⏸ {p['interrupt_id']} role={p['role']}")


def _drive(g, cfg, decisions: list[dict]):
    """按给定决定序列逐个 resume，跑到结束或序列用尽。"""
    snap = g.get_state(cfg)
    for d in decisions:
        if not snap.next:
            break
        g.invoke(Command(resume=d), config=cfg)
        snap = g.get_state(cfg)
    return snap


def visualize() -> None:
    """导出 Mermaid 文本与 PNG；在线渲染失败时仍保留 .mmd 供离线渲染。"""
    from visualize import export_mermaid
    g = build_graph(None)          # 画图不需要 checkpointer
    info = export_mermaid(g, str(Path(__file__).parent / "reports"))
    print(info["mermaid_text"])
    print(f"\nMermaid: {info['mermaid_text_path']}")
    print(f"PNG: {info['png_path'] or '(未生成)'} — {info['png_status']}")


def watch(ticket: str) -> None:
    """用 stream_mode='updates' 边跑边打印每个触发的节点名（跑到第一个中断即停）。"""
    from visualize import stream_nodes
    with open_checkpointer() as cp:
        g = build_graph(cp)
        cfg = {"configurable": {"thread_id": ticket}}
        fired = stream_nodes(g, _initial(ticket, "orders", "1.0.0", "x" * 1200), cfg)
        print("执行顺序：", " → ".join(fired))


def demo():
    ok = lambda: {"action": "approve", "actor": "sre", "feedback": ""}
    lead = lambda action="approve": {"action": action, "actor": "lead", "feedback": ""}
    with open_checkpointer() as cp:
        g = build_graph(cp)

        print("== 场景 A：修订循环（先 revise 再 approve）==")
        cfg = {"configurable": {"thread_id": "05-A"}}
        g.invoke(_initial("05-A", "orders", "1.0.0", "x" * 1200), config=cfg)
        snap = _drive(g, cfg, [
            {"action": "revise", "actor": "lead", "feedback": "补测试"},
            {"action": "approve", "actor": "lead", "feedback": ""},
            ok(), ok(), ok(),
        ])
        print(f"   revision_count={snap.values['revision_count']} "
              f"outcome={snap.values.get('outcome')}\n")

        print("== 场景 B：灰度回滚后重试（flaky 服务）==")
        cfg = {"configurable": {"thread_id": "05-B"}}
        g.invoke(_initial("05-B", "flaky-svc", "2.0.0", "x" * 1200, max_rb=2),
                 config=cfg)
        snap = _drive(g, cfg, [
            {"action": "approve", "actor": "lead", "feedback": ""},
            ok(),   # canary_10 首遍 → 不健康 → 回滚 → 重试 canary_10
            ok(),   # canary_10 二次 → 健康 → 推进 canary_50
            ok(),   # canary_50 → 推进 canary_100
            ok(),   # canary_100 → released
        ])
        print(f"   rollback_count={snap.values['rollback_count']} "
              f"outcome={snap.values.get('outcome')}\n")


if __name__ == "__main__":
    if len(sys.argv) < 2:
        demo()
        sys.exit(0)
    cmd = sys.argv[1]
    if cmd == "submit":
        submit(*sys.argv[2:6])
    elif cmd == "status":
        status(sys.argv[2])
    elif cmd == "approve":
        approve(sys.argv[2], sys.argv[3], sys.argv[4],
                sys.argv[5] if len(sys.argv) > 5 else "")
    elif cmd == "demo":
        demo()
    elif cmd == "visualize":
        visualize()
    elif cmd == "watch":
        watch(sys.argv[2] if len(sys.argv) > 2 else "06-WATCH")
    else:
        print(f"未知命令 {cmd}")
