"""图装配：节点注册、边、条件路由。

闭世界原则：本文件出现的节点名必须与 nodes.py 中的实现一一对应，
路由函数返回值必须与 add_conditional_edges 的映射键完全一致。
"""
from __future__ import annotations

from typing import Literal

from langgraph.graph import END, START, StateGraph
from langgraph.prebuilt import ToolNode

import nodes
from state import ReleaseState
from tools import CHECK_TOOLS


# ---------------------------------------------------------------------------
# 路由函数：返回值即 add_conditional_edges 映射的键
# ---------------------------------------------------------------------------

def route_after_checks(
    state: ReleaseState,
) -> Literal["ok", "blocked"]:
    checks = state.get("checks", [])
    if not checks:
        return "blocked"
    if any(not c["passed"] for c in checks):
        return "blocked"
    return "ok"


def route_by_level(state: ReleaseState) -> Literal["L", "M", "H"]:
    return state.get("change_level", "M")


def route_approval(
    state: ReleaseState,
) -> Literal["approve", "revise", "reject", "stop"]:
    approvals = state.get("approvals", [])
    if not approvals:
        return "stop"
    last = approvals[-1]["action"]
    if last == "approve":
        return "approve"
    if last == "reject":
        return "reject"
    if state.get("revision_count", 0) >= state.get("max_revisions", 2):
        return "stop"
    return "revise"


def route_after_smoke(
    state: ReleaseState,
) -> Literal["pass", "fail", "stop"]:
    if state.get("outcome") == "blocked":
        return "stop"
    stage = state.get("current_stage") or {}
    if stage.get("status") == "healthy":
        return "pass"
    if state.get("revision_count", 0) >= state.get("max_revisions", 2):
        return "stop"
    return "fail"


def route_after_canary(
    state: ReleaseState,
) -> Literal["monitor", "finalize"]:
    # canary_step 内若 SRE 拒绝或已推进到 cursor>3，会直接写 outcome 并要求收尾
    if state.get("outcome") in ("rejected", "released"):
        return "finalize"
    return "monitor"


def route_after_monitor(
    state: ReleaseState,
) -> Literal["advance", "unhealthy", "released"]:
    stage = state.get("current_stage") or {}
    if stage.get("status") != "healthy":
        return "unhealthy"
    if state.get("canary_cursor", 0) >= 3:
        return "released"
    return "advance"


def route_after_rollback(
    state: ReleaseState,
) -> Literal["retry", "abort"]:
    if state.get("rollback_count", 0) >= state.get("max_rollbacks", 2):
        return "abort"
    return "retry"


# ---------------------------------------------------------------------------
# 装配
# ---------------------------------------------------------------------------

APPROVAL_MAP = {
    "approve": "deploy_staging",
    "revise": "begin_revision",
    "reject": "finalize",
    "stop": "finalize",
}


def build_graph(checkpointer=None):
    builder = StateGraph(ReleaseState)

    builder.add_node("intake", nodes.intake)
    builder.add_node("tool_checks", ToolNode(CHECK_TOOLS))
    builder.add_node("collect_checks", nodes.collect_checks)
    builder.add_node("classify_change", nodes.classify_change)
    builder.add_node("approval_m", nodes.approval_m)
    builder.add_node("approval_h_lead", nodes.approval_h_lead)
    builder.add_node("approval_h_security", nodes.approval_h_security)
    builder.add_node("deploy_staging", nodes.deploy_staging)
    builder.add_node("smoke_test", nodes.smoke_test)
    builder.add_node("begin_revision", nodes.begin_revision)
    builder.add_node("canary_step", nodes.canary_step)
    builder.add_node("monitor_window", nodes.monitor_window)
    builder.add_node("auto_rollback", nodes.auto_rollback)
    builder.add_node("finalize", nodes.finalize)

    builder.add_edge(START, "intake")
    builder.add_edge("intake", "tool_checks")
    builder.add_edge("tool_checks", "collect_checks")

    builder.add_conditional_edges("collect_checks", route_after_checks, {
        "ok": "classify_change",
        "blocked": "finalize",
    })

    builder.add_conditional_edges("classify_change", route_by_level, {
        "L": "deploy_staging",
        "M": "approval_m",
        "H": "approval_h_lead",
    })

    builder.add_conditional_edges("approval_m", route_approval, APPROVAL_MAP)
    builder.add_edge("approval_h_lead", "approval_h_security")
    builder.add_conditional_edges("approval_h_security", route_approval, APPROVAL_MAP)

    builder.add_edge("deploy_staging", "smoke_test")
    builder.add_conditional_edges("smoke_test", route_after_smoke, {
        "pass": "canary_step",
        "fail": "begin_revision",
        "stop": "finalize",
    })

    builder.add_edge("begin_revision", "intake")

    builder.add_conditional_edges("canary_step", route_after_canary, {
        "monitor": "monitor_window",
        "finalize": "finalize",
    })
    builder.add_conditional_edges("monitor_window", route_after_monitor, {
        "advance": "canary_step",
        "unhealthy": "auto_rollback",
        "released": "finalize",
    })
    builder.add_conditional_edges("auto_rollback", route_after_rollback, {
        "retry": "canary_step",
        "abort": "finalize",
    })

    builder.add_edge("finalize", END)

    return builder.compile(checkpointer=checkpointer)
