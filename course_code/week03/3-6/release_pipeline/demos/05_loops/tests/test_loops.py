"""05 验收测试：两处循环 + 两个预算上限。"""
from __future__ import annotations

import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
os.environ["REPORTS_DIR"] = str(ROOT / "reports")
os.environ["CHECKPOINT_DB"] = str(ROOT / "test_checkpoints_05.sqlite")

import pytest  # noqa: E402
from langgraph.types import Command  # noqa: E402

from checkpointer import open_checkpointer  # noqa: E402
from graph import build_graph  # noqa: E402


@pytest.fixture(autouse=True)
def _clean_db():
    p = Path(os.environ["CHECKPOINT_DB"])
    for f in (p,):
        if f.exists():
            f.unlink()
    yield
    if p.exists():
        f.unlink()


def _init(ticket, service, diff, max_rev=2, max_rb=2):
    return {"ticket_id": ticket, "service": service, "version": "1.0.0",
            "patch_diff": diff, "checks_passed": 0,
            "revision_count": 0, "max_revisions": max_rev,
            "rollback_count": 0, "max_rollbacks": max_rb, "canary_cursor": 0,
            "stages_completed": [], "messages": [], "checks": [],
            "approvals": [], "metric_samples": []}


def _ok(actor="sre"):
    return Command(resume={"action": "approve", "actor": actor, "feedback": ""})


def _resume(graph, cfg, action, actor):
    graph.invoke(Command(resume={"action": action, "actor": actor,
                                 "feedback": ""}), config=cfg)


def test_ac1_revise_loops_back_to_intake():
    with open_checkpointer() as cp:
        g = build_graph(cp)
        cfg = {"configurable": {"thread_id": "05-AC1"}}
        g.invoke(_init("05-AC1", "orders", "x" * 1200), config=cfg)
        _resume(g, cfg, "revise", "lead")
        snap = g.get_state(cfg)
        assert snap.values["revision_count"] == 1
        assert snap.next == ("approval_m",)
        assert snap.tasks[0].interrupts[0].value["interrupt_id"] == "INT-1"


def test_ac2_revise_then_approve_releases():
    with open_checkpointer() as cp:
        g = build_graph(cp)
        cfg = {"configurable": {"thread_id": "05-AC2"}}
        g.invoke(_init("05-AC2", "orders", "x" * 1200), config=cfg)
        _resume(g, cfg, "revise", "lead")
        _resume(g, cfg, "approve", "lead")
        for _ in range(3):
            _ok_and(g, cfg)
        snap = g.get_state(cfg)
        assert snap.values["revision_count"] == 1
        assert snap.values["outcome"] == "released"


def _ok_and(g, cfg):
    g.invoke(_ok(), config=cfg)


def test_ac3_revision_budget_stops():
    with open_checkpointer() as cp:
        g = build_graph(cp)
        cfg = {"configurable": {"thread_id": "05-AC3"}}
        g.invoke(_init("05-AC3", "orders", "x" * 1200, max_rev=1), config=cfg)
        _resume(g, cfg, "revise", "lead")   # rev 0<1 → revise 允许，rev=1
        _resume(g, cfg, "revise", "lead")   # rev 1>=1 → stop → finalize
        snap = g.get_state(cfg)
        assert snap.values["revision_count"] == 1
        assert snap.next == ()
        assert snap.values["outcome"] == "incomplete"


def test_ac4_flaky_rolls_back_then_recovers():
    with open_checkpointer() as cp:
        g = build_graph(cp)
        cfg = {"configurable": {"thread_id": "05-AC4"}}
        g.invoke(_init("05-AC4", "flaky-svc", "x" * 1200, max_rb=2), config=cfg)
        _resume(g, cfg, "approve", "lead")   # INT-1 → deploy → canary_10 中断
        _ok_and(g, cfg)                      # canary_10 SRE → 不健康 → 回滚 → 重试 canary_10
        _ok_and(g, cfg)                      # canary_10 二次 → 健康 → canary_50
        _ok_and(g, cfg)                       # canary_50 → canary_100
        _ok_and(g, cfg)                       # canary_100 → released
        snap = g.get_state(cfg)
        assert snap.values["rollback_count"] == 1
        assert snap.values["outcome"] == "released"
        assert any(s.startswith("rolled_back:") for s in snap.values["stages_completed"])


def test_ac5_rollback_budget_aborts():
    with open_checkpointer() as cp:
        g = build_graph(cp)
        cfg = {"configurable": {"thread_id": "05-AC5"}}
        g.invoke(_init("05-AC5", "flaky-svc", "x" * 1200, max_rb=0), config=cfg)
        _resume(g, cfg, "approve", "lead")
        _ok_and(g, cfg)                      # canary_10 不健康 → 回滚 count=1 → abort
        snap = g.get_state(cfg)
        assert snap.values["rollback_count"] == 1
        assert snap.values["outcome"] == "rolled_back"
        assert snap.next == ()
