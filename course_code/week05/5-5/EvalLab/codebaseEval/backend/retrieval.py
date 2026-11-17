"""Deterministic local RAG over the frozen Codebase documentation snapshot."""
from collections import Counter
import math
import re
from .common import source_files


def tokens(text):
    return re.findall(r"[a-zA-Z_][a-zA-Z_0-9]*|[\u4e00-\u9fff]", text.lower())


def retrieve(root, query, mode, top_k):
    if mode == "off":
        return []
    chunks = []
    for path, relative in source_files(root):
        if path.suffix not in {".md", ".yaml", ".yml"}:
            continue
        lines = path.read_text(encoding="utf-8", errors="replace").splitlines()
        for start in range(0, len(lines), 35):
            content = "\n".join(lines[start:start + 40])[:5000]
            chunks.append({"path": relative.as_posix(), "line": start + 1, "text": content,
                           "terms": Counter(tokens(content))})
    query_terms = set(tokens(query))
    average = sum(sum(c["terms"].values()) for c in chunks) / max(1, len(chunks))
    document_frequency = Counter(term for c in chunks for term in c["terms"])
    results = []
    for chunk in chunks:
        score = 0.0
        length = sum(chunk["terms"].values())
        for term in query_terms:
            frequency = chunk["terms"].get(term, 0)
            if not frequency:
                continue
            if mode == "keyword":
                score += 1
            else:
                idf = math.log(1 + (len(chunks) - document_frequency[term] + 0.5) /
                               (document_frequency[term] + 0.5))
                score += idf * frequency * 2.2 / (frequency + 1.2 * (0.25 + 0.75 * length / max(average, 1)))
        if score:
            results.append({k: v for k, v in chunk.items() if k != "terms"} | {"score": round(score, 5), "mode": mode})
    return sorted(results, key=lambda c: (-c["score"], c["path"], c["line"]))[:top_k]
