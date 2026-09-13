# Database schema

One SQLite file, one table. No ORM, no migration framework. Defined entirely in
[`server/app/db/database.py`](../../server/app/db/database.py).

## The `jobs` table

```sql
CREATE TABLE IF NOT EXISTS jobs (
    id                TEXT PRIMARY KEY,            -- uuid4().hex
    original_filename TEXT NOT NULL,               -- the upload's name, or the URL, or the fetched title
    author            TEXT,                        -- ID3 artist or yt-dlp uploader
    status            TEXT NOT NULL,               -- a JobStatus value
    progress          REAL NOT NULL DEFAULT 0,
    stage_message     TEXT,                        -- what the UI actually displays
    error_message     TEXT,                        -- the sentence shown to the user when status = 'error'
    stems_model       TEXT,                        -- never written; always NULL
    duration_seconds  REAL,                        -- written when separation starts
    key_estimate      TEXT,                        -- "<root> <mode>", e.g. "A# minor"
    key_confidence    REAL,
    source_url        TEXT,                        -- set only for /jobs/from-url jobs
    tempo_bpm         REAL,                        -- NULL when librosa found no beat
    error_log         TEXT,                        -- the technical detail behind error_message
    audio_format      TEXT,                        -- "FLAC 24/48", "MP3 44.1 kHz"
    attempt           INTEGER NOT NULL DEFAULT 0,  -- bumped by resume; not exposed by the API
    created_at        TEXT NOT NULL,               -- ISO-8601 UTC
    updated_at        TEXT NOT NULL
);
```

`SCHEMA` is the complete table. Every column in `MIGRATED_COLUMNS` — `source_url`, `tempo_bpm`,
`author`, `error_log`, `audio_format` and `attempt` — is also in the `CREATE TABLE`, which is how a
new column should arrive: a fresh database gets it from `SCHEMA`, and one that predates the column
from the migration. The two paths order columns differently — `ADD COLUMN` appends after
`updated_at` — and nothing notices, because rows are read by name.

### Field notes

- **`id`** — `uuid4().hex`, 32 lowercase hex characters. Also the job's directory name and the
  default zip filename.
- **`original_filename`** is overwritten mid-job for URL jobs: it starts as the URL (so the
  processing screen has something to show) and becomes the yt-dlp title once the download
  completes. That write, which also sets `author`, is the one pipeline write not scoped to the
  run's `attempt`, so it lands even when the job was cancelled during the download — a
  [resume](../api/jobs.md#post-jobsjob_idresume) skips the download and couldn't write it again.
- **`progress`** is measured only during separation: `0 → 0.05` (download, URL jobs only)
  `→ 0.10 … 0.85` (separation) `→ 0.85` (tempo) `→ 0.90` (chords and key) `→ 1.0`. Inside
  separation, Demucs reports each chunk as it starts; `_separation_progress` maps that fraction
  onto `_SEPARATION_PROGRESS = (0.1, 0.85)` and writes the row at most once per percentage point
  (`_PROGRESS_WRITE_STEP`), rounded to three decimals. The 0.85 and 0.90 steps are written only for
  analysis still running once the stems are, since it runs beside separation. A resume resets it
  to 0.
- **`error_message`** is always written for a person: the text of a `UserFacingError`, or the
  failed stage's fixed sentence from `_STAGE_FAILURE_MESSAGES`. **`error_log`** holds the
  exception — `"<Type>: <message>"`, or the text of the exception a `UserFacingError` was chained
  from, or `NULL`. A resume clears both.
- **`stage_message`** isn't touched by the error write, so a failed row keeps the stage message
  it last had — unless the run failed while reading the audio, between the download and
  separation, when the error write sets it to `NULL`. A resume clears it too.
- **`duration_seconds` and `audio_format`** come from `metadata.read_audio_info` and are written
  in the same `UPDATE` that sets `status='separating'`, so the processing screen can show them
  while separation runs. `audio_format` is `"<format> <bits>/<kHz>"` for PCM subtypes
  (`"FLAC 24/48"`) and `"<format> <kHz> kHz"` otherwise (`"MP3 44.1 kHz"`).
- **`attempt`** starts at 0 and is incremented by `POST /jobs/{id}/resume`. `run_job` returns at
  once unless the row is `queued`, reads `attempt` then, and makes every write but one
  `WHERE id = ? AND attempt = ? AND status != 'cancelled'`, so a superseded or cancelled run can't
  overwrite the row — the title and author a download finds are the exception (see
  `original_filename` above). `attempt` is the one column `JobResponse` leaves out.
- **`stems_model` is dead.** Nothing writes it; it surfaces as `null` in every API response and
  in the TypeScript `Job` type.
- **`key_estimate`** is the flattened `f"{key} {mode}"` string. The structured form survives only
  in `analysis/key.json`, which no endpoint serves.
- **`tempo_bpm`, `key_estimate`, `key_confidence`** are all written in the *same* `UPDATE` that
  sets `status='done'` — see [../architecture/job-lifecycle.md](../architecture/job-lifecycle.md).
  `tempo_bpm` stays `NULL` when librosa finds no beat, which it reports as 0 BPM.
- **`source_url`** being non-null is how `run_job` picks the URL path; it then downloads only if
  `original.mp3` isn't already on disk.
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
  order never matters — which is why a migrated column's position doesn't.
- No WAL mode and no explicit isolation level; a locked database is waited on for
  `sqlite3.connect`'s default 5 s. Writes come from the worker thread and from request handlers
  (create, cancel, resume, discard), each a single short statement, so contention hasn't been a
  practical concern.

## Migrations

Additive, hardcoded, and run on every boot from `init_db()`:

```python
MIGRATED_COLUMNS = [
    ("source_url", "TEXT"),
    ("tempo_bpm", "REAL"),
    ("author", "TEXT"),
    ("error_log", "TEXT"),
    ("audio_format", "TEXT"),
    ("attempt", "INTEGER NOT NULL DEFAULT 0"),
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

A column only the server uses, like `attempt`, stops there. One the client should see also needs
mapping in `_row_to_response()` and adding to `JobResponse` and the TypeScript `Job`. Full
checklist: [../api/contract-sync.md](../api/contract-sync.md#checklist-for-a-contract-change).

### What this cannot do

- Rename or drop a column.
- Change an existing column's type or constraints, or add an index.
- Roll back. There is no version table and no down-migration.
- Backfill anything computed. Existing rows get the new column's `DEFAULT` — `NULL` unless one is
  declared, as `attempt` declares `0`.

The column type is interpolated into the `ALTER TABLE` string, so keep `MIGRATED_COLUMNS`
literal — it is not a parameterized query. The same string carries any constraint: SQLite accepts
`attempt`'s `NOT NULL` on `ADD COLUMN` only because it comes with a non-null default.

## Inspecting a live database

```bash
sqlite3 server/data/db.sqlite3 \
  "SELECT id, status, progress, stage_message, attempt, audio_format, error_message FROM jobs
   ORDER BY created_at DESC LIMIT 10;"

sqlite3 server/data/db.sqlite3 "SELECT error_log FROM jobs WHERE id = '<job_id>';"
```

Because the row *is* the progress channel, this shows exactly what the UI would display —
including stale rows left non-terminal by a restart. See
[retention.md](retention.md#stale-rows).
