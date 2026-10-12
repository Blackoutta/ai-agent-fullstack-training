"""CLI 入口：submit / status / approve / tail / visualize / demo。

所有子命令共享同一个 thread_id（= ticket_id）与同一个 SQLite Checkpointer，
因此 Ctrl-C 杀进程后用 status + approve 仍能恢复。
"""
from __future__ import annotations

import asyncio
import json
import os
from pathlib import Path

import typer
from dotenv import load_dotenv
from rich.console import Console
from rich.table import Table

load_dotenv()

from checkpointer import open_checkpointer  # noqa: E402
from graph import build_graph  # noqa: E402
from visualize import export_mermaid  # noqa: E402

app = typer.Typer(add_completion=False, help="LangGraph 发布流水线 Demo")
console = Console()


def _initial_state(ticket: str, service: str, version: str, diff: str) -> dict:
    return {
        "ticket_id": ticket,
        "service": service,
        "version": version,
        "patch_diff": diff,
        "revision_count": 0,
        "rollback_count": 0,
        "max_revisions": 2,
        "max_rollbacks": 2,
        "canary_cursor": 0,
        "messages": [],
        "checks": [],
        "approvals": [],
        "metric_samples": [],
    }


async def _submit(ticket: str, service: str, version: str, diff: str) -> None:
    async with open_checkpointer() as cp:
        graph = build_graph(cp)
        config = {"configurable": {"thread_id": ticket}}
        async for ev in graph.astream(_initial_state(ticket, service, version, diff),
                                      config=config, stream_mode="updates"):
            _render_event(ev)
        await _show_pending(graph, config)


async def _status(ticket: str) -> None:
    async with open_checkpointer() as cp:
        graph = build_graph(cp)
        config = {"configurable": {"thread_id": ticket}}
        snap = await graph.aget_state(config)
        if not snap or not snap.values:
            console.print(f"[red]未找到工单 {ticket}[/red]")
            return
        table = Table(title=f"工单 {ticket} 状态")
        table.add_column("字段"); table.add_column("值")
        for k in ("outcome", "change_level", "canary_cursor",
                  "revision_count", "rollback_count", "report_path"):
            table.add_row(k, str(snap.values.get(k, "-")))
        table.add_row("next", ", ".join(snap.next or []) or "-")
        console.print(table)
        await _show_pending(graph, config)


async def _show_pending(graph, config) -> None:
    snap = await graph.aget_state(config)
    pendings = []
    for task in (snap.tasks or []):
        for intr in (task.interrupts or []):
            pendings.append(intr.value)
    if not pendings:
        return
    console.print("\n[yellow]⏸  待处理 interrupt：[/yellow]")
    for p in pendings:
        console.print_json(json.dumps(p, ensure_ascii=False, default=str))


async def _approve(ticket: str, role: str, action: str, actor: str, feedback: str) -> None:
    from langgraph.types import Command
    async with open_checkpointer() as cp:
        graph = build_graph(cp)
        config = {"configurable": {"thread_id": ticket}}
        decision = {"action": action, "actor": actor, "feedback": feedback, "role": role}
        async for ev in graph.astream(Command(resume=decision),
                                      config=config, stream_mode="updates"):
            _render_event(ev)
        await _show_pending(graph, config)


async def _tail(ticket: str) -> None:
    async with open_checkpointer() as cp:
        graph = build_graph(cp)
        config = {"configurable": {"thread_id": ticket}}
        snap = await graph.aget_state(config)
        console.print_json(json.dumps(snap.values, ensure_ascii=False, default=str))


def _render_event(ev: dict) -> None:
    for node, update in (ev or {}).items():
        if node == "__interrupt__":
            console.print(f"[yellow]⏸  interrupt @ {node}[/yellow]")
            continue
        keys = ", ".join(sorted((update or {}).keys()))
        console.print(f"[cyan]▶ {node}[/cyan]  Δ {{{keys}}}")


@app.command()
def submit(ticket: str, service: str, version: str,
           diff_file: str = typer.Option("", help="补丁 diff 文件路径，可空")):
    """提交一个发布工单，跑到第一个 interrupt 暂停。"""
    diff = Path(diff_file).read_text(encoding="utf-8") if diff_file else ""
    asyncio.run(_submit(ticket, service, version, diff))


@app.command()
def status(ticket: str):
    """查询工单当前状态与待处理 interrupt。"""
    asyncio.run(_status(ticket))


@app.command()
def approve(ticket: str,
            role: str = typer.Option(..., help="tech_lead | security | sre"),
            action: str = typer.Option("approve", help="approve | reject | revise"),
            actor: str = typer.Option("cli-user"),
            feedback: str = typer.Option("")):
    """恢复一个等待中的 interrupt。"""
    asyncio.run(_approve(ticket, role, action, actor, feedback))


@app.command()
def tail(ticket: str):
    """打印完整 state 快照（调试用）。"""
    asyncio.run(_tail(ticket))


@app.command()
def visualize(out_dir: str = "./reports"):
    """导出 Mermaid 文本与 PNG。"""
    graph = build_graph(None)
    info = export_mermaid(graph, out_dir)
    console.print(f"Mermaid 文本: {info['mermaid_text_path']}")
    console.print(f"PNG: {info['png_path'] or '(未生成)'} — {info['png_status']}")


@app.command()
def demo(scenario: str = typer.Argument("L", help="L | M | H | smoke_fail | canary_fail")):
    """一键跑完一个演示场景（自动批准所有 interrupt）。"""
    asyncio.run(_run_demo(scenario))


async def _run_demo(scenario: str) -> None:
    from langgraph.types import Command
    faults = {
        "smoke_fail":  {"simulate_canary_unhealthy": False},
        "canary_fail": {"simulate_canary_unhealthy": True},
    }.get(scenario, {})

    import tools as _t
    _t._FAULTS.update(faults)

    ticket = f"DEMO-{scenario.upper()}-001"
    diff_by_scenario = {
        "L": "diff --git a/README.md b/README.md\n+ typo fix in docs",
        "M": "diff --git a/handler.py b/handler.py\n+ " + ("x" * 1200),
        "H": "diff --git a/auth.py b/auth.py\n+ payment token rotation logic",
        "smoke_fail": "diff --git a/README.md b/README.md\n+ typo fix",
        "canary_fail": "diff --git a/README.md b/README.md\n+ typo fix",
    }
    diff = diff_by_scenario.get(scenario, diff_by_scenario["L"])

    async with open_checkpointer() as cp:
        graph = build_graph(cp)
        config = {"configurable": {"thread_id": ticket}}
        state = _initial_state(ticket, "auth-svc", "1.4.2", diff)

        for round_idx in range(20):
            interrupted = False
            async for ev in graph.astream(state if round_idx == 0 else Command(resume={
                "action": "approve", "actor": "demo-bot", "feedback": "", "role": "auto",
            }), config=config, stream_mode="updates"):
                _render_event(ev)
                if "__interrupt__" in ev:
                    interrupted = True
            snap = await graph.aget_state(config)
            if not snap.next:
                break
            if not interrupted:
                break
        console.print("\n[green]=== 演示结束 ===[/green]")
        await _status(ticket)


if __name__ == "__main__":
    app()
