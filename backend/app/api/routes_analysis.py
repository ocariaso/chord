import json

from fastapi import APIRouter, HTTPException

from app.models.schemas import ChordSegment
from app.pipeline.pipeline import job_dir

router = APIRouter(prefix="/jobs", tags=["analysis"])


@router.get("/{job_id}/chords", response_model=list[ChordSegment])
async def get_chords(job_id: str) -> list[ChordSegment]:
    chords_path = job_dir(job_id) / "analysis" / "chords.json"
    if not chords_path.exists():
        raise HTTPException(status_code=404, detail="Chord analysis not available")
    return json.loads(chords_path.read_text())
