import json
import logging
import subprocess
from pathlib import Path

logger = logging.getLogger(__name__)

_ARTIST_TAG_KEYS = ("artist", "ARTIST", "Artist", "album_artist", "ALBUM_ARTIST")


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
