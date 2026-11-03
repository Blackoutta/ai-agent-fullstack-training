import argparse
import json
from pathlib import Path
from pi_runner import run_pi
from common import snapshot, dump, parse_object
from delegation import aggregate

SCHEMA = """输出纯 JSON 对象，不加围栏：
{"results":[{"task_id":"test","status":"completed",
"findings":[{"issue_key":"test-coverage","claim":"具体结论",
"severity":"medium","evidence":[{"path":"tests/test_orders.py","excerpt":"真实非空原文"}]}]},
{"task_id":"security","status":"completed","findings":[...]},
{"task_id":"performance","status":"completed","findings":[...]}]}。
省略号仅是格式说明，实际输出必须是合法数组，不输出省略号。
无法检查时 status=needs_input，并给 findings=[]。
同一问题使用相同 issue_key；不同问题不得用同一 key。
"""
def delegate(project, extension, output):
    before = snapshot(project)
    prompt = (
        "实际调用 subagent 的 parallel 模式。第一个用 chapter5-test，检查用户隔离和查询次数的测试覆盖；"
        "第二个用 chapter5-security，检查是否返回其他用户订单。"
        "第三个用 chapter5-performance，检查逐单查询与查询次数。规则取 docs/current.md。三项均只读，不运行命令。"
        "给子任务明确输入 app/orders.py、tests/test_orders.py、docs/current.md。"
        "收到结果后按以下格式汇总，不改写为已经修复或测试通过。\n" + SCHEMA
    )
    record = run_pi(project, prompt, output, tools="read,grep,find,ls,subagent",
                    extension=extension, timeout=120)
    run_dir = Path(record["run_dir"])
    if record["status"] != "exited":
        raise RuntimeError(f"委托运行失败，见 {run_dir}")
    dump(run_dir / "delegation-snapshot.json", before)
    try:
        report = aggregate(project, parse_object((run_dir / "answer.txt").read_text()), before)
    except ValueError as exc:
        report = {"needs_review": True, "error": str(exc), "accepted": []}
    dump(run_dir / "aggregation.json", report)
    print(run_dir)
    return report

if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("--project", required=True)
    p.add_argument("--extension", required=True)
    p.add_argument("--output", default="runs/delegation")
    a = p.parse_args()
    report = delegate(a.project, a.extension, a.output)
    raise SystemExit(1 if report.get("error") else 0)

