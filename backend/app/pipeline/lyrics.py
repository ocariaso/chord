import logging
import re
from pathlib import Path

import httpx
import numpy as np
import soundfile as sf

logger = logging.getLogger(__name__)

_RMS_HOP_SECONDS = 0.25
_RMS_ACTIVITY_RATIO = 0.12
_MAX_OFFSET_SECONDS = 30
_MIN_SCORE_IMPROVEMENT = 1.15

LRCLIB_BASE = "https://lrclib.net/api"

_LRC_LINE_RE = re.compile(r"\[(\d+):(\d+(?:\.\d+)?)](.*)")

_TITLE_NOISE_RE = re.compile(
    r"[\(\[]\s*(official\s+)?(music\s+)?(lyric[s]?\s+)?video\s*[\)\]]"
    r"|[\(\[]\s*official\s+audio\s*[\)\]]"
    r"|[\(\[]\s*(audio|hd|4k|visualizer)\s*[\)\]]",
    re.IGNORECASE,
)


def guess_candidates(original_filename: str, author: str | None) -> list[tuple[str, str | None]]:
    """Returns (track, artist) candidates to try against the lyrics database, best guess first."""
    title = re.sub(r"\.mp3$", "", original_filename, flags=re.IGNORECASE)
    title = _TITLE_NOISE_RE.sub("", title).strip(" -")

    candidates = [(title, author)]

    if " - " in title:
        maybe_artist, _, rest = title.partition(" - ")
        if maybe_artist.strip() and rest.strip():
            candidates.append((rest.strip(), maybe_artist.strip()))

    return candidates


def _parse_synced_lyrics(raw: str) -> list[dict]:
    lines = []
    for line in raw.splitlines():
        match = _LRC_LINE_RE.match(line.strip())
        if not match:
            continue
        minutes, seconds, text = match.groups()
        text = text.strip()
        if not text:
            continue
        lines.append({"time": round(int(minutes) * 60 + float(seconds), 2), "text": text})
    lines.sort(key=lambda line: line["time"])
    return lines


def _vocal_activity(vocals_path: Path) -> np.ndarray | None:
    data, sr = sf.read(str(vocals_path), always_2d=False)
    if data.ndim > 1:
        data = data.mean(axis=1)
    win = int(sr * _RMS_HOP_SECONDS)
    n = (len(data) - win) // win if win > 0 else 0
    if n <= 0:
        return None
    rms = np.array([np.sqrt(np.mean(data[i * win:(i + 1) * win] ** 2)) for i in range(n)])
    if rms.max() <= 0:
        return None
    return (rms > rms.max() * _RMS_ACTIVITY_RATIO).astype(float)


def _expected_activity(lines: list[dict], n: int) -> np.ndarray:
    expected = np.zeros(n)
    for i, line in enumerate(lines):
        start = line["time"]
        end = lines[i + 1]["time"] if i + 1 < len(lines) else start + 5
        end = min(end, start + 6)
        s_idx, e_idx = int(start / _RMS_HOP_SECONDS), int(end / _RMS_HOP_SECONDS)
        expected[max(0, s_idx):min(n, e_idx)] = 1.0
    return expected


def estimate_lyrics_offset(vocals_path: Path, lines: list[dict]) -> float:
    """Finds the constant time shift that best lines up LRC timing with the vocals stem's
    actual energy, to correct for things like a YouTube video's intro the LRC doesn't have."""
    try:
        activity = _vocal_activity(vocals_path)
        if activity is None:
            return 0.0
        n = len(activity)
        expected = _expected_activity(lines, n)

        baseline = float(np.sum(expected * activity))
        max_lag = int(_MAX_OFFSET_SECONDS / _RMS_HOP_SECONDS)
        best_lag, best_score = 0, baseline
        for lag in range(-max_lag // 3, max_lag):
            a, b = (expected[: n - lag], activity[lag:]) if lag >= 0 else (expected[-lag:], activity[: n + lag])
            m = min(len(a), len(b))
            if m <= 0:
                continue
            score = float(np.sum(a[:m] * b[:m]))
            if score > best_score:
                best_score, best_lag = score, lag

        if best_score < baseline * _MIN_SCORE_IMPROVEMENT:
            return 0.0
        return round(best_lag * _RMS_HOP_SECONDS, 2)
    except Exception:
        logger.warning("Lyrics offset estimation failed", exc_info=True)
        return 0.0


def _to_result(data: dict) -> dict | None:
    synced_raw = data.get("syncedLyrics")
    plain = data.get("plainLyrics")
    if not synced_raw and not plain:
        return None
    return {"synced": _parse_synced_lyrics(synced_raw) if synced_raw else None, "plain": plain}


def fetch_lyrics(track_name: str, artist_name: str | None, duration_seconds: float | None) -> dict | None:
    """Looks up synced lyrics from lrclib.net, a free crowdsourced lyrics database (no API key)."""
    try:
        with httpx.Client(timeout=10.0) as client:
            if duration_seconds:
                params = {"track_name": track_name, "duration": round(duration_seconds)}
                if artist_name:
                    params["artist_name"] = artist_name
                resp = client.get(f"{LRCLIB_BASE}/get", params=params)
                if resp.status_code == 200:
                    return _to_result(resp.json())

            resp = client.get(
                f"{LRCLIB_BASE}/search",
                params={"track_name": track_name, "artist_name": artist_name or ""},
            )
            if resp.status_code != 200:
                return None
            candidates = resp.json()
            if not candidates:
                return None
            if duration_seconds:
                candidates.sort(key=lambda c: abs((c.get("duration") or 0) - duration_seconds))
            return _to_result(candidates[0])
    except httpx.HTTPError:
        logger.warning("Lyrics lookup failed for %r", track_name, exc_info=True)
        return None
