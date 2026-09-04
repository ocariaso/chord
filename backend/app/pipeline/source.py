import logging
from pathlib import Path

import yt_dlp

logger = logging.getLogger(__name__)


class SourceDownloadError(Exception):
    """Raised with a message safe to show directly to the user."""


def download_audio(url: str, output_dir: Path) -> tuple[Path, str]:
    """Extract audio from a URL (YouTube, SoundCloud, direct file, etc.) as an MP3."""
    output_dir.mkdir(parents=True, exist_ok=True)
    output_template = str(output_dir / "original.%(ext)s")

    ydl_opts = {
        "format": "bestaudio/best",
        "outtmpl": output_template,
        "postprocessors": [
            {"key": "FFmpegExtractAudio", "preferredcodec": "mp3", "preferredquality": "192"}
        ],
        "quiet": True,
        "no_warnings": True,
        "noplaylist": True,
    }
    try:
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(url, download=True)
            title = info.get("title") or url
    except yt_dlp.utils.DownloadError as exc:
        logger.warning("yt-dlp failed for %s: %s", url, exc)
        raise SourceDownloadError(
            "Couldn't download audio from that link. Check that the URL is correct and publicly accessible."
        ) from exc

    return output_dir / "original.mp3", title
