import struct
import zipfile
from collections.abc import Iterator
from pathlib import Path

import soundfile as sf
from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse, StreamingResponse

from app.models.schemas import STEM_NAMES
from app.pipeline.pipeline import job_dir
from app.pipeline.separation import STEM_SUFFIX
from app.pipeline.thumbnail import THUMBNAIL_FILENAME

router = APIRouter(prefix="/jobs", tags=["stems"])

_WAV_HEADER_BYTES = 44
_WAV_BLOCK_FRAMES = 1 << 16


class _ChunkSink:
    """A write-only stream that hands back whatever was written since it was last drained. It has no tell() or
    seek(), so ZipFile writes each entry's sizes after its data instead of seeking back for them."""

    def __init__(self) -> None:
        self._chunks: list[bytes] = []

    def write(self, data: bytes) -> int:
        self._chunks.append(bytes(data))
        return len(data)

    def flush(self) -> None:
        # Nothing is buffered below this; drain() is what hands the bytes on.
        return None

    def drain(self) -> Iterator[bytes]:
        chunks, self._chunks = self._chunks, []
        yield from chunks


def _stem_path(job_id: str, stem_name: str) -> Path:
    if stem_name not in STEM_NAMES:
        raise HTTPException(status_code=404, detail="Unknown stem")
    stem_path = job_dir(job_id) / "stems" / f"{stem_name}{STEM_SUFFIX}"
    if not stem_path.exists():
        raise HTTPException(status_code=404, detail="Stem not ready")
    return stem_path


def _wav_size(stem_path: Path) -> int:
    info = sf.info(str(stem_path))
    return _WAV_HEADER_BYTES + info.frames * info.channels * 2


def _wav_stream(stem_path: Path) -> Iterator[bytes]:
    """The stem as 16-bit PCM WAV, decoded from its FLAC a block at a time. The FLAC is lossless at 16 bits, so these
    are the separated samples exactly; the header is written first because every size is known up front."""
    info = sf.info(str(stem_path))
    block_align = info.channels * 2
    data_bytes = info.frames * block_align
    yield struct.pack(
        "<4sI4s4sIHHIIHH4sI",
        b"RIFF", 36 + data_bytes, b"WAVE",
        b"fmt ", 16, 1, info.channels, info.samplerate, info.samplerate * block_align, block_align, 16,
        b"data", data_bytes,
    )  # fmt: skip
    for block in sf.blocks(str(stem_path), blocksize=_WAV_BLOCK_FRAMES, dtype="int16", always_2d=True):
        yield block.astype("<i2", copy=False).tobytes()


def _zip_stream(stem_paths: list[Path]) -> Iterator[bytes]:
    sink = _ChunkSink()
    # Separated stems are long stretches of near-silence, so deflate still halves them. Its fastest level comes within
    # 4% of the default's size in under half the time.
    with zipfile.ZipFile(sink, "w", zipfile.ZIP_DEFLATED, compresslevel=1) as archive:
        for stem_path in stem_paths:
            with archive.open(f"{stem_path.stem}.wav", "w") as archived:
                for chunk in _wav_stream(stem_path):
                    archived.write(chunk)
                    yield from sink.drain()
            yield from sink.drain()
    yield from sink.drain()


@router.get("/{job_id}/thumbnail.jpg")
async def get_thumbnail(job_id: str) -> FileResponse:
    thumbnail_path = job_dir(job_id) / THUMBNAIL_FILENAME
    if not thumbnail_path.exists():
        raise HTTPException(status_code=404, detail="No thumbnail available")
    return FileResponse(thumbnail_path, media_type="image/jpeg")


@router.get("/{job_id}/stems/{stem_name}.flac")
async def get_stem(job_id: str, stem_name: str) -> FileResponse:
    """The stem as stored, for playback: half the bytes of WAV to download before the mixer can start."""
    return FileResponse(_stem_path(job_id, stem_name), media_type="audio/flac")


@router.get("/{job_id}/stems/{stem_name}.wav")
def download_stem_wav(job_id: str, stem_name: str) -> StreamingResponse:
    """The stem as uncompressed WAV, for export. Converted as it streams, so nothing is written or held in memory."""
    stem_path = _stem_path(job_id, stem_name)
    return StreamingResponse(
        _wav_stream(stem_path), media_type="audio/wav", headers={"Content-Length": str(_wav_size(stem_path))}
    )


@router.get("/{job_id}/download")
def download_stems(job_id: str) -> StreamingResponse:
    stems_dir = job_dir(job_id) / "stems"
    stem_paths = sorted(stems_dir.glob(f"*{STEM_SUFFIX}")) if stems_dir.exists() else []
    if not stem_paths:
        raise HTTPException(status_code=404, detail="Stems not ready")

    # Every stem as WAV, streamed as the archive is built, so the download starts at once and is never held in memory.
    return StreamingResponse(
        _zip_stream(stem_paths),
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{job_id}_stems.zip"'},
    )
