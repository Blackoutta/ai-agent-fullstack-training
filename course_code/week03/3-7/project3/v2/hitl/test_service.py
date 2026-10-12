"""审批图那层 HTTP 门面的契约测试。

TypeScript 侧（src/hitl/client.ts）打的是这套形状，它的单测用的是自己写的桩。
桩和真服务各说各话是这类集成最典型的翻车方式，所以这一份测试把"线上到底长什么样"钉死：
状态只有 awaiting_human / approved / rejected 三种、错误一律走 code 字段、
重复提单 409、答复一张不等人的单 409、除了 /health 全都要 Bearer token。
"""

from __future__ import annotations

import os
import tempfile

_TMP_DIR = tempfile.mkdtemp(prefix="hitl-service-")
os.environ["HITL_API_KEY"] = "test-key"
os.environ["HITL_DB"] = os.path.join(_TMP_DIR, "checkpoint.db")

import service  # noqa: E402
from starlette.testclient import TestClient  # noqa: E402

AUTH = {"authorization": "Bearer test-key"}


def ticket(ticket_id: str, **overrides) -> dict:
    base = {
        "ticket_id": ticket_id,
        "trace_id": f"trace-{ticket_id}",
        "tenant_id": "tenant_a",
        "user_id": "trainer-1",
        "roles": ["maintainer"],
        "tool_name": "write_file",
        "args_digest": "sha256:deadbeef",
        "workspace": "/repo/demo",
        "risk": "write",
        "reason": "该动作必须绑定参数后由人确认",
        "approvers": ["maintainer"],
    }
    base.update(overrides)
    return base


def test_health_is_the_only_endpoint_without_a_token():
    with TestClient(service.app) as client:
        response = client.get("/health")
    assert response.status_code == 200
    assert response.json()["graph"] == "approval"


def test_every_other_endpoint_needs_the_bearer_token():
    with TestClient(service.app) as client:
        assert client.get("/tickets").status_code == 401
        assert client.get("/tickets", headers={"authorization": "Bearer nope"}).status_code == 401
        assert client.get("/tickets", headers={"authorization": "Bearer nope"}).json()["code"] == "UNAUTHORIZED"


def test_opening_a_ticket_leaves_the_graph_waiting_for_a_human():
    with TestClient(service.app) as client:
        body = client.post("/tickets", json=ticket("t-open"), headers=AUTH).json()
    assert body["status"] == "awaiting_human"
    assert body["interrupt"]["tool_name"] == "write_file"
    assert body["interrupt"]["args_digest"] == "sha256:deadbeef"
    assert body["interrupt"]["actions"] == ["approve", "reject"]
    # 单子要带着名单到人手里：不看名单就答"批"，批完才知道自己根本没资格。
    assert body["interrupt"]["approvers"] == ["maintainer"]


def test_a_ticket_id_can_only_be_opened_once():
    with TestClient(service.app) as client:
        client.post("/tickets", json=ticket("t-twice"), headers=AUTH)
        again = client.post("/tickets", json=ticket("t-twice"), headers=AUTH)
    assert again.status_code == 409
    assert again.json()["code"] == "TICKET_ALREADY_OPEN"


def test_an_unknown_ticket_is_a_404_not_an_empty_approval():
    with TestClient(service.app) as client:
        response = client.get("/tickets/t-none", headers=AUTH)
    assert response.status_code == 404
    assert response.json()["code"] == "TICKET_NOT_FOUND"


def test_a_clean_approve_ends_the_ticket_approved():
    with TestClient(service.app) as client:
        client.post("/tickets", json=ticket("t-approve"), headers=AUTH)
        decided = client.post(
            "/tickets/t-approve/resume",
            json={"action": "approve", "actor": "manager-1", "roles": ["maintainer"], "feedback": "可以落库"},
            headers=AUTH,
        ).json()
        assert decided == {
            "ticket_id": "t-approve",
            "status": "approved",
            "code": "APPROVED",
            "decided_by": "manager-1",
            "feedback": "可以落库",
        }
        # 批完的单不接受第二次答复：否则"这次到底批没批"会有两个答案。
        twice = client.post(
            "/tickets/t-approve/resume",
            json={"action": "reject", "actor": "manager-2", "roles": ["maintainer"]},
            headers=AUTH,
        )
    assert twice.status_code == 409
    assert twice.json()["code"] == "TICKET_NOT_AWAITING_HUMAN"


def test_the_initiator_approving_his_own_ticket_is_rejected_by_the_graph():
    with TestClient(service.app) as client:
        client.post("/tickets", json=ticket("t-self"), headers=AUTH)
        decided = client.post(
            "/tickets/t-self/resume",
            json={"action": "approve", "actor": "trainer-1", "roles": ["maintainer"]},
            headers=AUTH,
        ).json()
    assert decided["status"] == "rejected"
    assert decided["code"] == "SELF_APPROVAL_DENIED"


def test_an_initiator_outside_the_roster_never_reaches_a_human():
    with TestClient(service.app) as client:
        opened = client.post(
            "/tickets", json=ticket("t-role", roles=["reviewer"], approvers=["maintainer", "tech_lead"]), headers=AUTH
        ).json()
    assert opened["status"] == "rejected"
    assert opened["code"] == "NO_ELIGIBLE_APPROVER"
    assert "interrupt" not in opened


def test_an_empty_roster_fails_closed_over_http_too():
    with TestClient(service.app) as client:
        opened = client.post("/tickets", json=ticket("t-noroster", approvers=[]), headers=AUTH).json()
    # 名单为空是配置漏写。这边不替它补默认角色，补了就把配置错误藏起来了。
    assert opened["code"] == "NO_APPROVER_CONFIGURED"
    assert "interrupt" not in opened


def test_the_ticket_list_comes_from_the_checkpointer_not_a_second_table():
    with TestClient(service.app) as client:
        client.post("/tickets", json=ticket("t-list-open"), headers=AUTH)
        client.post("/tickets", json=ticket("t-list-done"), headers=AUTH)
        client.post(
            "/tickets/t-list-done/resume",
            json={"action": "reject", "actor": "manager-1", "roles": ["maintainer"]},
            headers=AUTH,
        )
        listing = client.get("/tickets", headers=AUTH).json()
    by_id = {item["ticket_id"]: item for item in listing["tickets"]}
    assert by_id["t-list-open"]["status"] == "awaiting_human"
    assert by_id["t-list-done"]["status"] == "rejected"
    assert by_id["t-list-done"]["code"] == "HUMAN_REJECTED"
    assert by_id["t-list-open"]["tool_name"] == "write_file"
    assert listing["total"] == len(listing["tickets"])
