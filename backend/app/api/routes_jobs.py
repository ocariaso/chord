import asyncio
import json
import uuid

from fastapi import APIRouter, HTTPException, UploadFile
from fastapi.responses import StreamingResponse
from starlette import status

from app.db.database import db_cursor, now_iso
from app.models.schemas import STEM_NAMES, CreateJobFromUrlRequest, JobResponse, JobStatus
from app.pipeline.pipeline import job_dir
from app.pipeline.worker import enqueue

router = APIRouter(prefix="/jobs", tags=["jobs"])


def _row_to_response(row) -> JobResponse:
    stem_names = STEM_NAMES if row["status"] == JobStatus.DONE.value else []
    return JobResponse(
        id=row["id"],
        original_filename=row["original_filename"],
        status=row["status"],
        progress=row["progress"],
        stage_message=row["stage_message"],
        error_message=row["error_message"],
        stems_model=row["stems_model"],
        duration_seconds=row["duration_seconds"],
        key_estimate=row["key_estimate"],
        key_confidence=row["key_confidence"],
        tempo_bpm=row["tempo_bpm"],
        created_at=row["created_at"],
        updated_at=row["updated_at"],
        stem_names=stem_names,
    )


@router.post("", status_code=status.HTTP_202_ACCEPTED, response_model=JobResponse)
async def create_job(file: UploadFile) -> JobResponse:
    if not file.filename or not file.filename.lower().endswith(".mp3"):
        raise HTTPException(status_code=400, detail="Only .mp3 uploads are supported")

    job_id = uuid.uuid4().hex
    directory = job_dir(job_id)
    directory.mkdir(parents=True, exist_ok=True)
    original_path = directory / "original.mp3"

    contents = await file.read()
    if not contents:
        raise HTTPException(status_code=400, detail="Uploaded file is empty")
    original_path.write_bytes(contents)

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


TERMINAL_STATUSES = {JobStatus.DONE.value, JobStatus.ERROR.value, JobStatus.CANCELLED.value}


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


@router.get("/{job_id}/events")
async def job_events(job_id: str) -> StreamingResponse:
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
