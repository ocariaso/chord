import json
import logging
import time
from collections.abc import Callable, Iterator
from concurrent.futures import Future, ThreadPoolExecutor
from contextlib import contextmanager
from pathlib import Path

from app.core.config import settings
from app.db.database import db_cursor, now_iso
from app.models.schemas import STEM_NAMES, ChordSegment, JobStatus, KeyEstimate
from app.pipeline import chords, decode, metadata, separation, source, tempo, thumbnail
from app.pipeline.errors import TrackTooLongError, UserFacingError

logger = logging.getLogger(__name__)

# Tempo, chord and key detection run beside separation, so Demucs' own chunk progress fills most of the bar; the
# two steps after it are shown only for analysis still running once the stems are written.
_SEPARATION_PROGRESS = (0.1, 0.85)
_TEMPO_PROGRESS = 0.85
_CHORDS_PROGRESS = 0.9
# However many chunks Demucs reports: one row write per percentage point of the bar, one
# cancellation check every two seconds.
_PROGRESS_WRITE_STEP = 0.01
_SUPERSEDED_POLL_SECONDS = 2.0

# An unexpected exception reads as internal, so the row carries a sentence about the stage that
# failed and the exception itself goes to error_log, which the failure panel shows as a log.
_STAGE_FAILURE_MESSAGES = {
    "downloading": "The audio download stopped with an error.",
    "reading": "CHORD couldn't read the audio source.",
    "separating": "Stem separation stopped with an error.",
    "tempo": "Tempo detection stopped with an error.",
    "analyzing": "Chord and key detection stopped with an error.",
}


class _Superseded(Exception):
    """Raised inside a long stage to abandon a run whose job was cancelled, deleted or resumed."""


@contextmanager
def _timed(step: str) -> Iterator[None]:
    # The log is the only record of where a job's time goes, so a step is timed whether it finished or raised.
    started = time.monotonic()
    try:
        yield
    finally:
        logger.info("%s took %.1f s", step, time.monotonic() - started)


def _update_job(job_id: str, attempt: int, **fields) -> None:
    # Scoped to this run, so a superseded attempt or a job the user cancelled is never overwritten.
    fields["updated_at"] = now_iso()
    columns = ", ".join(f"{key} = ?" for key in fields)
    with db_cursor() as cur:
        cur.execute(
            f"UPDATE jobs SET {columns} WHERE id = ? AND attempt = ? AND status != ?",
            (*fields.values(), job_id, attempt, JobStatus.CANCELLED.value),
        )


def _record_track_identity(job_id: str, title: str, author: str | None) -> None:
    # Not scoped like _update_job: a resume skips the download that found the title and author, so a
    # run cancelled mid-download must still keep them. They describe the job however the run ended.
    with db_cursor() as cur:
        cur.execute(
            "UPDATE jobs SET original_filename = ?, author = ?, updated_at = ? WHERE id = ?",
            (title, author, now_iso(), job_id),
        )


def _get_job_row(job_id: str):
    with db_cursor() as cur:
        cur.execute("SELECT * FROM jobs WHERE id = ?", (job_id,))
        return cur.fetchone()


def _is_superseded(job_id: str, attempt: int) -> bool:
    row = _get_job_row(job_id)
    return row is None or row["status"] == JobStatus.CANCELLED.value or row["attempt"] != attempt


def job_dir(job_id: str) -> Path:
    return settings.jobs_dir / job_id


def _stems_complete(stems_dir: Path) -> bool:
    return all((stems_dir / f"{name}{separation.STEM_SUFFIX}").exists() for name in STEM_NAMES)


def warm_up() -> None:
    """Loads the separation and analysis models and compiles the beat tracker, so the first job after a start doesn't
    wait for them."""
    with _timed("Model warm-up"):
        separation.load_model()
        tempo.warm_up()
        if settings.enable_chord_detection:
            chords.load_models()


def _separation_progress(job_id: str, attempt: int) -> Callable[[float], None]:
    start, end = _SEPARATION_PROGRESS
    last_written = start
    last_poll = time.monotonic()

    def on_progress(fraction: float) -> None:
        nonlocal last_written, last_poll
        if time.monotonic() - last_poll >= _SUPERSEDED_POLL_SECONDS:
            last_poll = time.monotonic()
            if _is_superseded(job_id, attempt):
                raise _Superseded
        progress = start + fraction * (end - start)
        if progress - last_written >= _PROGRESS_WRITE_STEP:
            last_written = progress
            _update_job(job_id, attempt, progress=round(progress, 3))

    return on_progress


def _start_analysis(
    job_id: str, original_path: Path, executor: ThreadPoolExecutor
) -> tuple["Future[float]", "Future[tuple[list[ChordSegment], KeyEstimate]] | None"]:
    """Queues tempo detection, then chord and key detection, on `executor`, sharing one decode of the original.

    A decode failure is raised by the tempo future, as librosa's own read failing once was."""

    def decode_original():
        with _timed(f"Job {job_id}: analysis decode"):
            return decode.decode_mono(original_path)

    signal = executor.submit(decode_original)

    def detect_tempo() -> float:
        samples = signal.result()
        with _timed(f"Job {job_id}: tempo detection"):
            return tempo.detect_tempo(samples, samples.sample_rate)

    def detect_chords() -> tuple[list[ChordSegment], KeyEstimate]:
        samples = signal.result()
        with _timed(f"Job {job_id}: chord and key detection"):
            return chords.analyze_audio(samples)

    tempo_future = executor.submit(detect_tempo)
    chords_future = executor.submit(detect_chords) if settings.enable_chord_detection else None
    return tempo_future, chords_future


def _describe_failure(stage: str, exc: Exception) -> tuple[str, str | None]:
    if isinstance(exc, UserFacingError):
        return str(exc), str(exc.__cause__) if exc.__cause__ else None
    return _STAGE_FAILURE_MESSAGES[stage], f"{type(exc).__name__}: {exc}"


def run_job(job_id: str) -> None:
    row = _get_job_row(job_id)
    # Only a queued row runs: a job cancelled while it waited and then resumed is in the queue twice,
    # and the stale copy must not re-run it after the live one finishes.
    if row is None or row["status"] != JobStatus.QUEUED.value:
        return
    attempt = row["attempt"]
    started = time.monotonic()

    directory = job_dir(job_id)
    stems_dir = directory / "stems"
    analysis_dir = directory / "analysis"
    stage = "reading"

    try:
        if row["source_url"]:
            original_path = directory / "original.mp3"
            # A resumed job keeps the audio its cancelled attempt already downloaded.
            if not original_path.exists():
                stage = "downloading"
                _update_job(
                    job_id, attempt, status=JobStatus.FETCHING.value, progress=0.05, stage_message="Downloading audio"
                )
                with _timed(f"Job {job_id}: download"):
                    downloaded_path, title, author = source.download_audio(
                        row["source_url"], directory, settings.max_duration_seconds
                    )
                if downloaded_path != original_path:
                    downloaded_path.rename(original_path)
                _record_track_identity(job_id, title, author)
                stage = "reading"
        else:
            original_path = next(directory.glob("original.*"))
            author = metadata.extract_author(original_path)
            if author:
                _update_job(job_id, attempt, author=author)

        if _is_superseded(job_id, attempt):
            return

        thumbnail_path = directory / thumbnail.THUMBNAIL_FILENAME
        if not thumbnail_path.exists():
            thumbnail.extract_embedded_cover(original_path, thumbnail_path)

        duration_seconds, audio_format = metadata.read_audio_info(original_path)
        if settings.max_duration_seconds and duration_seconds > settings.max_duration_seconds:
            raise TrackTooLongError(duration_seconds, settings.max_duration_seconds)

        stage = "separating"
        # Duration and format are written now rather than with the results, so the processing
        # screen can show them while separation runs.
        _update_job(
            job_id,
            attempt,
            status=JobStatus.SEPARATING.value,
            progress=_SEPARATION_PROGRESS[0],
            stage_message="Separating stems",
            duration_seconds=duration_seconds,
            audio_format=audio_format,
        )

        # Tempo, chord and key detection read only the original, never the stems, so they run on a thread of their
        # own while Demucs separates rather than after it — on a GPU they would otherwise be most of the wait.
        # Results are collected and written only here, so an abandoned run's analysis writes nothing.
        analysis = ThreadPoolExecutor(max_workers=1, thread_name_prefix="chord-analysis")
        try:
            tempo_future, chords_future = _start_analysis(job_id, original_path, analysis)

            if not _stems_complete(stems_dir):
                with _timed(f"Job {job_id}: separation"):
                    separation.separate(original_path, stems_dir, on_progress=_separation_progress(job_id, attempt))

            if _is_superseded(job_id, attempt):
                return

            done_fields = dict(status=JobStatus.DONE.value, progress=1.0, stage_message="Done")

            stage = "tempo"
            # A step that finished during separation never becomes the current stage; the screen shows it as done.
            if not tempo_future.done():
                _update_job(job_id, attempt, progress=_TEMPO_PROGRESS, stage_message="Detecting tempo")
            # librosa reports 0 BPM when it finds no beat at all; null says the same to the API, and keeps the
            # metronome disabled rather than enabled with nothing to click at.
            done_fields["tempo_bpm"] = tempo_future.result() or None

            if _is_superseded(job_id, attempt):
                return

            if chords_future is not None:
                stage = "analyzing"
                if not chords_future.done():
                    _update_job(
                        job_id,
                        attempt,
                        status=JobStatus.ANALYZING.value,
                        progress=_CHORDS_PROGRESS,
                        stage_message="Detecting chords and key",
                    )
                segments, key_estimate = chords_future.result()

                analysis_dir.mkdir(parents=True, exist_ok=True)
                (analysis_dir / "chords.json").write_text(
                    json.dumps([segment.model_dump() for segment in segments], indent=2)
                )
                (analysis_dir / "key.json").write_text(json.dumps(key_estimate.model_dump(), indent=2))

                done_fields["key_estimate"] = f"{key_estimate.key} {key_estimate.mode}"
                done_fields["key_confidence"] = key_estimate.confidence
        finally:
            # Drops analysis that hasn't started. A step already running can't be interrupted, so an abandoned run's
            # finishes on its own, unread, while the next job starts.
            analysis.shutdown(wait=False, cancel_futures=True)

        if _is_superseded(job_id, attempt):
            return

        _update_job(job_id, attempt, **done_fields)
        logger.info("Job %s: finished in %.1f s", job_id, time.monotonic() - started)
    except _Superseded:
        return
    except Exception as exc:  # noqa: BLE001 - any failure must reach the job row
        if _is_superseded(job_id, attempt):
            return
        logger.exception("Job %s failed", job_id)
        error_message, error_log = _describe_failure(stage, exc)
        failure = dict(status=JobStatus.ERROR.value, error_message=error_message, error_log=error_log)
        # Reading the audio falls between stages, so a failure there must not keep the finished download's
        # message: the row would name a stage that had already succeeded.
        if stage == "reading":
            failure["stage_message"] = None
        _update_job(job_id, attempt, **failure)
