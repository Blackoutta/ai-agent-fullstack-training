"""审批工作流本体：一张 LangGraph 图，人在回路落在 request_human 节点的 interrupt 上。

pi 侧不直接碰这张图，它只发 HTTP（见 service.py）。图的状态全部由 checkpointer 落盘，
所以"服务重启，未决审批还在"这件事不用我们写一行存储代码。
"""

from __future__ import annotations

from typing import TypedDict

from langgraph.graph import END, START, StateGraph
from langgraph.types import interrupt


class Ticket(TypedDict, total=False):
    ticket_id: str
    trace_id: str
    tenant_id: str
    user_id: str
    roles: list[str]
    tool_name: str
    args_digest: str
    workspace: str
    risk: str
    reason: str
    approvers: list[str]
    status: str
    code: str
    decided_by: str
    actor_roles: list[str]
    feedback: str


def check_eligible(state: Ticket) -> dict:
    """第一道门：这单连人都没找对，就不必打扰人——审批名单是空的，或者发起人群里没人能批。"""
    approvers = state.get("approvers") or []
    roles = state.get("roles") or []
    if not approvers:
        # 名单为空 = 这类任务根本没打算有人批。宁可开不了工，也不要"看起来有人把关"。
        return {
            "status": "rejected",
            "code": "NO_APPROVER_CONFIGURED",
            "feedback": "这张单没有配审批名单（approvers 为空），谁批都不算数",
        }
    if not set(approvers) & set(roles):
        return {
            "status": "rejected",
            "code": "NO_ELIGIBLE_APPROVER",
            "feedback": f"发起人角色 {'、'.join(roles) or '（空）'} 与审批名单 {'、'.join(approvers)} 没有交集，这张单没人有资格批",
        }
    return {"status": "awaiting_human", "code": "AWAITING_HUMAN"}


def request_human(state: Ticket) -> dict:
    """图在这里停住，把审批单抛给 HTTP；人给出的答复从 interrupt 的返回值里回来。"""
    decision = interrupt(
        {
            "kind": "approval",
            "ticket_id": state["ticket_id"],
            "tool_name": state["tool_name"],
            "args_digest": state["args_digest"],
            "workspace": state["workspace"],
            "risk": state.get("risk", ""),
            "reason": state.get("reason", ""),
            "approvers": state.get("approvers", []),
            "actions": ["approve", "reject"],
        }
    ) or {}
    return {
        "decided_by": str(decision.get("actor") or ""),
        "actor_roles": [str(r) for r in (decision.get("roles") or [])],
        "feedback": str(decision.get("feedback") or ""),
        "status": "decided",
        "code": str(decision.get("action") or ""),
    }


def check_approver(state: Ticket) -> dict:
    """第二道门：批的人得对得上规则——审批人不能是发起人本人，且必须落在审批名单里。"""
    if state.get("code") not in ("approve", "reject"):
        return {"status": "rejected", "code": "INVALID_DECISION", "feedback": "答复里 action 既不是 approve 也不是 reject"}
    if not state.get("decided_by") or state["decided_by"] == state.get("user_id"):
        return {"status": "rejected", "code": "SELF_APPROVAL_DENIED", "feedback": "审批人不能是发起人自己"}
    approvers = state.get("approvers") or []
    actor_roles = state.get("actor_roles") or []
    if not set(approvers) & set(actor_roles):
        return {
            "status": "rejected",
            "code": "APPROVER_ROLE_DENIED",
            "feedback": f"审批人角色 {'、'.join(actor_roles) or '（空）'} 不在审批名单 {'、'.join(approvers)} 里",
        }
    if state["code"] == "reject":
        return {"status": "rejected", "code": "HUMAN_REJECTED"}
    return {"status": "approved", "code": "APPROVED"}


def _after_eligibility(state: Ticket) -> str:
    return END if state.get("status") == "rejected" else "request_human"


def build_graph(checkpointer):
    graph = StateGraph(Ticket)
    graph.add_node("check_eligible", check_eligible)
    graph.add_node("request_human", request_human)
    graph.add_node("check_approver", check_approver)
    graph.add_edge(START, "check_eligible")
    graph.add_conditional_edges(
        "check_eligible", _after_eligibility, {END: END, "request_human": "request_human"}
    )
    graph.add_edge("request_human", "check_approver")
    graph.add_edge("check_approver", END)
    return graph.compile(checkpointer=checkpointer)
