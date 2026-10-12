"""04 验收测试：interrupt 暂停 / Command 恢复 / 跨进程持久化。"""
from __future__ import annotations

import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
os.environ["REPORTS_DIR"] = str(ROOT / "reports")
os.environ["CHECKPOINT_DB"] = str(ROOT / "test_checkpoints_04.sqlite")

import pytest  # noqa: E402
from langgraph.types import Command  # noqa: E402

from checkpointer import open_checkpointer  # noqa: E402
from graph import build_graph  # noqa: E402


@pytest.fixture(autouse=True)
def _clean_db():
    p = Path(os.environ["CHECKPOINT_DB"])
    if p.exists():
        p.unlink()
    yield
    if p.exists():
        p.unlink()


def _initial(ticket: str, diff: str) -> dict:
    return {
        "ticket_id": ticket, "service": "auth-svc", "version": "1.0.0",
        "patch_diff": diff, "checks_passed": 0, "stages_completed": [],
        "messages": [], "checks": [], "approvals": [],
    }


def test_ac1_pause_at_INT_1():
    with open_checkpointer() as cp:
        g = build_graph(cp)
        cfg = {"configurable": {"thread_id": "04-AC1"}}
        g.invoke(_initial("04-AC1", "x" * 1200), config=cfg)
        snap = g.get_state(cfg)
        assert snap.next == ("approval_m",)
        intr = snap.tasks[0].interrupts[0]
        assert intr.value["interrupt_id"] == "INT-1"
        assert intr.value["role"] == "tech_lead"


def test_ac2_resume_finishes_M():
    with open_checkpointer() as cp:
        g = build_graph(cp)
        cfg = {"configurable": {"thread_id": "04-AC2"}}
        g.invoke(_initial("04-AC2", "x" * 1200), config=cfg)
        g.invoke(Command(resume={"action": "approve", "actor": "alice",
                                  "feedback": ""}), config=cfg)
        snap = g.get_state(cfg)
        assert snap.values["outcome"] == "released"
        roles = [a["role"] for a in snap.values["approvals"]]
        assert roles == ["tech_lead"]


def test_ac3_H_two_sequential_interrupts():
    with open_checkpointer() as cp:
        g = build_graph(cp)
        cfg = {"configurable": {"thread_id": "04-AC3"}}
        g.invoke(_initial("04-AC3", "modify auth"), config=cfg)
        s1 = g.get_state(cfg)
        assert s1.next == ("approval_h_lead",)
        assert s1.tasks[0].interrupts[0].value["interrupt_id"] == "INT-2A"

        g.invoke(Command(resume={"action": "approve", "actor": "alice",
                                  "feedback": ""}), config=cfg)
        s2 = g.get_state(cfg)
        assert s2.next == ("approval_h_security",)
        assert s2.tasks[0].interrupts[0].value["interrupt_id"] == "INT-2B"

        g.invoke(Command(resume={"action": "approve", "actor": "bob",
                                  "feedback": ""}), config=cfg)
        s3 = g.get_state(cfg)
        assert s3.values["outcome"] == "released"
        assert len(s3.values["approvals"]) == 2


def test_ac4_cross_process_resume():
    """第一次进程跑到 INT-1，关闭；第二次进程独立打开同一个 SQLite 文件 resume。"""
    with open_checkpointer() as cp:
        g1 = build_graph(cp)
        cfg = {"configurable": {"thread_id": "04-AC4"}}
        g1.invoke(_initial("04-AC4", "x" * 1200), config=cfg)
    # 第一个 context 已关闭，模拟进程退出

    with open_checkpointer() as cp:
        g2 = build_graph(cp)
        snap = g2.get_state(cfg)
        assert snap.values["ticket_id"] == "04-AC4"
        assert snap.next == ("approval_m",)
        g2.invoke(Command(resume={"action": "approve", "actor": "alice",
                                   "feedback": "from new process"}), config=cfg)
        snap = g2.get_state(cfg)
        assert snap.values["outcome"] == "released"
        assert snap.values["approvals"][0]["actor"] == "alice"


def test_ac5_reject_short_circuits_to_finalize():
    with open_checkpointer() as cp:
        g = build_graph(cp)
        cfg = {"configurable": {"thread_id": "04-AC5"}}
        g.invoke(_initial("04-AC5", "x" * 1200), config=cfg)
        g.invoke(Command(resume={"action": "reject", "actor": "alice",
                                  "feedback": "no"}), config=cfg)
        snap = g.get_state(cfg)
        assert snap.values["outcome"] == "rejected"
        assert snap.values["stages_completed"] == []
