"""Skill 选择测试：正例 / 负例 / 缺输入，三类任务各跑一次 pi，客观判定模型有没有选中目标 Skill。

判定不靠“答得像不像”，而靠 trace：模型若真的读了那份 SKILL.md，才算命中。

用法（在项目 scripts 目录，先备好一个含 .pi/skills/<name>/SKILL.md 的工程副本）：
    export PI_MODEL=deepseek/deepseek-chat
    python3 skill_selection.py --project <工程目录> --skill <工程目录>/.pi/skills/order-list-review
输出：三列对照（应不应该选 / 实际读没读 SKILL.md / 行为结论），并写 selection-results.json。
"""
import argparse
import json
from pathlib import Path

from pi_runner import run_pi
from trace_analysis import analyze
from common import read_events

# 三类任务：should_select = 这份任务按描述该不该命中目标 Skill
CASES = [
    ("正例", "检查登录订单列表的用户隔离与查询次数规则和测试覆盖。只读，不运行命令，不改文件。", True),
    ("负例", "润色 docs/current.md 的说明，只给改写建议。不运行命令，不改文件。", False),
    ("缺输入", "检查登录订单列表。只读，不运行命令，不改文件。", True),
]


def read_skill_paths(events):
    """从 trace 的已完成工具里，挑出读 SKILL.md 的 read 调用路径。"""
    skill_reads = []
    for tool in analyze(events)["completed_tools"]:
        if tool["tool"] == "read":
            path = (tool.get("args") or {}).get("path", "")
            if "SKILL.md" in path:
                skill_reads.append(path)
    return skill_reads


def select(project, skill, output, timeout):
    rows = []
    for label, prompt, should_select in CASES:
        run = run_pi(project, prompt, str(Path(output) / label),
                     tools="read,grep,find,ls", skill=skill, timeout=timeout)
        events = read_events(Path(run["run_dir"]) / "events.jsonl")
        skill_reads = read_skill_paths(events)
        did_select = bool(skill_reads)
        if should_select and did_select:
            verdict = "命中"
        elif should_select and not did_select:
            verdict = "漏选（该读没读，可能直接硬做）"
        elif not should_select and not did_select:
            verdict = "正确未选"
        else:
            verdict = "误选（不该读却读了）"
        rows.append({"case": label, "should_select": should_select,
                     "did_select": did_select, "verdict": verdict,
                     "status": run["status"], "skill_reads": skill_reads,
                     "run_dir": run["run_dir"]})
        print(f"[{label}] 应该选={should_select}  实际读SKILL.md={did_select}  → {verdict}")
    Path(output).mkdir(parents=True, exist_ok=True)
    Path(output, "selection-results.json").write_text(
        json.dumps(rows, ensure_ascii=False, indent=2), encoding="utf-8")
    return rows


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("--project", required=True)
    p.add_argument("--skill", required=True)
    p.add_argument("--output", default="runs-selection")
    p.add_argument("--timeout", type=float, default=120)
    a = p.parse_args()
    select(a.project, a.skill, a.output, a.timeout)
