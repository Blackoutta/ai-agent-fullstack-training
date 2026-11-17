"""Trusted paths, redaction and reproducible source snapshots."""
from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
import re
import shutil
from datetime import datetime, timezone

ROOT = Path(__file__).resolve().parents[1]
CODEBASE = ROOT.parent / "codebase"
SKIP_DIRS = {".git", "node_modules", "dist", "data", "artifacts", ".eval-runs",
             "__pycache__", ".pytest_cache", ".venv", "coverage"}


def now():
    return datetime.now(timezone.utc).isoformat()


def fingerprint(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, ensure_ascii=False).encode()).hexdigest()


def scrub(value):
    """Also redact custom credential environment variables, not only vendor keys."""
    hidden = {"authorization", "api_key", "apikey", "reasoning_content", "thinking", "reasoning", "thought"}
    if isinstance(value, dict):
        if value.get("type") in {"thinking", "thinking_delta", "thinking_end", "thinking_start"}:
            return {"type": "redacted"}
        return {k: scrub(v) for k, v in value.items() if k.lower() not in hidden}
    if isinstance(value, list):
        return [scrub(v) for v in value]
    if isinstance(value, str):
        for key, secret in os.environ.items():
            if re.search(r"(KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL)$", key) and secret:
                value = value.replace(secret, "[REDACTED]")
        value = re.sub(r"\bBearer\s+\S+", "Bearer [REDACTED]", value, flags=re.I)
    return value


def source_files(root):
    root = Path(root)
    for directory, dirs, files in os.walk(root, followlinks=False):
        for name in list(dirs):
            path = Path(directory) / name
            if name in SKIP_DIRS:
                dirs.remove(name)
            elif path.is_symlink():
                raise ValueError("源码快照禁止符号链接")
        for name in sorted(files):
            path = Path(directory) / name
            relative = path.relative_to(root)
            if relative.parts[:2] in {("demos", "reference"), ("config", "scripts")}:
                continue
            if name.startswith(".env") or path.suffix in {".pem", ".key", ".db", ".sqlite", ".pyc"}:
                continue
            if path.is_symlink():
                raise ValueError("源码快照禁止符号链接")
            if path.stat().st_size > 4_000_000:
                continue
            yield path, relative


def copy_source(source, target):
    Path(target).mkdir(parents=True, exist_ok=False)
    hashes = {}
    for path, relative in source_files(source):
        destination = Path(target) / relative
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(path, destination)
        hashes[relative.as_posix()] = hashlib.sha256(destination.read_bytes()).hexdigest()
    if not hashes:
        raise ValueError("源码快照为空")
    return fingerprint(hashes)


def load_env():
    path = ROOT / ".env"
    if path.is_file():
        for line in path.read_text(encoding="utf-8").splitlines():
            if line.strip() and not line.lstrip().startswith("#") and "=" in line:
                key, value = line.split("=", 1)
                if re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", key.strip()):
                    os.environ.setdefault(key.strip(), value.strip().strip("\"'"))
