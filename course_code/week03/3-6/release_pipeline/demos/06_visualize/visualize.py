"""06 调试与可视化：Mermaid 文本 + PNG 导出 + 流式 updates 打印。"""
from __future__ import annotations

from pathlib import Path


def mermaid_text(graph) -> str:
    return graph.get_graph().draw_mermaid()


def export_mermaid(graph, out_dir: str = "./reports") -> dict[str, str]:
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    text = graph.get_graph().draw_mermaid()
    text_path = out / "pipeline.mmd"
    text_path.write_text(text, encoding="utf-8")

    png_path = out / "pipeline.png"
    try:
        png_path.write_bytes(graph.get_graph().draw_mermaid_png())
        png_status = "ok"
    except Exception as exc:  # 在线渲染失败时仍保留 .mmd，可用 mermaid-cli 离线渲染
        png_status = f"failed: {exc}"

    return {"mermaid_text": text,
            "mermaid_text_path": str(text_path),
            "png_path": str(png_path) if png_path.exists() else "",
            "png_status": png_status}


def stream_nodes(graph, initial, config) -> list[str]:
    """用 stream_mode='updates' 跑一遍，按执行顺序收集触发的节点名。

    注意：触发 interrupt() 的节点不会作为普通 key 出现——LangGraph 在 updates 流里
    把它 emit 成 '__interrupt__'。这里把中断点显式标成 '⏸ <id>'，让 watch 能看见停在哪。
    """
    fired: list[str] = []
    for update in graph.stream(initial, config=config, stream_mode="updates"):
        for node, payload in update.items():
            if node == "__interrupt__":
                for intr in payload:
                    iid = getattr(intr, "value", {}).get("interrupt_id", "?")
                    fired.append(f"⏸ {iid}")
            else:
                fired.append(node)
    return fired
