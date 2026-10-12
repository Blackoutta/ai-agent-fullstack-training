"""验收测试：对应 SDD §8 Acceptance Criteria。"""
from __future__ import annotations

import asyncio
import os
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
os.environ.setdefault("CHECKPOINT_DB", "./test-checkpoints.sqlite")
os.environ.setdefault("REPORTS_DIR", "./test-reports")

from langgraph.types import Command  # noqa: E402

from checkpointer import open_checkpointer  # noqa: E402
from graph import build_graph  # noqa: E402


@pytest.fixture(scope="session", autouse=True)
def _fresh_checkpoint_db():
    """每个测试会话从干净的 checkpoint 库开始。

    LangGraph 以 thread_id 为坐标持久化整条执行轨迹；如果沿用上一次会话遗留的
    test-checkpoints.sqlite，同名 thread 会从中断处继续，导致"从头跑"的断言失真。
    """
    for p in (Path(os.environ["CHECKPOINT_DB"]), Path(os.environ["REPORTS_DIR"])):
        p = p.resolve()
        if p.is_file():
            p.unlink()
        elif p.is_dir():
            for f in p.glob("*"):
                f.unlink()
    yield


def _initial(ticket: str, diff: str = "small typo fix") -> dict:
    return {
        "ticket_id": ticket, "service": "auth-svc", "version": "1.0.0",
        "patch_diff": diff, "revision_count": 0, "rollback_count": 0,
        "max_revisions": 2, "max_rollbacks": 2, "canary_cursor": 0,
        "messages": [], "checks": [], "approvals": [], "metric_samples": [],
    }


async def _drive(ticket: str, diff: str, decisions: list[dict]) -> dict:
    async with open_checkpointer() as cp:
        graph = build_graph(cp)
        cfg = {"configurable": {"thread_id": ticket}}
        await graph.ainvoke(_initial(ticket, diff), config=cfg)
        for d in decisions:
            snap = await graph.aget_state(cfg)
            if not snap.next:
                break
            await graph.ainvoke(Command(resume=d), config=cfg)
        return (await graph.aget_state(cfg)).values


_SRE = {"action": "approve", "actor": "sre-bot", "feedback": "", "role": "sre"}


def test_l_level_auto_release():
    """AC-1：L 级变更跳过 M/H 审批（INT-1/INT-2），仅需 3 次 SRE 灰度确认（INT-3）。"""
    out = asyncio.run(_drive("AC1", "tiny config tweak", [_SRE, _SRE, _SRE]))
    assert out["change_level"] == "L"
    assert out["outcome"] == "released"
    assert out["canary_cursor"] == 3
    # 不应出现 tech_lead / security 审批
    roles = {a["role"] for a in out["approvals"]}
    assert "tech_lead" not in roles and "security" not in roles


def test_m_level_single_approval():
    """AC-2：M 级需要 1 次 tech_lead 审批，批准后 released。"""
    decisions = [
        {"action": "approve", "actor": "alice", "feedback": "", "role": "tech_lead"},
        {"action": "approve", "actor": "sre", "feedback": "", "role": "sre"},
        {"action": "approve", "actor": "sre", "feedback": "", "role": "sre"},
        {"action": "approve", "actor": "sre", "feedback": "", "role": "sre"},
    ]
    big_diff = "x" * 1200
    out = asyncio.run(_drive("AC2", big_diff, decisions))
    assert out["outcome"] == "released"
    roles = [a["role"] for a in out["approvals"]]
    assert "tech_lead" in roles


def test_h_level_requires_two_approvals():
    """AC-3：H 级（auth 关键字）需要 tech_lead + security 两次审批。"""
    decisions = [
        {"action": "approve", "actor": "alice", "feedback": "", "role": "tech_lead"},
        {"action": "approve", "actor": "bob", "feedback": "", "role": "security"},
        {"action": "approve", "actor": "sre", "feedback": "", "role": "sre"},
        {"action": "approve", "actor": "sre", "feedback": "", "role": "sre"},
        {"action": "approve", "actor": "sre", "feedback": "", "role": "sre"},
    ]
    out = asyncio.run(_drive("AC3", "modify auth payment flow", decisions))
    assert out["change_level"] == "H"
    roles = {a["role"] for a in out["approvals"]}
    assert {"tech_lead", "security"}.issubset(roles)


def test_reject_terminates():
    """AC-4：任一审批 reject → outcome=rejected。"""
    out = asyncio.run(_drive("AC4", "x" * 1200, [
        {"action": "reject", "actor": "alice", "feedback": "no", "role": "tech_lead"},
    ]))
    assert out["outcome"] == "rejected"


def test_canary_unhealthy_rolls_back():
    """AC-5：灰度异常触发 auto_rollback，达 max_rollbacks 后 outcome=rolled_back。"""
    import tools as _t
    _t._FAULTS["simulate_canary_unhealthy"] = True
    try:
        decisions = [
            {"action": "approve", "actor": "sre", "feedback": "", "role": "sre"},
        ] * 10
        out = asyncio.run(_drive("AC5", "tiny tweak", decisions))
        assert out["outcome"] == "rolled_back"
        assert out["rollback_count"] >= out["max_rollbacks"]
    finally:
        _t._FAULTS["simulate_canary_unhealthy"] = False


def test_report_written():
    """AC-6：finalize 必须落盘 report.json。"""
    out = asyncio.run(_drive("AC6", "tiny tweak", [_SRE, _SRE, _SRE]))
    assert Path(out["report_path"]).exists()


def test_state_schema_closure():
    """AC-7：State 字段闭包检查（防越界）。"""
    from state import ReleaseState
    allowed = set(ReleaseState.__annotations__.keys())
    out = asyncio.run(_drive("AC7", "tiny tweak", [_SRE, _SRE, _SRE]))
    extra = set(out.keys()) - allowed
    assert not extra, f"出现未声明字段: {extra}"
