"""Checkpointer 装配：跨进程持久化。"""
from __future__ import annotations

import os
from contextlib import asynccontextmanager
from pathlib import Path

from langgraph.checkpoint.sqlite.aio import AsyncSqliteSaver


@asynccontextmanager
async def open_checkpointer():
    db_path = Path(os.environ.get("CHECKPOINT_DB", "./checkpoints.sqlite")).resolve()
    db_path.parent.mkdir(parents=True, exist_ok=True)
    async with AsyncSqliteSaver.from_conn_string(str(db_path)) as saver:
        yield saver
