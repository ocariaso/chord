import json
import logging
from pathlib import Path

import soundfile as sf

from app.core.config import settings
from app.db.database import db_cursor, now_iso
from app.models.schemas import JobStatus
from app.pipeline import chords, separation

logger = logging.getLogger(__name__)


def _update_job(job_id: str, **fields) -> None:
    fields["updated_at"] = now_iso()
    columns = ", ".join(f"{key} = ?" for key in fields)
    with db_cursor() as cur:
        cur.execute(f"UPDATE jobs SET {columns} WHERE id = ?", (*fields.values(), job_id))


def job_dir(job_id: str) -> Path:
    return settings.jobs_dir / job_id


def run_job(job_id: str) -> None:
    directory = job_dir(job_id)
    original_path = directory / "original.mp3"
    stems_dir = directory / "stems"
    analysis_dir = directory / "analysis"

    try:
        _update_job(job_id, status=JobStatus.SEPARATING.value, progress=0.1, stage_message="Separating stems")
        with sf.SoundFile(original_path) as f:
            duration_seconds = len(f) / f.samplerate
        separation.separate(original_path, stems_dir)

        done_fields = dict(
            status=JobStatus.DONE.value,
            progress=1.0,
            stage_message="Done",
            duration_seconds=duration_seconds,
        )

        if settings.enable_chord_detection:
            _update_job(job_id, status=JobStatus.ANALYZING.value, progress=0.7, stage_message="Detecting chords and key")
            analysis_dir.mkdir(parents=True, exist_ok=True)
            segments, key_estimate = chords.analyze_stems(stems_dir)

            (analysis_dir / "chords.json").write_text(
                json.dumps([segment.model_dump() for segment in segments], indent=2)
            )
            (analysis_dir / "key.json").write_text(json.dumps(key_estimate.model_dump(), indent=2))

            done_fields["key_estimate"] = f"{key_estimate.key} {key_estimate.mode}"
            done_fields["key_confidence"] = key_estimate.confidence

        _update_job(job_id, **done_fields)
    except Exception as exc:  # noqa: BLE001 - any failure must reach the job row
        logger.exception("Job %s failed", job_id)
        _update_job(job_id, status=JobStatus.ERROR.value, error_message=str(exc))
