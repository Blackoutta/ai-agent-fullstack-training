"""节点实现。

每个节点接收 ReleaseState，返回局部更新。模型仅在 classify_change 与 finalize
两处使用；其余节点为确定性函数或工具调用，保证演示可复现。
"""
from __future__ import annotations

import json
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Literal

from langchain_core.messages import AIMessage, ToolMessage
from langchain_openai import ChatOpenAI

from state import CheckResult, ReleaseState

# ---------------------------------------------------------------------------
# 通用辅助
# ---------------------------------------------------------------------------

def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _model() -> Any | None:
    """装配 DeepSeek 模型客户端；DEEPSEEK_API_KEY 缺失时返回 None，调用方走规则回退。"""
    api_key = os.environ.get("DEEPSEEK_API_KEY") or os.environ.get("MODEL_API_KEY")
    if not api_key:
        return None
    model_name = os.environ.get("MODEL_NAME", "deepseek-flash")
    base_url = os.environ.get("MODEL_BASE_URL", "https://api.deepseek.com")
    try:
        from langchain_deepseek import ChatDeepSeek
        return ChatDeepSeek(
            model=model_name,
            api_key=api_key,
            api_base=base_url,
            timeout=30,
            max_retries=1,
        )
    except ImportError:
        return ChatOpenAI(
            model=model_name,
            base_url=base_url,
            api_key=api_key,
            timeout=30,
            max_retries=1,
        )


STAGE_BY_CURSOR = {1: "canary_10", 2: "canary_50", 3: "prod_100"}


# ---------------------------------------------------------------------------
# 1. intake：受理工单，发出 4 路并行 tool_calls
# ---------------------------------------------------------------------------

def intake(state: ReleaseState) -> dict:
    if not state.get("ticket_id") or not state.get("service"):
        raise ValueError("ticket_id 与 service 必填")
    fanout = AIMessage(
        content="",
        tool_calls=[
            {"name": "build_service",
             "args": {"service": state["service"], "version": state["version"]},
             "id": "call_build"},
            {"name": "run_unit_tests",
             "args": {"service": state["service"]},
             "id": "call_unit"},
            {"name": "security_scan",
             "args": {"diff": state.get("patch_diff", "")},
             "id": "call_scan"},
            {"name": "dependency_audit",
             "args": {"service": state["service"]},
             "id": "call_audit"},
        ],
    )
    return {"messages": [fanout]}


# ---------------------------------------------------------------------------
# 2. tool_checks：ToolNode（在 graph.py 装配）
# ---------------------------------------------------------------------------


# ---------------------------------------------------------------------------
# 3. collect_checks：解析 ToolMessage，写入 checks 列表
# ---------------------------------------------------------------------------

def collect_checks(state: ReleaseState) -> dict:
    results: list[CheckResult] = []
    for msg in state.get("messages", []):
        if not isinstance(msg, ToolMessage):
            continue
        try:
            payload = json.loads(msg.content)
        except (TypeError, json.JSONDecodeError):
            payload = {"tool": msg.name, "passed": False, "summary": str(msg.content)}
        results.append(CheckResult(
            name=payload.get("tool", msg.name or "unknown"),
            passed=bool(payload.get("passed", False)),
            summary=payload.get("summary", ""),
            artifacts=payload.get("artifacts", []) or [],
        ))
    return {"checks": results, "messages": []}


# ---------------------------------------------------------------------------
# 4. classify_change：判定 L / M / H
# ---------------------------------------------------------------------------

def classify_change(state: ReleaseState) -> dict:
    diff = state.get("patch_diff", "")
    level = _rule_level(diff, state.get("checks", []))
    model = _model()
    if model is not None:
        try:
            level = _llm_level(model, diff, state.get("checks", [])) or level
        except Exception:
            pass
    return {"change_level": level}


def _rule_level(diff: str, checks: list[CheckResult]) -> Literal["L", "M", "H"]:
    risky = any("auth" in diff.lower() or "payment" in diff.lower() for _ in [0])
    failed = [c for c in checks if not c["passed"]]
    if failed or risky:
        return "H"
    if len(diff) > 800:
        return "M"
    return "L"


def _llm_level(model: ChatOpenAI, diff: str, checks: list[CheckResult]) -> str | None:
    from pydantic import BaseModel, ConfigDict

    class Level(BaseModel):
        model_config = ConfigDict(extra="forbid")
        level: Literal["L", "M", "H"]
        reason: str

    prompt = (
        "你是发布管理负责人。根据 diff 与检查结果给出变更等级：\n"
        "L=低风险（小修补、文案、配置）\n"
        "M=中风险（功能变更、有测试覆盖）\n"
        "H=高风险（认证/支付/数据库/大规模重构 或 有检查未通过）\n\n"
        f"diff:\n{diff[:2000]}\n\nchecks:\n{json.dumps([dict(c) for c in checks], ensure_ascii=False)[:1500]}"
    )
    out = model.with_structured_output(Level).invoke(prompt)
    return out.level


# ---------------------------------------------------------------------------
# 5-7. 三处审批 interrupt
# ---------------------------------------------------------------------------

def approval_m(state: ReleaseState) -> dict:
    from langgraph.types import interrupt
    decision = interrupt({
        "kind": "approval",
        "interrupt_id": "INT-1",
        "level": "M",
        "role": "tech_lead",
        "ticket_id": state["ticket_id"],
        "service": state["service"],
        "version": state["version"],
        "diff": state.get("patch_diff", ""),
        "checks_summary": [c["summary"] for c in state.get("checks", [])],
        "actions": ["approve", "reject", "revise"],
    })
    return {"approvals": [_as_approval(decision, "tech_lead")]}


def approval_h_lead(state: ReleaseState) -> dict:
    from langgraph.types import interrupt
    decision = interrupt({
        "kind": "approval",
        "interrupt_id": "INT-2A",
        "level": "H",
        "role": "tech_lead",
        "ticket_id": state["ticket_id"],
        "diff": state.get("patch_diff", ""),
        "actions": ["approve", "reject", "revise"],
    })
    return {"approvals": [_as_approval(decision, "tech_lead")]}


def approval_h_security(state: ReleaseState) -> dict:
    from langgraph.types import interrupt
    decision = interrupt({
        "kind": "approval",
        "interrupt_id": "INT-2B",
        "level": "H",
        "role": "security",
        "ticket_id": state["ticket_id"],
        "diff": state.get("patch_diff", ""),
        "actions": ["approve", "reject", "revise"],
    })
    return {"approvals": [_as_approval(decision, "security")]}


def _as_approval(decision: Any, role: str) -> dict:
    if not isinstance(decision, dict):
        decision = {"action": "reject", "feedback": str(decision)}
    return {
        "role": role,
        "action": decision.get("action", "reject"),
        "actor": decision.get("actor", "unknown"),
        "feedback": decision.get("feedback", ""),
        "decided_at": _now(),
    }


# ---------------------------------------------------------------------------
# 8. deploy_staging：预发部署
# ---------------------------------------------------------------------------

async def deploy_staging(state: ReleaseState) -> dict:
    from tools import deploy
    raw = await deploy.ainvoke({
        "stage": "staging",
        "service": state["service"],
        "version": state["version"],
    })
    payload = json.loads(raw)
    if not payload.get("passed"):
        return {
            "current_stage": {"stage": "staging", "started_at": _now(), "status": "unhealthy"},
            "outcome": "blocked",
        }
    return {
        "current_stage": {
            "stage": "staging",
            "started_at": _now(),
            "finished_at": _now(),
            "status": "healthy",
        },
    }


# ---------------------------------------------------------------------------
# 9. smoke_test：预发冒烟（复用 query_metrics）
# ---------------------------------------------------------------------------

async def smoke_test(state: ReleaseState) -> dict:
    from tools import query_metrics
    raw = await query_metrics.ainvoke({
        "service": state["service"], "stage": "staging", "window": "30s",
    })
    payload = json.loads(raw)
    healthy = payload.get("healthy", False) and payload.get("error_rate", 1.0) < 0.05
    sample = {
        "ts": _now(),
        "error_rate": float(payload.get("error_rate", 0)),
        "p99_ms": float(payload.get("p99_ms", 0)),
        "stage": "staging",
    }
    stage = dict(state.get("current_stage") or {"stage": "staging", "started_at": _now()})
    stage["status"] = "healthy" if healthy else "unhealthy"
    return {"metric_samples": [sample], "current_stage": stage}


# ---------------------------------------------------------------------------
# 10. begin_revision：计数 + 清空待重审字段
# ---------------------------------------------------------------------------

def begin_revision(state: ReleaseState) -> dict:
    # checks 为 replace 语义，可直接置空；approvals 为 add 语义，
    # 累计审计记录不清除，路由函数通过 approvals[-1] 读取最新决定。
    # change_level / current_stage 不重置：下一轮 classify_change 与 deploy_staging 会覆盖。
    return {
        "revision_count": state.get("revision_count", 0) + 1,
        "checks": [],
    }


# 让 reducer 接受 None 重置：begin_revision 通过返回空列表 + 重置标记，
# 实际清理由 graph.py 的路由配合 collect_checks 重新写入完成。


# ---------------------------------------------------------------------------
# 11. canary_step：SRE 确认 + 推进部署
# ---------------------------------------------------------------------------

async def canary_step(state: ReleaseState) -> dict:
    from langgraph.types import interrupt
    from tools import deploy

    cursor = state.get("canary_cursor", 0) + 1
    if cursor > 3:
        return {"outcome": "released"}
    stage = STAGE_BY_CURSOR[cursor]

    decision = interrupt({
        "kind": "approval",
        "interrupt_id": f"INT-3-{stage}",
        "role": "sre",
        "stage": stage,
        "ticket_id": state["ticket_id"],
        "service": state["service"],
        "version": state["version"],
        "actions": ["approve", "reject"],
    })
    if not isinstance(decision, dict) or decision.get("action") != "approve":
        return {
            "approvals": [_as_approval(decision, "sre")],
            "outcome": "rejected",
        }

    raw = await deploy.ainvoke({
        "stage": stage, "service": state["service"], "version": state["version"],
    })
    payload = json.loads(raw)
    return {
        "canary_cursor": cursor,
        "approvals": [_as_approval(decision, "sre")],
        "current_stage": {
            "stage": stage,
            "started_at": _now(),
            "status": "running" if payload.get("passed") else "unhealthy",
        },
    }


# ---------------------------------------------------------------------------
# 12. monitor_window：拉指标，评估健康度
# ---------------------------------------------------------------------------

async def monitor_window(state: ReleaseState) -> dict:
    from tools import query_metrics
    stage = (state.get("current_stage") or {}).get("stage", "canary_10")
    raw = await query_metrics.ainvoke({
        "service": state["service"], "stage": stage, "window": "1m",
    })
    payload = json.loads(raw)
    sample = {
        "ts": _now(),
        "error_rate": float(payload.get("error_rate", 0)),
        "p99_ms": float(payload.get("p99_ms", 0)),
        "stage": stage,
    }
    healthy = bool(payload.get("healthy", False))
    stage_update = dict(state.get("current_stage") or {"stage": stage, "started_at": _now()})
    stage_update["status"] = "healthy" if healthy else "unhealthy"
    stage_update["finished_at"] = _now()
    return {"metric_samples": [sample], "current_stage": stage_update}


# ---------------------------------------------------------------------------
# 13. auto_rollback：回滚当前阶段
# ---------------------------------------------------------------------------

async def auto_rollback(state: ReleaseState) -> dict:
    from tools import rollback
    stage = (state.get("current_stage") or {}).get("stage", "canary_10")
    raw = await rollback.ainvoke({"stage": stage, "service": state["service"]})
    payload = json.loads(raw)
    stage_update = dict(state.get("current_stage") or {"stage": stage, "started_at": _now()})
    stage_update["status"] = "rolled_back"
    return {
        "rollback_count": state.get("rollback_count", 0) + 1,
        "current_stage": stage_update,
        "canary_cursor": max(0, state.get("canary_cursor", 1) - 1),
    }


# ---------------------------------------------------------------------------
# 14. finalize：生成报告（LLM 摘要 + 落盘）
# ---------------------------------------------------------------------------
# 注意：finalize 是 sync 节点。原因：内部 _write_report 用 os.mkdir + Path.write_text，
# 都是同步阻塞 I/O。langgraph dev 的 blockbuster 会拦截 async 节点里的阻塞调用。
# sync 节点由 LangGraph 自动放进 thread pool 执行，不触发拦截。

def finalize(state: ReleaseState) -> dict:
    outcome = state.get("outcome") or _infer_outcome(state)
    summary = _llm_summary(state, outcome) or _rule_summary(state, outcome)
    report_path = _write_report(state, outcome, summary)
    return {
        "outcome": outcome,
        "report_summary": summary,
        "report_path": report_path,
    }


def _infer_outcome(state: ReleaseState) -> str:
    if state.get("rollback_count", 0) >= state.get("max_rollbacks", 2):
        return "rolled_back"
    approvals = state.get("approvals", [])
    if any(a["action"] == "reject" for a in approvals):
        return "rejected"
    if state.get("canary_cursor", 0) >= 3:
        return "released"
    if state.get("revision_count", 0) >= state.get("max_revisions", 2):
        return "incomplete"
    return "incomplete"


def _rule_summary(state: ReleaseState, outcome: str) -> str:
    return (
        f"工单 {state['ticket_id']} ({state['service']}@{state['version']}) "
        f"终态={outcome}；修订={state.get('revision_count',0)}，"
        f"回滚={state.get('rollback_count',0)}，"
        f"灰度游标={state.get('canary_cursor',0)}/3。"
    )


def _llm_summary(state: ReleaseState, outcome: str) -> str | None:
    model = _model()
    if model is None:
        return None
    try:
        from pydantic import BaseModel, ConfigDict

        class Report(BaseModel):
            model_config = ConfigDict(extra="forbid")
            summary: str
            highlights: list[str]
            risks: list[str]

        payload = {
            "ticket": state["ticket_id"],
            "service": state["service"],
            "version": state["version"],
            "outcome": outcome,
            "checks": [dict(c) for c in state.get("checks", [])],
            "approvals": [dict(a) for a in state.get("approvals", [])],
            "samples": [dict(s) for s in state.get("metric_samples", [])][-6:],
            "revision_count": state.get("revision_count", 0),
            "rollback_count": state.get("rollback_count", 0),
        }
        prompt = (
            "根据下列发布流水线运行记录，写一段不超过 120 字的中文 summary，"
            "并列出 2-3 条 highlights 与 risks：\n"
            + json.dumps(payload, ensure_ascii=False)
        )
        rep = model.with_structured_output(Report).invoke(prompt)
        return rep.summary
    except Exception:
        return None


def _write_report(state: ReleaseState, outcome: str, summary: str) -> str:
    reports_dir = Path(os.environ.get("REPORTS_DIR", "./reports"))
    reports_dir.mkdir(parents=True, exist_ok=True)
    path = reports_dir / f"{state['ticket_id']}.json"
    path.write_text(json.dumps({
        "ticket_id": state["ticket_id"],
        "service": state["service"],
        "version": state["version"],
        "outcome": outcome,
        "summary": summary,
        "checks": state.get("checks", []),
        "approvals": state.get("approvals", []),
        "metric_samples": state.get("metric_samples", []),
        "revision_count": state.get("revision_count", 0),
        "rollback_count": state.get("rollback_count", 0),
        "final_stage": state.get("current_stage"),
        "generated_at": _now(),
    }, ensure_ascii=False, indent=2), encoding="utf-8")
    return str(path)
