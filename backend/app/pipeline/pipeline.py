import json
import logging
from pathlib import Path

import soundfile as sf

from app.core.config import settings
from app.db.database import db_cursor, now_iso
from app.models.schemas import JobStatus
from app.pipeline import chords, metadata, separation, source, tempo, thumbnail

logger = logging.getLogger(__name__)


def _update_job(job_id: str, **fields) -> None:
    fields["updated_at"] = now_iso()
    columns = ", ".join(f"{key} = ?" for key in fields)
    with db_cursor() as cur:
        cur.execute(f"UPDATE jobs SET {columns} WHERE id = ?", (*fields.values(), job_id))


def _get_job_row(job_id: str):
    with db_cursor() as cur:
        cur.execute("SELECT * FROM jobs WHERE id = ?", (job_id,))
        return cur.fetchone()


def _is_cancelled(job_id: str) -> bool:
    row = _get_job_row(job_id)
    return row is None or row["status"] == JobStatus.CANCELLED.value


def job_dir(job_id: str) -> Path:
    return settings.jobs_dir / job_id


def run_job(job_id: str) -> None:
    directory = job_dir(job_id)
    stems_dir = directory / "stems"
    analysis_dir = directory / "analysis"

    try:
        if _is_cancelled(job_id):
            return

        source_url = _get_job_row(job_id)["source_url"]
        if source_url:
            original_path = directory / "original.mp3"
            _update_job(job_id, status=JobStatus.FETCHING.value, progress=0.05, stage_message="Downloading audio")
            downloaded_path, title, author = source.download_audio(source_url, directory)
            if downloaded_path != original_path:
                downloaded_path.rename(original_path)
            _update_job(job_id, original_filename=title, author=author)
        else:
            original_path = next(directory.glob("original.*"))
            author = metadata.extract_author(original_path)
            if author:
                _update_job(job_id, author=author)

        if _is_cancelled(job_id):
            return

        thumbnail_path = directory / thumbnail.THUMBNAIL_FILENAME
        if not thumbnail_path.exists():
            thumbnail.extract_embedded_cover(original_path, thumbnail_path)

        _update_job(job_id, status=JobStatus.SEPARATING.value, progress=0.1, stage_message="Separating stems")
        with sf.SoundFile(original_path) as f:
            duration_seconds = len(f) / f.samplerate
        separation.separate(original_path, stems_dir)

        if _is_cancelled(job_id):
            return

        done_fields = dict(
            status=JobStatus.DONE.value,
            progress=1.0,
            stage_message="Done",
            duration_seconds=duration_seconds,
        )

        _update_job(job_id, progress=0.5, stage_message="Detecting tempo")
        done_fields["tempo_bpm"] = tempo.detect_tempo(original_path)

        if _is_cancelled(job_id):
            return

        if settings.enable_chord_detection:
            _update_job(job_id, status=JobStatus.ANALYZING.value, progress=0.6, stage_message="Detecting chords and key")
            analysis_dir.mkdir(parents=True, exist_ok=True)
            segments, key_estimate = chords.analyze_audio(original_path)

            (analysis_dir / "chords.json").write_text(
                json.dumps([segment.model_dump() for segment in segments], indent=2)
            )
            (analysis_dir / "key.json").write_text(json.dumps(key_estimate.model_dump(), indent=2))

            done_fields["key_estimate"] = f"{key_estimate.key} {key_estimate.mode}"
            done_fields["key_confidence"] = key_estimate.confidence

        if _is_cancelled(job_id):
            return

        _update_job(job_id, **done_fields)
    except Exception as exc:  # noqa: BLE001 - any failure must reach the job row
        if _is_cancelled(job_id):
            return
        logger.exception("Job %s failed", job_id)
        _update_job(job_id, status=JobStatus.ERROR.value, error_message=str(exc))
