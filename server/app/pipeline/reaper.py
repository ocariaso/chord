import logging
import os
import shutil
import threading
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

from app.core.config import settings
from app.db.database import db_cursor
from app.models.schemas import TERMINAL_STATUSES
from app.pipeline.pipeline import job_dir

logger = logging.getLogger(__name__)

_SWEEP_INTERVAL_SECONDS = 3600
# A job's directory is created, and an upload copied into it, before its row is inserted, and a cancelled run can
# still be finishing a stage in a terminal job's directory. Either is left alone until it has been quiet this long.
_GRACE_SECONDS = 3600

_TERMINAL = tuple(TERMINAL_STATUSES)
_TERMINAL_PLACEHOLDERS = ", ".join("?" for _ in _TERMINAL)

_reaper_thread: threading.Thread | None = None


def _size_of(path: Path) -> int:
    total = 0
    for root, _dirs, files in os.walk(path):
        for name in files:
            try:
                total += os.lstat(os.path.join(root, name)).st_size
            except OSError:  # removed while walking; it no longer counts toward what is freed
                pass
    return total


def _remove(path: Path) -> int:
    freed = _size_of(path)
    shutil.rmtree(path, ignore_errors=True)
    return freed


def _last_modified(directory: Path) -> float:
    # An upload being copied in changes its file's mtime, not the directory's, so the newest direct child counts too.
    latest = directory.stat().st_mtime
    with os.scandir(directory) as entries:
        for entry in entries:
            try:
                latest = max(latest, entry.stat(follow_symlinks=False).st_mtime)
            except OSError:  # removed while scanning; it can't make the directory any newer
                pass
    return latest


def _is_quiet(updated_at: str, now: datetime) -> bool:
    return now - datetime.fromisoformat(updated_at) >= timedelta(seconds=_GRACE_SECONDS)


# A finished job's row stops changing, and playing it asks nothing of the server once the stems are loaded, so a
# page that still has it open says so with a heartbeat. A job expires only when neither has happened within the TTL.
_EXPIRED = f"status IN ({_TERMINAL_PLACEHOLDERS}) AND updated_at < ? AND COALESCE(last_seen_at, updated_at) < ?"


def _reap_expired_jobs(now: datetime) -> tuple[int, int]:
    cutoff = (now - timedelta(hours=settings.job_ttl_hours)).isoformat()
    with db_cursor() as cur:
        cur.execute(f"SELECT id FROM jobs WHERE {_EXPIRED}", (*_TERMINAL, cutoff, cutoff))
        job_ids = [row["id"] for row in cur.fetchall()]

    deleted = freed = 0
    for job_id in job_ids:
        # The conditions are repeated in the DELETE: a resume or a heartbeat since the SELECT makes the job recent, and
        # it must survive. Files go only once the row has, so a resume that comes after finds no job rather than no
        # audio.
        with db_cursor() as cur:
            cur.execute(f"DELETE FROM jobs WHERE id = ? AND {_EXPIRED}", (job_id, *_TERMINAL, cutoff, cutoff))
            removed = cur.rowcount == 1
        if removed:
            deleted += 1
            freed += _remove(job_dir(job_id))
    return deleted, freed


def _reap_directories(now: datetime) -> tuple[int, int, int]:
    # Read after the expired jobs are gone and before the listing, so a job created during the sweep has a directory
    # too new to be taken for an orphan.
    with db_cursor() as cur:
        cur.execute("SELECT id, status, updated_at FROM jobs")
        rows = {row["id"]: row for row in cur.fetchall()}

    orphans = partials = freed = 0
    for directory in settings.jobs_dir.iterdir():
        if not directory.is_dir():
            continue
        row = rows.get(directory.name)
        try:
            if row is None:
                if now.timestamp() - _last_modified(directory) >= _GRACE_SECONDS:
                    orphans += 1
                    freed += _remove(directory)
            elif row["status"] in TERMINAL_STATUSES and _is_quiet(row["updated_at"], now):
                # Only a terminal job's: a live one's separation clears its own before it starts, and may be writing
                # into it now.
                partial = directory / "stems.partial"
                if partial.is_dir():
                    partials += 1
                    freed += _remove(partial)
        except FileNotFoundError:  # discarded while the sweep reached it; there's nothing left to delete
            pass
    return orphans, partials, freed


def sweep() -> None:
    """Deletes terminal jobs that neither changed nor had a heartbeat within `job_ttl_hours`, job directories with no
    row, and the scratch a terminal job's interrupted separation left. Never touches a job that is still queued or
    running."""
    now = datetime.now(timezone.utc)
    expired, freed_jobs = _reap_expired_jobs(now)
    orphans, partials, freed_directories = _reap_directories(now)
    if expired or orphans or partials:
        logger.info(
            "Job reaper: deleted %d expired jobs, %d orphaned directories and %d partial separations, freeing %.1f MB",
            expired,
            orphans,
            partials,
            (freed_jobs + freed_directories) / 1_000_000,
        )


def _run() -> None:
    while True:
        try:
            sweep()
        except Exception:  # noqa: BLE001 - whatever this sweep missed, the next one finds; the thread must survive
            logger.exception("Job reaper sweep failed")
        time.sleep(_SWEEP_INTERVAL_SECONDS)


def start_reaper() -> None:
    global _reaper_thread
    if settings.job_ttl_hours <= 0:
        logger.info("Job reaper is off: JOB_TTL_HOURS is %s", settings.job_ttl_hours)
        return
    if _reaper_thread is None:
        # Its own thread, so the first sweep's deletes don't hold up startup, and a sweep never waits behind a job.
        _reaper_thread = threading.Thread(target=_run, daemon=True, name="chord-job-reaper")
        _reaper_thread.start()
