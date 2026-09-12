import logging
import subprocess
from pathlib import Path

logger = logging.getLogger(__name__)

THUMBNAIL_FILENAME = "thumbnail.jpg"


def _run_ffmpeg(input_path: Path, output_path: Path, extra_args: list[str]) -> bool:
    try:
        result = subprocess.run(
            ["ffmpeg", "-y", "-i", str(input_path), *extra_args, str(output_path)],
            capture_output=True,
            timeout=30,
        )
    except (OSError, subprocess.TimeoutExpired) as exc:
        logger.warning("ffmpeg thumbnail extraction failed for %s: %s", input_path, exc)
        return False
    return result.returncode == 0 and output_path.exists() and output_path.stat().st_size > 0


def extract_embedded_cover(audio_path: Path, output_path: Path) -> bool:
    """Pull embedded cover art (an ID3 APIC frame) out of an audio file, if present."""
    return _run_ffmpeg(audio_path, output_path, ["-an", "-vcodec", "mjpeg", "-frames:v", "1"])


def convert_to_jpg(image_path: Path, output_path: Path) -> bool:
    """Normalize a downloaded thumbnail (webp/png/etc.) to a plain JPEG."""
    return _run_ffmpeg(image_path, output_path, [])
