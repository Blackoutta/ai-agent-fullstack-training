import argparse
import json
import shutil
import subprocess
from pathlib import Path
from common import ROOT, FIXTURE, snapshot, dump
from pi_runner import run_pi
from graders import grade_readonly
from acceptance import verify
from trace_analysis import analyze
from common import read_events

def benchmark(version, output, include_fix=False, skill=None):
    destination = Path(output).resolve()
    destination.mkdir(parents=True, exist_ok=False)
    cases = json.loads((ROOT / "cases.json").read_text())
    rows = []
    for case in cases:
        if case["kind"] == "fix" and not include_fix:
            continue
        project = destination / case["id"] / "project"
        shutil.copytree(FIXTURE, project)
        before = snapshot(project)
        tools = "read,grep,find,ls,edit" if case["kind"] == "fix" else "read,grep,find,ls"
        try:
            run = run_pi(project, case["prompt"], destination / case["id"] / "runs",
                         tools=tools, skill=skill)
            run_dir = Path(run["run_dir"])
            answer = (run_dir / "answer.txt").read_text()
            if case["kind"] == "fix":
                grade = verify(project, before)
                grade["checks"]["execution_ok"] = run["status"] == "exited"
                grade["passed"] = grade["passed"] and grade["checks"]["execution_ok"]
            else:
                grade = grade_readonly(answer, case, project, before, run)
            trace = analyze(read_events(run_dir / "events.jsonl"))
            dump(run_dir / "grade.json", grade)
            dump(run_dir / "trace-summary.json", trace)
            row = {"case_id": case["id"], "passed": grade["passed"],
                   "checks": grade.get("checks"), "status": run["status"],
                   "latency": run["latency_seconds"], "run_dir": str(run_dir),
                   "tool_calls_parent": trace["tool_call_count"],
                   "cost": trace["billing_cost"]}
        except (OSError, ValueError, RuntimeError, subprocess.SubprocessError) as exc:
            row = {"case_id": case["id"], "passed": False,
                   "status": "execution_or_grading_error", "error": str(exc),
                   "latency": None, "cost": None}
        rows.append(row)
    summary = {"agent_version": version, "dataset_version": "course-benchmark-v1",
               "results": rows, "passed": sum(r["passed"] for r in rows),
               "total": len(rows), "success_rate": sum(r["passed"] for r in rows) / len(rows)}
    dump(destination / "summary.json", summary)
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    return summary

if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("--version", required=True)
    p.add_argument("--output", required=True)
    p.add_argument("--include-fix", action="store_true")
    p.add_argument("--skill")
    a = p.parse_args()
    benchmark(a.version, a.output, a.include_fix, a.skill)

