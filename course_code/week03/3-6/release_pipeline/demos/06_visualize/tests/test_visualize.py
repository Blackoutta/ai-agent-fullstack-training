"""06 验收测试：Mermaid 文本、PNG、stream updates、aget_state 视图、studio_graph 可加载。"""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
os.environ["REPORTS_DIR"] = str(ROOT / "reports")
os.environ["CHECKPOINT_DB"] = str(ROOT / "test_checkpoints_06.sqlite")

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


def _init(ticket, service="orders", diff=None):
    return {"ticket_id": ticket, "service": service, "version": "1.0.0",
            "patch_diff": diff or "x" * 1200, "checks_passed": 0,
            "revision_count": 0, "max_revisions": 2,
            "rollback_count": 0, "max_rollbacks": 2, "canary_cursor": 0,
            "stages_completed": [], "messages": [], "checks": [],
            "approvals": [], "metric_samples": []}


def test_ac1_mermaid_text_covers_key_nodes():
    from visualize import mermaid_text
    g = build_graph(None)
    text = mermaid_text(g)
    for kw in ("graph TD", "intake", "tool_checks", "canary_step",
               "auto_rollback", "begin_revision", "finalize"):
        assert kw in text


def test_ac2_export_files_on_disk(tmp_path):
    from visualize import export_mermaid
    g = build_graph(None)
    info = export_mermaid(g, str(tmp_path))
    assert Path(info["mermaid_text_path"]).exists()
    assert "png_status" in info


def test_ac3_stream_updates_returns_execution_order():
    from visualize import stream_nodes
    with open_checkpointer() as cp:
        g = build_graph(cp)
        cfg = {"configurable": {"thread_id": "06-AC3"}}
        fired = stream_nodes(g, _init("06-AC3"), cfg)
        # updates 流：跑到 approval_m 触发 interrupt，停在这里被标成 ⏸ INT-1
        assert fired[:4] == ["intake", "tool_checks", "collect_checks", "classify_change"]
        assert fired[-1] == "⏸ INT-1"
        assert "approval_m" not in fired


def test_ac4_state_snapshot_exposes_pending_interrupt():
    with open_checkpointer() as cp:
        g = build_graph(cp)
        cfg = {"configurable": {"thread_id": "06-AC4"}}
        g.invoke(_init("06-AC4"), config=cfg)
        snap = g.get_state(cfg)
        assert snap.next == ("approval_m",)
        intr_vals = [i.value for t in snap.tasks for i in (t.interrupts or [])]
        assert intr_vals[0]["interrupt_id"] == "INT-1"
        g.invoke(Command(resume={"action": "approve", "actor": "lead",
                                  "feedback": ""}), config=cfg)
        snap2 = g.get_state(cfg)
        ids = [i.value["interrupt_id"] for t in snap2.tasks for i in (t.interrupts or [])]
        assert "INT-3-canary_10" in ids


def test_ac5_studio_graph_loadable():
    sys.path.insert(0, str(ROOT))
    import studio_graph
    assert studio_graph.graph is not None
    assert "intake" in studio_graph.graph.nodes
    cfg_path = ROOT / "langgraph.json"
    meta = json.loads(cfg_path.read_text(encoding="utf-8"))
    assert meta["graphs"]["release_06"] == "./studio_graph.py:graph"
