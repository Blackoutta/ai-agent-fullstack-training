"""SQLite transactions keep API threads and evaluation workers consistent."""
import json
from pathlib import Path
import sqlite3
import threading
import uuid
from .common import now, scrub


class Store:
    def __init__(self, directory):
        self.directory = Path(directory)
        self.directory.mkdir(parents=True, exist_ok=True)
        self.lock = threading.RLock()
        self.db = sqlite3.connect(self.directory / "platform.sqlite", check_same_thread=False)
        self.db.execute("PRAGMA journal_mode=WAL")
        self.db.executescript("""
            CREATE TABLE IF NOT EXISTS entities (
                kind TEXT NOT NULL, id TEXT NOT NULL, data TEXT NOT NULL,
                PRIMARY KEY(kind,id));
            CREATE TABLE IF NOT EXISTS reviews (
                id TEXT PRIMARY KEY, run_id TEXT NOT NULL, data TEXT NOT NULL);
            CREATE INDEX IF NOT EXISTS review_run ON reviews(run_id);
        """)
        self.db.commit()

    def put(self, kind, value):
        value = scrub(dict(value))
        value.setdefault("id", uuid.uuid4().hex[:16])
        with self.lock, self.db:
            self.db.execute("INSERT INTO entities VALUES (?,?,?) ON CONFLICT(kind,id) DO UPDATE SET data=excluded.data",
                            (kind, value["id"], json.dumps(value, ensure_ascii=False)))
        return value

    def get(self, kind, ident):
        with self.lock:
            row = self.db.execute("SELECT data FROM entities WHERE kind=? AND id=?", (kind, ident)).fetchone()
        if not row:
            raise KeyError(f"{kind} 不存在：{ident}")
        return json.loads(row[0])

    def list(self, kind):
        with self.lock:
            rows = self.db.execute("SELECT data FROM entities WHERE kind=? ORDER BY rowid DESC", (kind,)).fetchall()
        return [json.loads(row[0]) for row in rows]

    def delete(self, kind, ident):
        self.get(kind, ident)
        with self.lock, self.db:
            self.db.execute("DELETE FROM entities WHERE kind=? AND id=?", (kind, ident))

    def add_review(self, run_id, data):
        value = scrub({**data, "id": uuid.uuid4().hex, "created_at": now()})
        with self.lock, self.db:
            self.db.execute("INSERT INTO reviews VALUES (?,?,?)",
                            (value["id"], run_id, json.dumps(value, ensure_ascii=False)))
        return value

    def reviews(self, run_id):
        with self.lock:
            rows = self.db.execute("SELECT data FROM reviews WHERE run_id=? ORDER BY rowid", (run_id,)).fetchall()
        return [json.loads(r[0]) for r in rows]

    def close(self):
        self.db.close()
