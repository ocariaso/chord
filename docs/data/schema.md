# Database schema

One SQLite file, one table. No ORM, no migration framework. Defined entirely in
[`server/app/db/database.py`](../../server/app/db/database.py).

## The `jobs` table

```sql
CREATE TABLE IF NOT EXISTS jobs (
    id                TEXT PRIMARY KEY,     -- uuid4().hex
    original_filename TEXT NOT NULL,        -- the upload's name, or the URL, or the fetched title
    status            TEXT NOT NULL,        -- a JobStatus value
    progress          REAL NOT NULL DEFAULT 0,
    stage_message     TEXT,                 -- what the UI actually displays
    error_message     TEXT,                 -- str(exc) when status = 'error'
    stems_model       TEXT,                 -- never written; always NULL
    duration_seconds  REAL,
    key_estimate      TEXT,                 -- "<root> <mode>", e.g. "A# minor"
    key_confidence    REAL,
    source_url        TEXT,                 -- set only for /jobs/from-url jobs
    tempo_bpm         REAL,
    created_at        TEXT NOT NULL,        -- ISO-8601 UTC
    updated_at        TEXT NOT NULL,
    author            TEXT                  -- added by migration; see below
);
```

`author` is absent from the `CREATE TABLE` statement and exists only via the migration list —
so on a fresh database it is added immediately after creation. Functionally identical, but worth
knowing when reading the source: the `SCHEMA` string is not the complete picture.

### Field notes

- **`id`** — `uuid4().hex`, 32 lowercase hex characters. Also the job's directory name and the
  default zip filename.
- **`original_filename`** is overwritten mid-job for URL jobs: it starts as the URL (so the
  processing screen has something to show) and becomes the yt-dlp title once `fetching`
  completes.
- **`progress`** is a hardcoded ladder — `0 → 0.05 → 0.10 → 0.50 → 0.60 → 1.0` — not a
  measurement. Separation spans 0.10…0.50 with no intermediate updates.
- **`stems_model` is dead.** Nothing writes it; it surfaces as `null` in every API response and
  in the TypeScript `Job` type.
- **`key_estimate`** is the flattened `f"{key} {mode}"` string. The structured form survives only in `analysis/key.json`, which no endpoint
  serves.
- **`duration_seconds`, `tempo_bpm`, `key_estimate`, `key_confidence`** are all written in the
  *same* `UPDATE` that sets `status='done'` — see
  [why](../architecture/job-lifecycle.md#why-the-results-are-batched).
- **`source_url`** being non-null is exactly how `run_job` decides whether to invoke yt-dlp.
- **Timestamps** are ISO-8601 UTC strings (`datetime.now(timezone.utc).isoformat()`), not SQLite
  datetimes. `updated_at` moves on every write, which is what makes each SSE payload distinct.

### Indexes and constraints

There are none beyond the primary key. `status` is a `TEXT` column with no `CHECK`, so the
`JobStatus` enum is enforced only by the application. `GET /jobs` sorts by `created_at` without
an index — fine at this scale.

## Access pattern

```python
def get_connection() -> sqlite3.Connection:
    conn = sqlite3.connect(settings.db_path, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    return conn

@contextmanager
def db_cursor():
    conn = get_connection()          # a fresh connection every block
    try:
        cur = conn.cursor()
        yield cur
        conn.commit()                # only on normal exit
    finally:
        conn.close()
```

- **A new connection per `with` block.** Wasteful, and completely sidesteps SQLite's
  cross-thread rules between the worker thread and request handlers. `check_same_thread=False`
  is set anyway.
- **Commit on success only** — an exception inside the block propagates before `commit()`, so
  the transaction is discarded when the connection closes.
- `row_factory = sqlite3.Row` means every read is by column name (`row["status"]`), so column
  order never matters.
- No WAL mode, no busy timeout, no explicit isolation level. Concurrent writes are not a
  practical concern because only one thread writes.

## Migrations

Additive, hardcoded, and run on every boot from `init_db()`:

```python
MIGRATED_COLUMNS = [
    ("source_url", "TEXT"),
    ("tempo_bpm", "REAL"),
    ("author", "TEXT"),
]

def init_db() -> None:
    conn.execute(SCHEMA)                                   # CREATE TABLE IF NOT EXISTS
    existing = {row[1] for row in conn.execute("PRAGMA table_info(jobs)")}
    for column, column_type in MIGRATED_COLUMNS:
        if column not in existing:
            conn.execute(f"ALTER TABLE jobs ADD COLUMN {column} {column_type}")
    conn.commit()
```

Called from the FastAPI `lifespan` hook, so it runs before the app serves traffic.

### Adding a column

Edit **both** lists:

1. Append it to the `SCHEMA` string — for fresh databases.
2. Append `(name, type)` to `MIGRATED_COLUMNS` — for existing ones.

Then map it in `_row_to_response()` and add it to `JobResponse` and the TypeScript `Job`. Full
checklist: [../api/contract-sync.md](../api/contract-sync.md#checklist-for-a-contract-change).

### What this cannot do

- Rename or drop a column.
- Change a type, add a constraint, or add an index.
- Roll back. There is no version table and no down-migration.
- Backfill. A new column is `NULL` on every existing row.

The column type is interpolated into the `ALTER TABLE` string, so keep `MIGRATED_COLUMNS`
literal — it is not a parameterized query.

## Inspecting a live database

```bash
sqlite3 server/data/db.sqlite3 \
  "SELECT id, status, progress, stage_message, tempo_bpm, key_estimate FROM jobs
   ORDER BY created_at DESC LIMIT 10;"
```

Because the row *is* the progress channel, this shows exactly what the UI would display —
including stale rows left non-terminal by a restart. See
[retention.md](retention.md#stale-rows).
