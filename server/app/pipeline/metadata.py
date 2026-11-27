import json
import logging
import subprocess
from pathlib import Path

import soundfile as sf

logger = logging.getLogger(__name__)

_ARTIST_TAG_KEYS = ("artist", "ARTIST", "Artist", "album_artist", "ALBUM_ARTIST")

# libsndfile subtypes that carry a fixed bit depth; lossy formats have none to report.
_BIT_DEPTHS = {"PCM_S8": 8, "PCM_U8": 8, "PCM_16": 16, "PCM_24": 24, "PCM_32": 32, "FLOAT": 32, "DOUBLE": 64}


def read_audio_info(audio_path: Path, source_codec: str | None = None) -> tuple[float, str]:
    """Duration in seconds, plus a short format label for the processing screen ("FLAC 24/48", "MP3 44.1 kHz").

    `source_codec` names the lossy codec a link's audio was in before it became the FLAC being read; the label then
    says that, with no bit depth, as it would for the source itself: "OPUS 48 kHz".

    Unlike the tag read below, this raises on a file libsndfile can't open: nothing after it can
    run without a duration."""
    info = sf.info(str(audio_path))
    rate = f"{info.samplerate / 1000:g}"
    name = source_codec or info.format
    bits = None if source_codec else _BIT_DEPTHS.get(info.subtype)
    label = f"{name} {bits}/{rate}" if bits else f"{name} {rate} kHz"
    return info.frames / info.samplerate, label


def extract_author(audio_path: Path) -> str | None:
    """Read the ID3 artist tag from an audio file, if present."""
    try:
        result = subprocess.run(
            ["ffprobe", "-v", "quiet", "-print_format", "json", "-show_format", str(audio_path)],
            capture_output=True,
            timeout=15,
            text=True,
        )
    except (OSError, subprocess.TimeoutExpired) as exc:
        logger.warning("ffprobe metadata read failed for %s: %s", audio_path, exc)
        return None

    if result.returncode != 0:
        return None

    try:
        data = json.loads(result.stdout)
    except json.JSONDecodeError:
        return None

    tags = data.get("format", {}).get("tags", {})
    for key in _ARTIST_TAG_KEYS:
        value = tags.get(key)
        if value:
            return value.strip()
    return None
