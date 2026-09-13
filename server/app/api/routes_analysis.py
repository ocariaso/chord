import json

from fastapi import APIRouter, HTTPException

from app.db.database import db_cursor
from app.models.schemas import ChordSegment, LyricsResponse
from app.pipeline.lyrics import estimate_lyrics_offset, fetch_lyrics, guess_candidates
from app.pipeline.pipeline import job_dir

router = APIRouter(prefix="/jobs", tags=["analysis"])


@router.get("/{job_id}/chords", response_model=list[ChordSegment])
async def get_chords(job_id: str) -> list[ChordSegment]:
    chords_path = job_dir(job_id) / "analysis" / "chords.json"
    if not chords_path.exists():
        raise HTTPException(status_code=404, detail="Chord analysis not available")
    return json.loads(chords_path.read_text())


@router.get("/{job_id}/lyrics", response_model=LyricsResponse)
async def get_lyrics(job_id: str) -> LyricsResponse:
    lyrics_path = job_dir(job_id) / "analysis" / "lyrics.json"
    if lyrics_path.exists():
        cached = json.loads(lyrics_path.read_text())
        if cached is None:
            raise HTTPException(status_code=404, detail="No lyrics found")
        return cached

    with db_cursor() as cur:
        cur.execute("SELECT original_filename, author, duration_seconds FROM jobs WHERE id = ?", (job_id,))
        row = cur.fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="Job not found")

    result = None
    for track_name, artist_name in guess_candidates(row["original_filename"], row["author"]):
        result = fetch_lyrics(track_name, artist_name, row["duration_seconds"])
        if result:
            break

    if result and result["synced"]:
        vocals_path = job_dir(job_id) / "stems" / "vocals.wav"
        if vocals_path.exists():
            offset = estimate_lyrics_offset(vocals_path, result["synced"])
            if offset:
                for line in result["synced"]:
                    line["time"] = round(max(0.0, line["time"] + offset), 2)

    lyrics_path.parent.mkdir(parents=True, exist_ok=True)
    lyrics_path.write_text(json.dumps(result))

    if result is None:
        raise HTTPException(status_code=404, detail="No lyrics found")
    return result
