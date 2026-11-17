"""审批图的 HTTP 门面：pi（TypeScript）只走 HTTP，不 import 任何 Python。

三个约定：
1. 一个审批单 = 一个 thread_id。TS 侧的 approval id 直接当线程号用，两边不必再存映射表。
2. 服务不落自己的表。工单目录、当前状态、待处理 interrupt 全部问 checkpointer，
   所以"进程重启，未决审批还在"是白送的，而不是我们写存储代码换来的。
3. 除了 /health，其余接口都要 Bearer token。它不是给用户看的接口，是给运行时用的接口。
"""

from __future__ import annotations

import json
import os
from contextlib import asynccontextmanager
from pathlib import Path

from langgraph.checkpoint.sqlite.aio import AsyncSqliteSaver
from langgraph.types import Command
from starlette.applications import Starlette
from starlette.requests import Request
from starlette.responses import JSONResponse
from starlette.routing import Route

from graph import build_graph

API_KEY = os.environ.get("HITL_API_KEY", "")
# 默认路径跟着这个文件走，不跟着终端当前目录走：换个目录启动，未决审批不会凭空消失。
DEFAULT_DB = Path(__file__).resolve().parents[1] / "data" / "hitl.db"
DB_PATH = Path(os.environ.get("HITL_DB", str(DEFAULT_DB))).resolve()
HOST = os.environ.get("HITL_HOST", "127.0.0.1")
PORT = int(os.environ.get("HITL_PORT", "8383"))

# 只有这些字段能进图；多余的键一律丢掉，防止 HTTP 面把状态结构撑开。
TICKET_FIELDS = (
    "ticket_id",
    "trace_id",
    "tenant_id",
    "user_id",
    "roles",
    "tool_name",
    "args_digest",
    "workspace",
    "risk",
    "reason",
    "approvers",
)


@asynccontextmanager
async def lifespan(app: Starlette):
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    saver_cm = AsyncSqliteSaver.from_conn_string(str(DB_PATH))
    saver = await saver_cm.__aenter__()
    app.state.saver = saver
    app.state.graph = build_graph(saver)
    yield
    await saver_cm.__aexit__(None, None, None)


def _config(ticket_id: str) -> dict:
    return {"configurable": {"thread_id": ticket_id}}


def _graph():
    return app.state.graph


async def _snapshot(ticket_id: str) -> JSONResponse:
    """把一个线程的当前位置翻成固定形状：status / code / interrupt / feedback。"""
    snap = await _graph().aget_state(_config(ticket_id))
    values = snap.values or {}
    interrupts = [intr.value for task in (snap.tasks or []) for intr in (task.interrupts or [])]
    if interrupts:
        return JSONResponse(
            {"ticket_id": ticket_id, "status": "awaiting_human", "code": "AWAITING_HUMAN", "interrupt": interrupts[0]}
        )
    if not values:
        return JSONResponse({"ticket_id": ticket_id, "code": "TICKET_NOT_FOUND"}, status_code=404)
    return JSONResponse(
        {
            "ticket_id": ticket_id,
            "status": values.get("status", "unknown"),
            "code": values.get("code", ""),
            "decided_by": values.get("decided_by", ""),
            "feedback": values.get("feedback", ""),
        }
    )


def _unauthorized(request: Request) -> JSONResponse | None:
    if not API_KEY:
        return JSONResponse({"code": "SERVER_MISCONFIGURED", "message": "HITL_API_KEY 未设置"}, status_code=503)
    if request.headers.get("authorization") != f"Bearer {API_KEY}":
        return JSONResponse({"code": "UNAUTHORIZED"}, status_code=401)
    return None


async def health(request: Request) -> JSONResponse:
    return JSONResponse({"status": "ok", "graph": "approval", "checkpoint_db": str(DB_PATH)})


async def open_ticket(request: Request) -> JSONResponse:
    denied = _unauthorized(request)
    if denied:
        return denied
    body = await request.json()
    ticket = {key: body[key] for key in TICKET_FIELDS if key in body}
    if not ticket.get("ticket_id"):
        return JSONResponse({"code": "TICKET_ID_REQUIRED"}, status_code=400)
    config = _config(ticket["ticket_id"])
    existing = await _graph().aget_state(config)
    if existing.values:
        # 同一个单号开第二次会往同一条线程上再跑一遍图，状态就被改写一次。审批单是一次性的，重开不算重试。
        return JSONResponse(
            {"ticket_id": ticket["ticket_id"], "code": "TICKET_ALREADY_OPEN", "message": "同一张审批单不能重复提单"},
            status_code=409,
        )
    async for _ in _graph().astream(ticket, config=config, stream_mode="updates"):
        pass
    return await _snapshot(ticket["ticket_id"])


async def get_ticket(request: Request) -> JSONResponse:
    denied = _unauthorized(request)
    if denied:
        return denied
    return await _snapshot(request.path_params["ticket_id"])


async def resume_ticket(request: Request) -> JSONResponse:
    denied = _unauthorized(request)
    if denied:
        return denied
    ticket_id = request.path_params["ticket_id"]
    # 没有 interrupt 可恢复时不能让它静默走一遍：LangGraph 会把旧状态原样返回，
    # 调用方就分不清"这次批了"和"这单早就结束了"。所以先问一句它到底在不在等人。
    waiting = [intr for task in ((await _graph().aget_state(_config(ticket_id))).tasks or []) for intr in task.interrupts]
    if not waiting:
        return JSONResponse(
            {"ticket_id": ticket_id, "code": "TICKET_NOT_AWAITING_HUMAN", "message": "这张单没有等待中的人工答复"},
            status_code=409,
        )
    body = await request.json()
    decision = {
        "action": str(body.get("action") or ""),
        "actor": str(body.get("actor") or ""),
        "roles": [str(role) for role in (body.get("roles") or [])],
        "feedback": str(body.get("feedback") or ""),
    }
    async for _ in _graph().astream(Command(resume=decision), config=_config(ticket_id), stream_mode="updates"):
        pass
    return await _snapshot(ticket_id)


async def list_tickets(request: Request) -> JSONResponse:
    denied = _unauthorized(request)
    if denied:
        return denied
    # 目录直接从 checkpointer 的线程表里取，不另建一份：多一张表就多一个会说谎的地方。
    cursor = await app.state.saver.conn.execute(
        "SELECT thread_id FROM checkpoints WHERE checkpoint_ns = '' GROUP BY thread_id ORDER BY MIN(rowid) DESC LIMIT 50"
    )
    rows = await cursor.fetchall()
    items = []
    for row in rows:
        snap = await _graph().aget_state(_config(row[0]))
        values = snap.values or {}
        pending = any(task.interrupts for task in (snap.tasks or []))
        items.append(
            {
                "ticket_id": row[0],
                "status": "awaiting_human" if pending else values.get("status", "unknown"),
                "code": "AWAITING_HUMAN" if pending else values.get("code", ""),
                "tool_name": values.get("tool_name", ""),
                "trace_id": values.get("trace_id", ""),
            }
        )
    return JSONResponse({"tickets": items, "total": len(items)})


app = Starlette(
    lifespan=lifespan,
    routes=[
        Route("/health", health, methods=["GET"]),
        Route("/tickets", open_ticket, methods=["POST"]),
        Route("/tickets", list_tickets, methods=["GET"]),
        Route("/tickets/{ticket_id}", get_ticket, methods=["GET"]),
        Route("/tickets/{ticket_id}/resume", resume_ticket, methods=["POST"]),
    ],
)


if __name__ == "__main__":
    import uvicorn

    if not API_KEY:
        raise SystemExit("HITL_API_KEY 必须设置：这张图能决定要不要放行一次写操作，不能裸奔")
    print(json.dumps({"host": HOST, "port": PORT, "checkpoint_db": str(DB_PATH)}, ensure_ascii=False))
    uvicorn.run(app, host=HOST, port=PORT, log_level="warning")
