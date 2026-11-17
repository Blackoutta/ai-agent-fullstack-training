"""Node 治理 worker 的父端；只使用 Python 标准库。"""

import json
import math
import os
from pathlib import Path
import queue
import signal
import subprocess
import threading
import time

ROOT = Path(__file__).resolve().parents[2]
CODEBASE = ROOT / "codebase"
WORKER = Path(__file__).with_name("worker.ts")
LOADER = CODEBASE / "node_modules/tsx/dist/esm/index.mjs"


def worker_command():
    return ["node", "--import", str(LOADER), str(WORKER)]


def _kill_group(process):
    # kill 整组，不只杀 Node；Runtime 启动的后代也不能遗留。
    try:
        os.killpg(process.pid, signal.SIGKILL)
    except ProcessLookupError:
        pass


def _error(message, events=()):
    # Partial tool events are observations, not a substitute for the final governance audit.
    calls = {}
    for event in events:
        if event.get("type") in {"tool_execution_start", "tool_execution_end"}:
            ident = event.get("tool_call_id")
            if ident:
                calls[ident] = {"tool_call_id": ident, "tool_name": event.get("tool_name"),
                    "status": "error" if event.get("is_error") else
                        "success" if event["type"] == "tool_execution_end" else "started",
                    "partial": True}
    return {
        "type": "result", "result": {"final_answer": "", "error": message},
        "trace": [], "audit": list(calls.values()), "usage_complete": False,
        "messages": [e for e in events if e.get("type") == "message"], "execution_status": "error",
    }


def run_worker(payload, cancel: threading.Event | None = None, on_event=None):
    """返回最终契约；timeout 单位秒，cancel 可由实验取消处理器设置。"""
    timeout = payload.get("timeout")
    if not isinstance(timeout, (int, float)) or isinstance(timeout, bool) or not math.isfinite(timeout) or timeout <= 0:
        return _error("INVALID_INPUT: timeout 必须为正数")
    process = subprocess.Popen(
        worker_command(), cwd=str(CODEBASE), start_new_session=True,
        stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
        text=True, encoding="utf-8",
    )
    deadline = time.monotonic() + timeout
    inbox = queue.Queue(maxsize=1000)
    stderr = []
    events = []

    def read_output():
        try:
            for line in process.stdout:
                if len(line) > 4_000_000:
                    inbox.put(ValueError("worker 单事件超过大小限制"))
                    return
                if line.strip():
                    inbox.put(json.loads(line))
        except (ValueError, OSError) as exc:
            inbox.put(exc)
        finally:
            inbox.put(None)

    def drain_stderr():
        for line in process.stderr:
            if sum(map(len, stderr)) < 16000:
                stderr.append(line)

    threading.Thread(target=read_output, daemon=True).start()
    threading.Thread(target=drain_stderr, daemon=True).start()
    try:
        process.stdin.write(json.dumps(payload, ensure_ascii=False) + "\n")
        process.stdin.close()
        final = None
        while True:
            if cancel is not None and cancel.is_set():
                _kill_group(process)
                process.wait()
                return _error("ABORTED: 运行已取消", events)
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                _kill_group(process)
                process.wait()
                return _error("TIMEOUT: worker 超时，进程组已终止", events)
            try:
                event = inbox.get(timeout=min(remaining, 0.1))
            except queue.Empty:
                continue
            if event is None:
                break
            if isinstance(event, Exception):
                raise ValueError(f"WORKER_PROTOCOL: {event}")
            if not isinstance(event, dict):
                raise ValueError("WORKER_PROTOCOL: event 必须为对象")
            events.append(event)
            if len(events) > 10000:
                raise ValueError("WORKER_PROTOCOL: 事件数量超限")
            if on_event is not None:
                on_event(event)
            if event.get("type") == "result":
                if final is not None:
                    raise ValueError("WORKER_PROTOCOL: 多个最终结果")
                final = event
        process.wait(timeout=max(0.01, deadline - time.monotonic()))
        if final is None:
            return _error(f"WORKER_EXIT: worker 未返回结果 (exit={process.returncode})", events)
        if process.returncode != 0:
            final["execution_status"] = "error"
        return final
    except Exception:
        _kill_group(process)
        process.wait()
        raise
    finally:
        process.stdout.close()
        process.stderr.close()
