"""SQLite store: result cache (keyed by input hash) + officer reviews.

One file, two tables, WAL mode. Published via db.py helpers so the demo and a
multi-user deployment both keep working without a migration step.
"""
import json
import os
import sqlite3
import threading
import time
from pathlib import Path

from backend.config import REPO_ROOT

DB_PATH = Path(os.environ.get("DOCTRUST_DB", str(REPO_ROOT / "data" / "docutrust.sqlite")))

_lock = threading.Lock()
_conn: sqlite3.Connection | None = None


def conn() -> sqlite3.Connection:
    global _conn
    if _conn is None:
        DB_PATH.parent.mkdir(parents=True, exist_ok=True)
        _conn = sqlite3.connect(str(DB_PATH), check_same_thread=False)
        _conn.row_factory = sqlite3.Row
        _conn.execute("PRAGMA journal_mode=WAL")
        _conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS cache (
                key TEXT PRIMARY KEY,
                payload TEXT NOT NULL,
                created_at REAL NOT NULL
            );
            CREATE TABLE IF NOT EXISTS reviews (
                finding_id TEXT PRIMARY KEY,
                action TEXT NOT NULL CHECK(action IN ('approve','override')),
                officer_id TEXT NOT NULL,
                note TEXT,
                created_at REAL NOT NULL
            );
            """
        )
    return _conn


# --- cache ---

def cache_get(key: str) -> dict | None:
    with _lock:
        row = conn().execute("SELECT payload FROM cache WHERE key = ?", (key,)).fetchone()
    return json.loads(row["payload"]) if row else None


def cache_put(key: str, payload: dict) -> None:
    with _lock:
        conn().execute(
            "INSERT OR REPLACE INTO cache (key, payload, created_at) VALUES (?,?,?)",
            (key, json.dumps(payload), time.time()),
        )
        conn().commit()


def cache_clear_all() -> None:
    """Derived state only — analyses rebuild deterministically from the bytes.
    Used by tests and by a demo reset (DELETE /cache, if ever exposed)."""
    with _lock:
        conn().execute("DELETE FROM cache")
        conn().commit()


def cache_stats() -> dict:
    with _lock:
        n = conn().execute("SELECT COUNT(*) AS n FROM cache").fetchone()["n"]
    return {"entries": n, "path": str(DB_PATH)}


# --- officer reviews (persisted so a re-run restores decisions) ---

def review_get_all() -> dict[str, dict]:
    with _lock:
        rows = conn().execute("SELECT * FROM reviews").fetchall()
    return {r["finding_id"]: dict(r) for r in rows}


def review_set(finding_id: str, action: str, officer_id: str, note: str | None) -> dict:
    rec = {
        "finding_id": finding_id,
        "action": action,
        "officer_id": officer_id,
        "note": note,
        "created_at": time.time(),
    }
    with _lock:
        conn().execute(
            "INSERT OR REPLACE INTO reviews (finding_id, action, officer_id, note, created_at) VALUES (?,?,?,?,?)",
            (finding_id, action, officer_id, note, time.time()),
        )
        conn().commit()
    return rec


def review_clear_all() -> None:
    with _lock:
        conn().execute("DELETE FROM reviews")
        conn().commit()


def health() -> dict:
    try:
        conn().execute("SELECT 1")
        return {"database": "ok", "path": str(DB_PATH), **cache_stats()}
    except Exception as e:
        return {"database": "error", "error": str(e), "path": str(DB_PATH)}
