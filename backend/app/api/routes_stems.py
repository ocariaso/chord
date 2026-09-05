import io
import zipfile

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse, Response

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


@router.get("/{job_id}/download")
def download_stems(job_id: str) -> Response:
    stems_dir = job_dir(job_id) / "stems"
    stem_paths = sorted(stems_dir.glob("*.wav")) if stems_dir.exists() else []
    if not stem_paths:
        raise HTTPException(status_code=404, detail="Stems not ready")

    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as zip_file:
        for stem_path in stem_paths:
            zip_file.write(stem_path, arcname=stem_path.name)

    return Response(
        buffer.getvalue(),
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{job_id}_stems.zip"'},
    )
