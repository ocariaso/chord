# Lyrics

Time-synced lyrics from [lrclib.net](https://lrclib.net), a free crowdsourced LRC database with
no API key, plus an offset correction that aligns them to the separated vocals stem.

This is the only feature fetched **on demand by an API handler** rather than produced by the
pipeline — see [why](../architecture/decisions.md#lyrics-are-fetched-by-the-api-not-the-pipeline).

## Request flow

`GET /jobs/{job_id}/lyrics`, handled by
[`routes_analysis.py`](../../server/app/api/routes_analysis.py):

```
analysis/lyrics.json exists?
   ├─ yes ─► contents === null ? → 404 "No lyrics found"
   │          otherwise         → return it
   └─ no  ─► read original_filename, author, duration_seconds from the row
             for each (track, artist) candidate:            ← guess_candidates
                 fetch_lyrics(track, artist, duration)      ← lrclib /get then /search
                 stop at the first hit
             if synced and vocals.wav exists:
                 estimate_lyrics_offset(vocals.wav, lines)  ← cross-correlate
                 shift every line["time"] by the offset
             write the result — or null — to analysis/lyrics.json
             null ? → 404 : return it
```

**Caching the `null` is the point.** A miss is written to disk as literal `null` so that the
next mount short-circuits to a 404 instead of re-querying lrclib. Without that, every remount
of the mixer would hit the network for a song that has no lyrics.

The cache has no invalidation: once written, that file is the answer for the life of the job.

## Guessing the track and artist

[`guess_candidates`](../../server/app/pipeline/lyrics.py) turns whatever `original_filename`
happens to be into ordered `(track, artist)` attempts.

1. Strip a trailing `.mp3` / `.flac`.
2. Strip YouTube-style title noise via `_TITLE_NOISE_RE` — bracketed
   `(Official Video)`, `(Official Music Video)`, `(Lyrics Video)`, `(Official Audio)`,
   `(Audio)`, `(HD)`, `(4K)`, `(Visualizer)`, case-insensitive — then `.strip(" -")`.
3. Candidate one: `(title, author)`, where `author` is the ID3 artist tag or the yt-dlp
   uploader.
4. Candidate two, only if the title contains `" - "`: split on the first occurrence and try
   `(rest, maybe_artist)` — i.e. treat `"Artist - Song"` as artist and song.

So `"Radiohead - Creep (Official Video).mp3"` yields
`[("Radiohead - Creep", <uploader>), ("Creep", "Radiohead")]`. The first candidate keeps the
uploader as artist because for a URL job the channel name is often right; the second is the
fallback that handles the common filename convention.

## Querying lrclib

[`fetch_lyrics`](../../server/app/pipeline/lyrics.py) tries the precise endpoint first, then the
fuzzy one:

- **`GET /api/get`** with `track_name`, rounded `duration`, and `artist_name` if known. Only
  attempted when `duration_seconds` is available. lrclib matches on duration, so this is the
  high-precision path — it's how you avoid a cover or a remix with the same title.
- **`GET /api/search`** with `track_name` and `artist_name` otherwise, or if `/get` missed.
  Results are sorted by `abs(candidate.duration - duration_seconds)` when a duration is known,
  and the closest is taken.

A response yields `{"synced": [...] | null, "plain": str | null}` via `_to_result`, or `None` if
it carries neither. Every `httpx.HTTPError` is caught, logged as a warning, and returns `None` —
a lrclib outage degrades to "no lyrics", never an error.

The 10 s timeout is per client, and the retry across candidates means a worst case of roughly
four sequential requests before giving up.

## LRC parsing

`_parse_synced_lyrics` matches `[mm:ss.xx] text` with
`re.compile(r"\[(\d+):(\d+(?:\.\d+)?)](.*)")`, converts to seconds
(`minutes * 60 + seconds`, rounded to 2 dp), drops lines whose text is empty (LRC files use
those as spacers), and sorts by time.

Unparseable lines — including LRC metadata tags like `[ar:...]` and `[by:...]`, which don't match
the numeric pattern — are skipped silently.

## Offset correction

The interesting part. An LRC file's timings are written against the *released* recording, but
the audio CHORD analyzed might be a YouTube upload with an intro, a different edit, or leading
silence. A constant offset makes synced lyrics useless.

`estimate_lyrics_offset(vocals_path, lines)` cross-correlates the LRC's *expected* vocal
activity against the *measured* activity of the separated vocals stem — a measurement only
possible because separation already happened.

```
vocals.wav ──► _vocal_activity ───► binary activity array, one bin per 0.25 s
                                     (RMS per bin > 12% of peak RMS → 1, else 0)

LRC lines ──► _expected_activity ──► binary array, 1 from each line's time until the
                                     next line (capped at 6 s, default 5 s for the last)

                        ▼
     for lag in range(-max_lag/3 … max_lag):     # max_lag = 30 s / 0.25 s = 120 bins
         score = sum(expected_shifted * activity)
     keep the best-scoring lag
                        ▼
     accept only if best_score >= baseline * 1.15    # 15% better than no shift
                        ▼
     offset = best_lag * 0.25    (rounded to 2 dp)
```

Tuning constants, all module-level in `lyrics.py`:

| Constant | Value | Role |
| --- | --- | --- |
| `_RMS_HOP_SECONDS` | `0.25` | activity bin size, and the offset's resolution |
| `_RMS_ACTIVITY_RATIO` | `0.12` | fraction of peak RMS counted as "singing" |
| `_MAX_OFFSET_SECONDS` | `30` | search window |
| `_MIN_SCORE_IMPROVEMENT` | `1.15` | required improvement over no shift |

The asymmetric search range (`-max_lag // 3` to `max_lag`, i.e. −10 s to +30 s) encodes the
expectation that the uploaded audio usually has *extra* material at the front rather than less.

The 1.15 threshold is what keeps a weak correlation from making things worse — if no lag beats
"leave it alone" by 15%, the function returns `0.0`. The whole thing is wrapped in a bare
`except Exception` that logs and returns `0.0`: a failed alignment must never fail the request.

Applied in the route, clamped so no line goes negative:

```python
line["time"] = round(max(0.0, line["time"] + offset), 2)
```

## Client side

[`useLyrics(jobId)`](../../web/src/hooks/useLyrics.ts) fetches once per job and returns a
three-state value, because the UI shows three different things:

| Value | Meaning | Displayed |
| --- | --- | --- |
| `undefined` | still loading | `"Looking for lyrics…"` |
| `null` | confirmed none (404, or an error) | `"No lyrics found"` |
| `Lyrics` | found | the current line |

`getLyrics` in [`client.ts`](../../web/src/api/client.ts) is the only API function that maps a
404 to a value rather than throwing — "this song has no lyrics" is a normal outcome.

[`utils/lyrics.ts`](../../web/src/utils/lyrics.ts) turns that into text, with two entry points:

- `lyricsDisplayLine(lyrics, currentTime)` — always returns a string, including the status
  messages above and `"Lyrics found (not synced)"` when only plain lyrics exist. Falls back to
  `"♪ ♪"` before the first timed line. Used by the Studio vocals amp.
- `currentLyricLine(lyrics, currentTime)` — returns the current line or `null`, with no status
  text. Used by the Simple view's chord timeline, which shouldn't show plumbing messages.

Both find the line with a linear scan that relies on the sorted order and breaks early:

```ts
for (const line of lines) {
  if (line.time <= currentTime) current = line.text;
  else break;
}
```

Called every animation frame. `O(n)` per frame on a few hundred lines with an early exit — fine,
but the obvious candidate if the render loop ever needs tightening.

**Both are gated on `hasVocals`** in `StemMixer`, so an instrumental — whose vocals stem is
near-silent rather than absent — shows no lyric line and no status message at all. Only the
Studio **vocals** amp receives a `lyricLine` prop; the other five amps never see one.

## Plain (unsynced) lyrics

If lrclib has only `plainLyrics`, the result carries `plain` with `synced: null`. The UI does
not render the text — it shows `"Lyrics found (not synced)"` and nothing else. The full plain
text crosses the wire and is cached but is currently unused by any view.
