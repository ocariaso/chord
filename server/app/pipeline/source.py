import logging
from pathlib import Path
from typing import NamedTuple

import yt_dlp

from app.pipeline import metadata, thumbnail
from app.pipeline.errors import TrackTooLongError, UserFacingError

logger = logging.getLogger(__name__)

# A link's audio is kept as FLAC. ffmpeg writes one about four times as fast as the 192 kbps MP3 this used to make,
# and separation then hears the source as it decoded, not through a second lossy encoding.
DOWNLOAD_FILENAME = "original.flac"

# The lossy codecs a link's audio usually arrives in, by yt-dlp's name for them, as the processing screen shows them:
# the FLAC the audio is converted to says nothing of what it was.
_SOURCE_CODECS = {"opus": "OPUS", "mp4a": "AAC", "aac": "AAC", "mp3": "MP3", "vorbis": "VORBIS"}
# A direct link to a file has no codec in its metadata, only an extension, and only some of those name one.
_SOURCE_EXTENSIONS = {"mp3": "MP3", "m4a": "AAC", "aac": "AAC", "opus": "OPUS"}


class SourceDownloadError(UserFacingError):
    """Raised with a message safe to show directly to the user."""


class Download(NamedTuple):
    path: Path
    title: str
    author: str | None
    # A label for the processing screen, as `metadata.read_audio_info` writes them.
    audio_format: str


def _source_codec(info: dict) -> str | None:
    """The lossy codec the link's audio came in, or None for a lossless or unrecognized one, which the converted
    file's own format describes."""
    codec = (info.get("acodec") or "").split(".")[0]
    return _SOURCE_CODECS.get(codec) or _SOURCE_EXTENSIONS.get(info.get("ext") or "")


def download_audio(url: str, output_dir: Path, max_duration_seconds: float) -> Download:
    """Extract audio from a URL (YouTube, SoundCloud, direct file, etc.) as a FLAC.

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
        "postprocessors": [{"key": "FFmpegExtractAudio", "preferredcodec": "flac"}],
        # 16-bit, as the stems are. Left to itself ffmpeg writes a lossy codec's decoded samples as 24-bit: a file
        # twice the size that holds nothing more.
        "postprocessor_args": {"extractaudio": ["-sample_fmt", "s16"]},
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

    path = output_dir / DOWNLOAD_FILENAME
    _, audio_format = metadata.read_audio_info(path, _source_codec(info))
    return Download(path, title, author, audio_format)


def _normalize_downloaded_thumbnail(output_dir: Path) -> None:
    """yt-dlp saves the thumbnail as original.<ext> (jpg/webp/png); convert it to a plain JPEG."""
    for candidate in output_dir.glob("original.*"):
        if candidate.name == DOWNLOAD_FILENAME:
            continue
        thumbnail.convert_to_jpg(candidate, output_dir / thumbnail.THUMBNAIL_FILENAME)
        candidate.unlink(missing_ok=True)
