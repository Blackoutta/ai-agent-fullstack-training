"""06 Checkpointer：SQLite 持久化（同步版，CLI 演示简单一些）。"""
from __future__ import annotations

import os
from contextlib import contextmanager
from pathlib import Path

from langgraph.checkpoint.sqlite import SqliteSaver


@contextmanager
def open_checkpointer():
    db_path = Path(os.environ.get("CHECKPOINT_DB", "./checkpoints_06.sqlite")).resolve()
    db_path.parent.mkdir(parents=True, exist_ok=True)
    with SqliteSaver.from_conn_string(str(db_path)) as saver:
        yield saver
