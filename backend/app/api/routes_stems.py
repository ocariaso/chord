from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse

from app.models.schemas import STEM_NAMES
from app.pipeline.pipeline import job_dir

router = APIRouter(prefix="/jobs", tags=["stems"])


@router.get("/{job_id}/stems/{stem_name}.wav")
async def get_stem(job_id: str, stem_name: str) -> FileResponse:
    if stem_name not in STEM_NAMES:
        raise HTTPException(status_code=404, detail="Unknown stem")

    stem_path = job_dir(job_id) / "stems" / f"{stem_name}.wav"
    if not stem_path.exists():
        raise HTTPException(status_code=404, detail="Stem not ready")

    # FileResponse supports HTTP range requests, which <audio> needs to seek.
    return FileResponse(stem_path, media_type="audio/wav")
