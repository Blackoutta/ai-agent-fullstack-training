import argparse
import os
import signal
import subprocess
import time
import uuid
from pathlib import Path
from common import dump, digest, snapshot, read_events, last_answer

def stop_group(proc):
    try:
        os.killpg(proc.pid, signal.SIGTERM)
    except ProcessLookupError:
        return
    try:
        proc.wait(timeout=3)
    except subprocess.TimeoutExpired:
        try:
            os.killpg(proc.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
        proc.wait()

def run_pi(project, prompt, output_root, tools="read,grep,find,ls",
           extension=None, skill=None, timeout=90):
    if os.name != "posix":
        raise RuntimeError("演示执行器仅支持 macOS/Linux")
    if timeout <= 0:
        raise ValueError("timeout 必须大于零")
    project = Path(project).resolve(strict=True)
    if not project.is_dir():
        raise ValueError("project 必须是目录")
    # 缺少真实 pi 时明确失败，不生成替代回答。
    version = subprocess.run(["pi", "--version"], capture_output=True, text=True,
                             check=True, timeout=10).stdout.strip()
    run_dir = Path(output_root).resolve() / uuid.uuid4().hex
    run_dir.mkdir(parents=True, exist_ok=False)
    before = snapshot(project)
    dump(run_dir / "input-snapshot.json", before)
    (run_dir / "prompt.txt").write_text(prompt, encoding="utf-8")
    argv = ["pi", "--no-extensions", "--tools", tools, "--mode", "json"]
    if os.environ.get("PI_MODEL"):
        argv += ["--model", os.environ["PI_MODEL"]]
    config = {"pi_version": version, "model_requested": os.environ.get("PI_MODEL")}
    if extension:
        extension = Path(extension).resolve(strict=True)
        argv += ["-e", str(extension)]
        config["extension_sha256"] = digest(extension)
        sibling = extension.parent / "agents.ts"
        config["agents_ts_sha256"] = digest(sibling) if sibling.is_file() else None
    if skill:
        skill = Path(skill).resolve(strict=True)
        argv += ["--skill", str(skill)]
        config["skill_sha256"] = digest(skill / "SKILL.md")
    argv.append(prompt)
    started = time.monotonic()
    status, error = "running", None
    with (run_dir / "events.jsonl").open("w") as out, (run_dir / "stderr.log").open("w") as err:
        proc = subprocess.Popen(argv, cwd=project, stdout=out, stderr=err,
                                start_new_session=True)
        try:
            proc.wait(timeout=timeout)
            status = "exited" if proc.returncode == 0 else "process_error"
        except subprocess.TimeoutExpired:
            stop_group(proc)
            status = "timeout"
        except BaseException:
            stop_group(proc)
            raise
    try:
        events = read_events(run_dir / "events.jsonl")
        answer = last_answer(events)
        errors = [e for e in events if e.get("type") == "message_end"
                  and e.get("message", {}).get("stopReason") in ("error", "aborted")]
        if errors and status == "exited":
            status = "model_error"
    except (ValueError, OSError) as exc:
        answer, error = "", str(exc)
        if status == "exited":
            status = "event_parse_error"
    (run_dir / "answer.txt").write_text(answer, encoding="utf-8")
    after = snapshot(project)
    record = {
        "run_id": run_dir.name, "run_dir": str(run_dir), "status": status,
        "exit_code": proc.returncode, "error": error, "config": config,
        "latency_seconds": round(time.monotonic() - started, 3),
        "snapshot_id": before["snapshot_id"], "snapshot_unchanged": before == after,
        "task_success": None, "cost": None,
    }
    dump(run_dir / "run.json", record)
    return record

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--project", required=True)
    parser.add_argument("--prompt", required=True)
    parser.add_argument("--output", default="runs")
    parser.add_argument("--tools", default="read,grep,find,ls")
    parser.add_argument("--extension")
    parser.add_argument("--skill")
    parser.add_argument("--timeout", type=float, default=90)
    a = parser.parse_args()
    record = run_pi(a.project, Path(a.prompt).read_text(encoding="utf-8"), a.output,
                    a.tools, a.extension, a.skill, a.timeout)
    print(record["run_dir"])
    raise SystemExit(0 if record["status"] == "exited" else 1)

