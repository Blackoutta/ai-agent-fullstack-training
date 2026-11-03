import argparse
import json
from pathlib import Path
from common import dump, snapshot, evidence_ok

def aggregate(project, raw, before):
    if not isinstance(raw, dict) or not isinstance(raw.get("results"), list):
        raise ValueError("需要 results 数组")
    seen, accepted, rejected, conflicts, incomplete = {}, [], [], [], []
    expected = {"test", "security", "performance"}
    received = set()
    for result in raw["results"]:
        if not isinstance(result, dict):
            raise ValueError("子任务结果必须是对象")
        task = result.get("task_id")
        if task not in expected or task in received:
            raise ValueError("任务 ID 未授权或重复")
        received.add(task)
        if result.get("status") != "completed":
            incomplete.append(task)
            continue
        findings = result.get("findings")
        if not isinstance(findings, list):
            raise ValueError("findings 必须是数组")
        for finding in findings:
            if not isinstance(finding, dict):
                raise ValueError("finding 必须是对象")
            key, claim = finding.get("issue_key"), finding.get("claim")
            evidence = finding.get("evidence")
            if (not isinstance(key, str) or not key or not isinstance(claim, str)
                    or not isinstance(evidence, list) or not evidence
                    or finding.get("severity") not in ("high", "medium", "low")
                    or not all(evidence_ok(project, e, before) for e in evidence)):
                rejected.append({"task_id": task, "reason": "schema_or_evidence", "finding": finding})
                continue
            if key in seen:
                old = seen[key]
                if old["claim"] != claim:
                    conflicts.append({"issue_key": key, "left": old, "right": finding})
                else:
                    old["sources"].append(task)
                continue
            item = dict(finding, sources=[task], evidence_status="literal_verified")
            seen[key] = item
            accepted.append(item)
    incomplete += sorted(expected - received)
    # 输入快照变化时整份审查失效，不继续用旧摘录。
    if snapshot(project) != before:
        raise ValueError("审查期间快照发生变化")
    priorities = {"high": 0, "medium": 1, "low": 2}
    accepted.sort(key=lambda f: priorities[f["severity"]])
    return {
        "accepted": accepted, "rejected": rejected, "conflicts": conflicts,
        "incomplete": incomplete, "needs_review": bool(conflicts or rejected or incomplete),
        "semantic_verification": "pending",
    }

if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("--project", required=True)
    p.add_argument("--result", required=True)
    p.add_argument("--snapshot", required=True)
    p.add_argument("--output", default="aggregation.json")
    a = p.parse_args()
    report = aggregate(a.project, json.loads(Path(a.result).read_text()),
                       json.loads(Path(a.snapshot).read_text()))
    dump(a.output, report)
    print(json.dumps(report, ensure_ascii=False, indent=2))

