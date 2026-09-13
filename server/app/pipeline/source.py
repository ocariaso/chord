import logging
from pathlib import Path

import yt_dlp

from app.pipeline import thumbnail
from app.pipeline.errors import TrackTooLongError, UserFacingError

logger = logging.getLogger(__name__)


class SourceDownloadError(UserFacingError):
    """Raised with a message safe to show directly to the user."""


def download_audio(url: str, output_dir: Path, max_duration_seconds: float) -> tuple[Path, str, str | None]:
    """Extract audio from a URL (YouTube, SoundCloud, direct file, etc.) as an MP3.

    A source longer than max_duration_seconds (0 = no limit) is refused from its metadata, before
    any audio is downloaded."""
    output_dir.mkdir(parents=True, exist_ok=True)
    output_template = str(output_dir / "original.%(ext)s")
    rejected_duration: list[float] = []

    def skip_if_too_long(info: dict, *, incomplete: bool) -> str | None:
        duration = info.get("duration")
        if max_duration_seconds and duration and duration > max_duration_seconds:
            rejected_duration.append(duration)
            return "longer than the configured limit"  # any string makes yt-dlp skip the download
        return None

    ydl_opts = {
        "format": "bestaudio/best",
        "outtmpl": output_template,
        "postprocessors": [
            {"key": "FFmpegExtractAudio", "preferredcodec": "mp3", "preferredquality": "192"}
        ],
        "writethumbnail": True,
        "quiet": True,
        "no_warnings": True,
        "noplaylist": True,
        "match_filter": skip_if_too_long,
    }
    try:
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(url, download=True)
    except yt_dlp.utils.DownloadError as exc:
        logger.warning("yt-dlp failed for %s: %s", url, exc)
        raise SourceDownloadError(
            "Couldn't download audio from that link. Check that the URL is correct and publicly accessible."
        ) from exc

    if rejected_duration:
        raise TrackTooLongError(rejected_duration[0], max_duration_seconds)

    title = info.get("title") or url
    author = info.get("uploader") or info.get("channel")
    _normalize_downloaded_thumbnail(output_dir)

    return output_dir / "original.mp3", title, author


def _normalize_downloaded_thumbnail(output_dir: Path) -> None:
    """yt-dlp saves the thumbnail as original.<ext> (jpg/webp/png); convert it to a plain JPEG."""
    for candidate in output_dir.glob("original.*"):
        if candidate.suffix.lower() == ".mp3":
            continue
        thumbnail.convert_to_jpg(candidate, output_dir / thumbnail.THUMBNAIL_FILENAME)
        candidate.unlink(missing_ok=True)
