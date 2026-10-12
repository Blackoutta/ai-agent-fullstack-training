"""调试与可视化：Mermaid 文本 + PNG 导出。"""
from __future__ import annotations

import os
from pathlib import Path


def export_mermaid(graph, out_dir: str = "./reports") -> dict[str, str]:
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    mermaid_text = graph.get_graph().draw_mermaid()
    text_path = out / "pipeline.mmd"
    text_path.write_text(mermaid_text, encoding="utf-8")

    png_path = out / "pipeline.png"
    try:
        data = graph.get_graph().draw_mermaid_png()
        png_path.write_bytes(data)
        png_status = "ok"
    except Exception as exc:
        png_status = f"failed: {exc}（可改用 mermaid-cli 离线渲染 {text_path}）"

    return {
        "mermaid_text_path": str(text_path),
        "png_path": str(png_path) if png_path.exists() else "",
        "png_status": png_status,
        "mermaid_text": mermaid_text,
    }
