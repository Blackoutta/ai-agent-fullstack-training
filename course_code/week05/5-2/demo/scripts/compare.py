import argparse
import json
from pathlib import Path
from common import dump

def compare(old, new):
    if old["dataset_version"] != new["dataset_version"]:
        raise ValueError("数据集版本不同，拒绝直接对比")
    left = {r["case_id"]: r for r in old["results"]}
    right = {r["case_id"]: r for r in new["results"]}
    if len(left) != len(old["results"]) or len(right) != len(new["results"]):
        raise ValueError("重复 case_id")
    if set(left) != set(right):
        raise ValueError("任务集合不同，拒绝直接对比")
    gained, regressed = [], []
    for key in left:
        if not left[key]["passed"] and right[key]["passed"]:
            gained.append(key)
        if left[key]["passed"] and not right[key]["passed"]:
            regressed.append(key)
    return {"new_passes": sorted(gained), "regressions": sorted(regressed),
            "allow_release": not regressed and all(r["passed"] for r in right.values()),
            "criterion": "课堂门禁：全部样本通过且无新增失败，不证明总体可靠"}

if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("old")
    p.add_argument("new")
    p.add_argument("--output", default="comparison.json")
    a = p.parse_args()
    report = compare(json.loads(Path(a.old).read_text()), json.loads(Path(a.new).read_text()))
    dump(a.output, report)
    print(json.dumps(report, ensure_ascii=False, indent=2))
    raise SystemExit(0 if report["allow_release"] else 1)

