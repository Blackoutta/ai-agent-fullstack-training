"""审批图本身的规则测试：不起 HTTP、不连 pi，直接问这张图。

这一层要守住的只有一句话：谁能批、能不能自己批、批成什么样，全写在图里，
不在 TypeScript 那侧，也不在服务那侧。所以这些规则必须在这张图上验，
换个门面（HTTP、CLI、以后再加的 Web 页）才不用重测一遍。
"""

from __future__ import annotations

import pytest
from langgraph.checkpoint.memory import InMemorySaver

from graph import build_graph


def new_ticket(**overrides) -> dict:
    base = {
        "ticket_id": "t-1",
        "trace_id": "trace-1",
        "tenant_id": "tenant_a",
        "user_id": "trainer-1",
        "roles": ["maintainer"],
        "tool_name": "codebase_agent_write_file",
        "args_digest": "sha256:abc",
        "workspace": "/repo/demo",
        "risk": "medium",
        "reason": "该动作必须绑定参数后由人确认",
        "approvers": ["maintainer"],
    }
    base.update(overrides)
    return base


def test_eligible_when_initiator_holds_a_role_on_the_roster():
    from graph import check_eligible

    out = check_eligible(new_ticket(roles=["reviewer", "maintainer"]))
    assert out == {"status": "awaiting_human", "code": "AWAITING_HUMAN"}


def test_reject_before_bothering_a_human_when_no_one_can_approve():
    from graph import check_eligible

    # 名单是 [maintainer, tech_lead] 时，只有 reviewer 身份的人发起，这张单没人有资格批。
    out = check_eligible(new_ticket(roles=["reviewer"], approvers=["maintainer", "tech_lead"]))
    assert out["status"] == "rejected"
    assert out["code"] == "NO_ELIGIBLE_APPROVER"
    assert "maintainer" in out["feedback"]


def test_empty_roster_fails_closed_before_any_human_sees_the_ticket():
    from graph import check_eligible

    # 名单为空是配置漏写，不是"谁都可以批"。宁可开不了工，也不要一张看起来有人把关的单。
    out = check_eligible(new_ticket(approvers=[]))
    assert out["status"] == "rejected"
    assert out["code"] == "NO_APPROVER_CONFIGURED"


def test_approver_must_not_be_the_initiator():
    from graph import check_approver

    out = check_approver(new_ticket(status="decided", code="approve", decided_by="trainer-1", actor_roles=["maintainer"]))
    assert out == {"status": "rejected", "code": "SELF_APPROVAL_DENIED", "feedback": "审批人不能是发起人自己"}


def test_approver_has_to_be_on_the_roster():
    from graph import check_approver

    out = check_approver(
        new_ticket(status="decided", code="approve", decided_by="manager-1", actor_roles=["reviewer"])
    )
    assert out["status"] == "rejected"
    assert out["code"] == "APPROVER_ROLE_DENIED"


def test_any_role_on_the_roster_can_approve():
    from graph import check_approver

    out = check_approver(
        new_ticket(
            approvers=["maintainer", "tech_lead"],
            status="decided",
            code="approve",
            decided_by="lead-1",
            actor_roles=["tech_lead"],
        )
    )
    assert out == {"status": "approved", "code": "APPROVED"}


def test_a_valid_reject_stays_a_reject():
    from graph import check_approver

    out = check_approver(
        new_ticket(status="decided", code="reject", decided_by="manager-1", actor_roles=["maintainer"])
    )
    assert out == {"status": "rejected", "code": "HUMAN_REJECTED"}


def test_a_valid_approve_is_the_only_approved_path():
    from graph import check_approver

    out = check_approver(
        new_ticket(status="decided", code="approve", decided_by="manager-1", actor_roles=["maintainer"])
    )
    assert out == {"status": "approved", "code": "APPROVED"}


def test_an_unrecognized_action_never_becomes_approved():
    from graph import check_approver

    out = check_approver(new_ticket(status="decided", code="maybe", decided_by="manager-1", actor_roles=["maintainer"]))
    assert out["status"] == "rejected"
    assert out["code"] == "INVALID_DECISION"


def test_graph_stops_at_the_human_without_deciding():
    graph = build_graph(InMemorySaver())
    config = {"configurable": {"thread_id": "t-1"}}

    first = graph.invoke(new_ticket(), config)
    snapshot = graph.get_state(config)
    interrupts = [intr for task in snapshot.tasks for intr in task.interrupts]
    assert len(interrupts) == 1
    payload = interrupts[0].value
    assert payload["kind"] == "approval"
    assert payload["ticket_id"] == "t-1"
    assert payload["actions"] == ["approve", "reject"]
    assert "decided_by" not in first


def test_resume_with_a_clean_approve_lands_on_approved():
    from langgraph.types import Command

    graph = build_graph(InMemorySaver())
    config = {"configurable": {"thread_id": "t-2"}}
    graph.invoke(new_ticket(ticket_id="t-2"), config)

    out = graph.invoke(
        Command(resume={"action": "approve", "actor": "manager-1", "roles": ["maintainer"], "feedback": "可以改"}),
        config,
    )
    assert out["status"] == "approved"
    assert out["code"] == "APPROVED"
    assert out["decided_by"] == "manager-1"


def test_resume_with_a_self_approval_lands_on_rejected():
    from langgraph.types import Command

    graph = build_graph(InMemorySaver())
    config = {"configurable": {"thread_id": "t-3"}}
    graph.invoke(new_ticket(ticket_id="t-3"), config)

    out = graph.invoke(
        Command(resume={"action": "approve", "actor": "trainer-1", "roles": ["maintainer"], "feedback": ""}), config
    )
    assert out["status"] == "rejected"
    assert out["code"] == "SELF_APPROVAL_DENIED"


def test_eligibility_rejection_never_reaches_the_human_node():
    graph = build_graph(InMemorySaver())
    config = {"configurable": {"thread_id": "t-4"}}

    out = graph.invoke(new_ticket(ticket_id="t-4", roles=["reviewer"], approvers=["maintainer", "tech_lead"]), config)
    assert out["status"] == "rejected"
    assert out["code"] == "NO_ELIGIBLE_APPROVER"
    assert graph.get_state(config).tasks == ()


def test_empty_roster_never_reaches_the_human_node_on_the_full_graph():
    graph = build_graph(InMemorySaver())
    config = {"configurable": {"thread_id": "t-6"}}

    out = graph.invoke(new_ticket(ticket_id="t-6", approvers=[]), config)
    assert out["code"] == "NO_APPROVER_CONFIGURED"
    assert graph.get_state(config).tasks == ()


def test_interrupt_survives_a_new_graph_object_on_the_same_checkpointer():
    """图停在 interrupt 时，现场是在 checkpointer 里，不是在 Python 进程里。

    换一个新编译出来的图、甚至服务重启之后再拿同一个 thread_id 问，
    未决审批还在原地等人答复——这就是审批走图而不是走内存的用处。
    """
    from langgraph.types import Command

    saver = InMemorySaver()
    config = {"configurable": {"thread_id": "t-5"}}
    build_graph(saver).invoke(new_ticket(ticket_id="t-5"), config)

    reopened = build_graph(saver)
    assert [intr for task in reopened.get_state(config).tasks for intr in task.interrupts]

    out = reopened.invoke(
        Command(resume={"action": "reject", "actor": "manager-1", "roles": ["maintainer"], "feedback": "这次不许改"}),
        config,
    )
    assert out["code"] == "HUMAN_REJECTED"


if __name__ == "__main__":
    raise SystemExit(pytest.main([__file__, "-v"]))
