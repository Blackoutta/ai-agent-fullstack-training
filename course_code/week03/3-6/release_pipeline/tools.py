"""受控工具集合。

每个工具按 config/tools.yaml 的 mode 字段在 real / mock 间切换。
mock 模式下根据 mock_faults 注入故障，用于稳定复现演示场景。

LangChain @tool 装饰器让工具可以直接挂进 ToolNode。
"""
from __future__ import annotations

import asyncio
import json
import os
import random
import shutil
import subprocess
from pathlib import Path
from typing import Any

import yaml
from langchain_core.tools import tool

_CONFIG_PATH = os.environ.get("TOOLS_CONFIG", "./config/tools.yaml")


def _load_config() -> dict[str, Any]:
    path = Path(_CONFIG_PATH)
    if not path.exists():
        return {"defaults": {"mode": "mock", "latency_ms": 0}, "mock_faults": {}, "tools": {}}
    return yaml.safe_load(path.read_text(encoding="utf-8"))


_CFG = _load_config()
_FAULTS = _CFG.get("mock_faults", {}) or {}
_LATENCY = (_CFG.get("defaults", {}) or {}).get("latency_ms", 0) / 1000.0


def _mode(tool_name: str) -> str:
    spec = (_CFG.get("tools", {}) or {}).get(tool_name, {}) or {}
    return spec.get("mode") or (_CFG.get("defaults", {}) or {}).get("mode", "mock")


def _real_cmd(tool_name: str, **kwargs: str) -> list[str]:
    spec = (_CFG.get("tools", {}) or {}).get(tool_name, {}) or {}
    tmpl = spec.get("real_cmd") or []
    return [part.format(**kwargs) for part in tmpl]


async def _run_real(tool_name: str, **kwargs: str) -> str:
    cmd = _real_cmd(tool_name, **kwargs)
    if not cmd or not shutil.which(cmd[0]):
        return json.dumps({"error": f"real command unavailable for {tool_name}", "cmd": cmd})
    proc = await asyncio.create_subprocess_exec(
        *cmd,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )
    out, err = await proc.communicate()
    return json.dumps({
        "tool": tool_name,
        "returncode": proc.returncode,
        "stdout": out.decode(errors="replace")[-2000:],
        "stderr": err.decode(errors="replace")[-1000:],
    })


async def _sleep() -> None:
    if _LATENCY:
        await asyncio.sleep(_LATENCY)


@tool
async def build_service(service: str, version: str) -> str:
    """构建服务镜像。返回 JSON 字符串，包含 passed 与摘要。"""
    if _mode("build_service") == "real":
        return await _run_real("build_service", service=service, version=version)
    await _sleep()
    if _FAULTS.get("simulate_build_fail"):
        return json.dumps({"tool": "build", "passed": False, "summary": "mock: 编译失败"})
    return json.dumps({
        "tool": "build",
        "passed": True,
        "summary": f"mock: {service}@{version} 构建成功",
        "artifacts": [f"registry.local/{service}:{version}"],
    })


@tool
async def run_unit_tests(service: str) -> str:
    """执行单元测试。"""
    if _mode("run_unit_tests") == "real":
        return await _run_real("run_unit_tests", service=service)
    await _sleep()
    return json.dumps({
        "tool": "unit_test",
        "passed": True,
        "summary": f"mock: {service} 单测 42 通过 / 0 失败",
        "artifacts": ["reports/unit.xml"],
    })


@tool
async def security_scan(diff: str) -> str:
    """对补丁 diff 做静态安全扫描。"""
    if _mode("security_scan") == "real":
        return await _run_real("security_scan", diff_path="diff.patch")
    await _sleep()
    if _FAULTS.get("simulate_security_block"):
        return json.dumps({
            "tool": "security_scan",
            "passed": False,
            "summary": "mock: 检测到硬编码凭据",
            "artifacts": [],
        })
    return json.dumps({
        "tool": "security_scan",
        "passed": True,
        "summary": f"mock: diff({len(diff)} chars) 无高危项",
        "artifacts": ["reports/scan.json"],
    })


@tool
async def dependency_audit(service: str) -> str:
    """依赖审计。"""
    if _mode("dependency_audit") == "real":
        return await _run_real("dependency_audit", service=service)
    await _sleep()
    return json.dumps({
        "tool": "dep_audit",
        "passed": True,
        "summary": f"mock: {service} 无 critical CVE",
        "artifacts": ["reports/audit.json"],
    })


@tool
async def deploy(stage: str, service: str, version: str) -> str:
    """部署到指定阶段：staging / canary_10 / canary_50 / prod_100。"""
    if _mode("deploy") == "real":
        return await _run_real("deploy", manifest=f"manifests/{service}-{stage}.yaml")
    await _sleep()
    return json.dumps({
        "tool": "deploy",
        "stage": stage,
        "passed": True,
        "summary": f"mock: {service}@{version} -> {stage} 部署完成",
    })


@tool
async def query_metrics(service: str, stage: str, window: str = "1m") -> str:
    """拉取一段时间的指标。返回 error_rate 与 p99_ms。"""
    if _mode("query_metrics") == "real":
        return await _run_real("query_metrics", service=service)
    await _sleep()
    if _FAULTS.get("simulate_canary_unhealthy") and stage.startswith("canary"):
        return json.dumps({
            "tool": "query_metrics",
            "stage": stage,
            "error_rate": round(random.uniform(0.18, 0.32), 3),
            "p99_ms": random.randint(800, 1500),
            "healthy": False,
        })
    return json.dumps({
        "tool": "query_metrics",
        "stage": stage,
        "error_rate": round(random.uniform(0.001, 0.01), 4),
        "p99_ms": random.randint(80, 220),
        "healthy": True,
    })


@tool
async def rollback(stage: str, service: str) -> str:
    """回滚指定阶段。"""
    if _mode("rollback") == "real":
        return await _run_real("rollback", service=service)
    await _sleep()
    return json.dumps({
        "tool": "rollback",
        "stage": stage,
        "passed": True,
        "summary": f"mock: {service}@{stage} 已回滚",
    })


CHECK_TOOLS = [build_service, run_unit_tests, security_scan, dependency_audit]
OPS_TOOLS = [deploy, query_metrics, rollback]
ALL_TOOLS = CHECK_TOOLS + OPS_TOOLS
