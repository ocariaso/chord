import asyncio
import shutil
import uuid
from pathlib import Path

from fastapi import APIRouter, HTTPException, UploadFile
from fastapi.responses import StreamingResponse
from starlette import status
from starlette.concurrency import run_in_threadpool

from app.db.database import db_cursor, now_iso
from app.models.schemas import STEM_NAMES, TERMINAL_STATUSES, CreateJobFromUrlRequest, JobResponse, JobStatus
from app.pipeline.pipeline import job_dir
from app.pipeline.thumbnail import THUMBNAIL_FILENAME
from app.pipeline.worker import enqueue

router = APIRouter(prefix="/jobs", tags=["jobs"])


def _row_to_response(row) -> JobResponse:
    stem_names = STEM_NAMES if row["status"] == JobStatus.DONE.value else []
    has_thumbnail = (job_dir(row["id"]) / THUMBNAIL_FILENAME).exists()
    return JobResponse(
        id=row["id"],
        original_filename=row["original_filename"],
        author=row["author"],
        status=row["status"],
        progress=row["progress"],
        stage_message=row["stage_message"],
        error_message=row["error_message"],
        error_log=row["error_log"],
        stems_model=row["stems_model"],
        duration_seconds=row["duration_seconds"],
        audio_format=row["audio_format"],
        key_estimate=row["key_estimate"],
        key_confidence=row["key_confidence"],
        tempo_bpm=row["tempo_bpm"],
        created_at=row["created_at"],
        updated_at=row["updated_at"],
        stem_names=stem_names,
        has_thumbnail=has_thumbnail,
    )


ALLOWED_UPLOAD_EXTENSIONS = {".mp3", ".flac"}
_UPLOAD_COPY_CHUNK_BYTES = 1024 * 1024


def _save_upload(file: UploadFile, destination: Path) -> int:
    with destination.open("wb") as out:
        shutil.copyfileobj(file.file, out, _UPLOAD_COPY_CHUNK_BYTES)
    return destination.stat().st_size


@router.post("", status_code=status.HTTP_202_ACCEPTED, response_model=JobResponse)
async def create_job(file: UploadFile) -> JobResponse:
    extension = Path(file.filename).suffix.lower() if file.filename else ""
    if extension not in ALLOWED_UPLOAD_EXTENSIONS:
        raise HTTPException(status_code=400, detail="Only .mp3 and .flac uploads are supported")

    job_id = uuid.uuid4().hex
    directory = job_dir(job_id)
    directory.mkdir(parents=True, exist_ok=True)
    original_path = directory / f"original{extension}"

    # Streamed to disk off the event loop: a twelve-minute lossless file is hundreds of MB.
    if await run_in_threadpool(_save_upload, file, original_path) == 0:
        shutil.rmtree(directory, ignore_errors=True)
        raise HTTPException(status_code=400, detail="Uploaded file is empty")

    timestamp = now_iso()
    with db_cursor() as cur:
        cur.execute(
            """
            INSERT INTO jobs (id, original_filename, status, progress, created_at, updated_at)
            VALUES (?, ?, ?, 0, ?, ?)
            """,
            (job_id, file.filename, JobStatus.QUEUED.value, timestamp, timestamp),
        )
        cur.execute("SELECT * FROM jobs WHERE id = ?", (job_id,))
        row = cur.fetchone()

    enqueue(job_id)
    return _row_to_response(row)


@router.post("/from-url", status_code=status.HTTP_202_ACCEPTED, response_model=JobResponse)
async def create_job_from_url(payload: CreateJobFromUrlRequest) -> JobResponse:
    if not payload.url.strip():
        raise HTTPException(status_code=400, detail="A URL is required")

    job_id = uuid.uuid4().hex
    directory = job_dir(job_id)
    directory.mkdir(parents=True, exist_ok=True)

    timestamp = now_iso()
    with db_cursor() as cur:
        cur.execute(
            """
            INSERT INTO jobs (id, original_filename, status, progress, source_url, created_at, updated_at)
            VALUES (?, ?, ?, 0, ?, ?, ?)
            """,
            (job_id, payload.url, JobStatus.QUEUED.value, payload.url, timestamp, timestamp),
        )
        cur.execute("SELECT * FROM jobs WHERE id = ?", (job_id,))
        row = cur.fetchone()

    enqueue(job_id)
    return _row_to_response(row)


@router.get("", response_model=list[JobResponse])
async def list_jobs() -> list[JobResponse]:
    with db_cursor() as cur:
        cur.execute("SELECT * FROM jobs ORDER BY created_at DESC")
        rows = cur.fetchall()
    return [_row_to_response(row) for row in rows]


def _get_job_row(job_id: str):
    with db_cursor() as cur:
        cur.execute("SELECT * FROM jobs WHERE id = ?", (job_id,))
        row = cur.fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="Job not found")
    return row


@router.get("/{job_id}", response_model=JobResponse)
async def get_job(job_id: str) -> JobResponse:
    return _row_to_response(_get_job_row(job_id))


@router.post("/{job_id}/cancel", response_model=JobResponse)
async def cancel_job(job_id: str) -> JobResponse:
    row = _get_job_row(job_id)
    if row["status"] in TERMINAL_STATUSES:
        raise HTTPException(status_code=409, detail="Job has already finished")

    with db_cursor() as cur:
        cur.execute(
            "UPDATE jobs SET status = ?, stage_message = ?, updated_at = ? WHERE id = ?",
            (JobStatus.CANCELLED.value, "Cancelled", now_iso(), job_id),
        )
    return _row_to_response(_get_job_row(job_id))


@router.post("/{job_id}/resume", status_code=status.HTTP_202_ACCEPTED, response_model=JobResponse)
async def resume_job(job_id: str) -> JobResponse:
    """Re-queues a cancelled job. Bumping `attempt` retires the cancelled run, which may still be
    finishing its current stage, so the two can never write over each other."""
    row = _get_job_row(job_id)
    if row["status"] != JobStatus.CANCELLED.value:
        raise HTTPException(status_code=409, detail="Only a cancelled job can be resumed")

    with db_cursor() as cur:
        cur.execute(
            """
            UPDATE jobs SET status = ?, progress = 0, stage_message = NULL, error_message = NULL,
                            error_log = NULL, attempt = attempt + 1, updated_at = ?
            WHERE id = ?
            """,
            (JobStatus.QUEUED.value, now_iso(), job_id),
        )
    enqueue(job_id)
    return _row_to_response(_get_job_row(job_id))


@router.post("/{job_id}/heartbeat", status_code=status.HTTP_204_NO_CONTENT)
async def heartbeat_job(job_id: str) -> None:
    """Records that a page still has the job open, so the reaper keeps it. Only `last_seen_at` changes: the event
    stream and the processing screen's stage timings read `updated_at`, and must not see a heartbeat as progress."""
    with db_cursor() as cur:
        cur.execute("UPDATE jobs SET last_seen_at = ? WHERE id = ?", (now_iso(), job_id))
        found = cur.rowcount == 1
    if not found:
        raise HTTPException(status_code=404, detail="Job not found")


@router.post("/{job_id}/discard", status_code=status.HTTP_204_NO_CONTENT)
async def discard_job(job_id: str) -> None:
    """Cancels a still-running job or deletes a finished one, so leaving the page cleans it up."""
    row = _get_job_row(job_id)
    if row["status"] not in TERMINAL_STATUSES:
        with db_cursor() as cur:
            cur.execute(
                "UPDATE jobs SET status = ?, stage_message = ?, updated_at = ? WHERE id = ?",
                (JobStatus.CANCELLED.value, "Cancelled", now_iso(), job_id),
            )
        return
    with db_cursor() as cur:
        cur.execute("DELETE FROM jobs WHERE id = ?", (job_id,))
    shutil.rmtree(job_dir(job_id), ignore_errors=True)


@router.get("/{job_id}/events")
async def job_events(job_id: str) -> StreamingResponse:
    # Looked up before the stream opens: once the 200 has gone out, a missing job can only drop the connection.
    _get_job_row(job_id)

    async def event_stream():
        last_payload = None
        while True:
            row = _get_job_row(job_id)
            response = _row_to_response(row)
            payload = response.model_dump_json()
            if payload != last_payload:
                yield f"data: {payload}\n\n"
                last_payload = payload
            if response.status in TERMINAL_STATUSES:
                break
            await asyncio.sleep(0.5)

    return StreamingResponse(event_stream(), media_type="text/event-stream")
