import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
FIXTURE = ROOT / "fixtures" / "project"

def dump(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2), encoding="utf-8")

def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()

def snapshot(project):
    project = Path(project).resolve()
    files = {}
    for directory in ("app", "tests", "docs"):
        for path in sorted((project / directory).rglob("*")):
            if path.is_file() and "__pycache__" not in path.parts:
                files[path.relative_to(project).as_posix()] = digest(path)
    key = hashlib.sha256(json.dumps(files, sort_keys=True).encode()).hexdigest()
    return {"snapshot_id": key, "files": files}

def evidence_ok(project, item, before):
    if not isinstance(item, dict):
        return False
    relative, excerpt = item.get("path"), item.get("excerpt")
    if not isinstance(relative, str) or not isinstance(excerpt, str) or not excerpt.strip():
        return False
    root = Path(project).resolve()
    path = (root / relative).resolve()
    if not path.is_relative_to(root) or relative not in before["files"]:
        return False
    return (path.is_file() and digest(path) == before["files"][relative]
            and excerpt in path.read_text(encoding="utf-8"))

def read_events(path):
    events = []
    for line_no, line in enumerate(Path(path).read_text(encoding="utf-8").split("\n"), 1):
        if not line.strip():
            continue
        event = json.loads(line)
        if not isinstance(event, dict):
            raise ValueError(f"事件第 {line_no} 行不是对象")
        events.append(event)
    return events

def last_answer(events):
    answers = []
    for event in events:
        message = event.get("message", {})
        if event.get("type") == "message_end" and message.get("role") == "assistant":
            if message.get("stopReason") in ("error", "aborted"):
                continue
            text = "\n".join(p.get("text", "") for p in message.get("content", [])
                             if p.get("type") == "text")
            if text:
                answers.append(text)
    return answers[-1] if answers else ""

def parse_object(text):
    result = json.loads(text)
    if not isinstance(result, dict):
        raise ValueError("最终输出必须是 JSON 对象")
    return result

