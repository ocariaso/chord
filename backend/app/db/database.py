import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone

from app.core.config import settings

SCHEMA = """
CREATE TABLE IF NOT EXISTS jobs (
    id TEXT PRIMARY KEY,
    original_filename TEXT NOT NULL,
    status TEXT NOT NULL,
    progress REAL NOT NULL DEFAULT 0,
    stage_message TEXT,
    error_message TEXT,
    stems_model TEXT,
    duration_seconds REAL,
    key_estimate TEXT,
    key_confidence REAL,
    source_url TEXT,
    tempo_bpm REAL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
"""

MIGRATED_COLUMNS = [
    ("source_url", "TEXT"),
    ("tempo_bpm", "REAL"),
]


def get_connection() -> sqlite3.Connection:
    conn = sqlite3.connect(settings.db_path, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    return conn


def init_db() -> None:
    conn = get_connection()
    try:
        conn.execute(SCHEMA)
        existing_columns = {row[1] for row in conn.execute("PRAGMA table_info(jobs)")}
        for column, column_type in MIGRATED_COLUMNS:
            if column not in existing_columns:
                conn.execute(f"ALTER TABLE jobs ADD COLUMN {column} {column_type}")
        conn.commit()
    finally:
        conn.close()


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


@contextmanager
def db_cursor():
    conn = get_connection()
    try:
        cur = conn.cursor()
        yield cur
        conn.commit()
    finally:
        conn.close()
