import json

from fastapi import APIRouter, HTTPException

from app.db.database import db_cursor
from app.models.schemas import ChordSegment, LyricsResponse, SaveLyricsRequest
from app.pipeline.lyrics import estimate_lyrics_offset, fetch_lyrics, guess_candidates, parse_lyrics_text
from app.pipeline.pipeline import job_dir
from app.pipeline.separation import STEM_SUFFIX

router = APIRouter(prefix="/jobs", tags=["analysis"])


@router.get("/{job_id}/chords", response_model=list[ChordSegment])
async def get_chords(job_id: str) -> list[ChordSegment]:
    chords_path = job_dir(job_id) / "analysis" / "chords.json"
    if not chords_path.exists():
        raise HTTPException(status_code=404, detail="Chord analysis not available")
    return json.loads(chords_path.read_text())


# A plain def, so FastAPI runs it in its threadpool: the lookup makes blocking HTTP calls and reads the
# vocals stem, which on the event loop would stall every other request, event streams included.
@router.get("/{job_id}/lyrics", response_model=LyricsResponse)
def get_lyrics(job_id: str) -> LyricsResponse:
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
        vocals_path = job_dir(job_id) / "stems" / f"vocals{STEM_SUFFIX}"
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


@router.put("/{job_id}/lyrics", response_model=LyricsResponse)
async def save_lyrics(job_id: str, payload: SaveLyricsRequest) -> LyricsResponse:
    """Replaces the cached lookup with lyrics the user pasted. LRC timing is kept exactly as pasted —
    no offset correction, since the person pasting it chose that timing."""
    with db_cursor() as cur:
        cur.execute("SELECT id FROM jobs WHERE id = ?", (job_id,))
        row = cur.fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="Job not found")

    result = parse_lyrics_text(payload.text)
    if result is None:
        raise HTTPException(status_code=400, detail="Paste the lyrics before saving")

    lyrics_path = job_dir(job_id) / "analysis" / "lyrics.json"
    lyrics_path.parent.mkdir(parents=True, exist_ok=True)
    lyrics_path.write_text(json.dumps(result))
    return result
