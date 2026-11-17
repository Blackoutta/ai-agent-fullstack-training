"""Validate untrusted API input before storing or running it."""
import math
import re
from urllib.parse import urlparse


def text(data, key, maximum=20000):
    value = data.get(key)
    if not isinstance(value, str) or not value.strip() or len(value) > maximum:
        raise ValueError(f"{key} 必须为非空文本，长度不超过 {maximum}")
    return value.strip()


def integer(data, key, minimum, maximum, default):
    value = data.get(key, default)
    if isinstance(value, bool) or not isinstance(value, int) or not minimum <= value <= maximum:
        raise ValueError(f"{key} 必须为 {minimum} 到 {maximum} 的整数")
    return value


def identifier(value):
    if not isinstance(value, str) or not re.fullmatch(r"[a-zA-Z0-9_-]{1,100}", value):
        raise ValueError("无效 id")
    return value


def task(data):
    if not isinstance(data, dict):
        raise ValueError("任务必须为对象")
    checks = data.get("checks", [])
    if not isinstance(checks, list) or not 1 <= len(checks) <= 30:
        raise ValueError("任务需要 1 到 30 项程序检查")
    normalized = []
    for check in checks:
        if not isinstance(check, dict) or check.get("type") not in {"contains", "regex", "tool_called", "no_tool_errors"}:
            raise ValueError("未知程序检查类型")
        value = str(check.get("value", ""))
        if len(value) > 300:
            raise ValueError("检查表达式过长")
        if check["type"] != "no_tool_errors" and not value.strip():
            raise ValueError("检查 value 不能为空")
        if check["type"] == "regex":
            re.compile(value)
            # Restrict benchmark regexes: no nested quantifiers/backreferences/lookarounds.
            if re.search(r"\\[1-9]|\(\?|\([^)]*[+*{][^)]*\)[+*{]", value):
                raise ValueError("regex 不允许回溯引用、前后查找或嵌套量词")
        normalized.append({"id": text(check, "id", 80), "type": check["type"], "value": value})
    if len({c["id"] for c in normalized}) != len(normalized):
        raise ValueError("检查 id 重复")
    tags = data.get("tags", [])
    if not isinstance(tags, list) or len(tags) > 20 or any(not isinstance(t, str) or len(t) > 80 for t in tags):
        raise ValueError("tags 必须为短文本数组")
    if not isinstance(data.get("required", True), bool):
        raise ValueError("required 必须为布尔值")
    return {"name": text(data, "name", 200), "prompt": text(data, "prompt"),
            "tags": tags, "required": data.get("required", True), "checks": normalized,
            "rubric": text(data, "rubric", 8000)}


def strategy(data):
    if not isinstance(data, dict):
        raise ValueError("策略必须为对象")
    url = text(data, "base_url", 1000).rstrip("/")
    parsed = urlparse(url)
    if parsed.scheme not in {"http", "https"} or not parsed.hostname or parsed.username or parsed.password:
        raise ValueError("base_url 必须为不含凭据的 HTTP API 基址")
    if parsed.query or parsed.fragment or url.endswith("/chat/completions"):
        raise ValueError("基址不能包含 query、fragment 或 chat/completions")
    key = text(data, "api_key_env", 100)
    if not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", key):
        raise ValueError("api_key_env 必须为环境变量名，不是密钥本身")
    mode = data.get("rag_mode", "off")
    if mode not in {"off", "keyword", "bm25"}:
        raise ValueError("未知 RAG 模式")
    prices = {}
    for name in ("input_price", "output_price", "cache_price"):
        value = data.get(name)
        if value is not None and (isinstance(value, bool) or not isinstance(value, (int, float))
                                  or not math.isfinite(value) or value < 0 or value > 10000):
            raise ValueError(f"{name} 必须为非负价格或 null")
        prices[name] = value
    return {"name": text(data, "name", 200), "system_prompt": text(data, "system_prompt"),
            "model": text(data, "model", 200), "base_url": url, "api_key_env": key,
            "rag_mode": mode, "top_k": integer(data, "top_k", 1, 20, 5), **prices}


def experiment(data):
    mode = data.get("mode", "offline")
    if mode not in {"live", "offline"}:
        raise ValueError("mode 必须为 live/offline")
    result = {"name": text(data, "name", 200), "mode": mode,
              "trials": integer(data, "trials", 1, 10, 1),
              "timeout": integer(data, "timeout", 10, 600, 120),
              "max_tokens": integer(data, "max_tokens", 256, 16384, 4096)}
    for name, limit in (("task_ids", 50), ("strategy_ids", 6)):
        values = data.get(name)
        if not isinstance(values, list) or not 1 <= len(values) <= limit:
            raise ValueError(f"{name} 需要 1 到 {limit} 个 id")
        result[name] = list(dict.fromkeys(identifier(v) for v in values))
    if len(result["task_ids"]) * len(result["strategy_ids"]) * result["trials"] > 100:
        raise ValueError("单次实验最多 100 次运行")
    return result
