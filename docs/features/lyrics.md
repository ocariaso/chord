# Lyrics

Time-synced lyrics from [lrclib.net](https://lrclib.net), a free crowdsourced LRC database with
no API key, plus an offset correction that aligns them to the separated vocals stem. When the lookup
finds nothing, the user can paste lyrics — plain or LRC — and they replace the lookup for that job.

This is the only feature fetched **on demand by an API handler** rather than produced by the
pipeline — see [why](../architecture/decisions.md#lyrics-are-fetched-by-the-api-not-the-pipeline).

## Request flow

`GET /jobs/{job_id}/lyrics`, handled by `get_lyrics` in
[`routes_analysis.py`](../../server/app/api/routes_analysis.py) — a plain `def`, so FastAPI runs it
in its threadpool, and a lookup that takes seconds holds up no other request or event stream:

```
analysis/lyrics.json exists?                                ← a lookup's result, or saved by hand
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

The lookup cache has no invalidation. The one thing that replaces it is
[saving lyrics by hand](#manual-entry), which overwrites the file — a cached `null` included.

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

`duration_seconds` is on the row from the start of separation, well before anyone can open the
results, so the precise path is available to every lookup.

## LRC parsing

`_parse_synced_lyrics` matches `[mm:ss.xx] text` with
`re.compile(r"\[(\d+):(\d+(?:\.\d+)?)](.*)")`, converts to seconds
(`minutes * 60 + seconds`, rounded to 2 dp), drops lines whose text is empty (LRC files use
those as spacers), and sorts by time. It parses lrclib's `syncedLyrics` and pasted text alike.

Unparseable lines — including LRC metadata tags like `[ar:...]` and `[by:...]`, which don't match
the numeric pattern — are skipped silently. Two consequences:

- `[offset:...]` is a metadata tag too, so an LRC file's own offset is **ignored**.
- A line carrying several timestamps (`[00:12.00][00:45.00]Chorus`) keeps only the first time,
  and the second timestamp stays in the text.

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

Offset correction runs only on the lookup path. Lyrics saved by hand are never shifted.

## Manual entry

`PUT /jobs/{job_id}/lyrics`, JSON body `{"text": "..."}`, handled by `save_lyrics` in
[`routes_analysis.py`](../../server/app/api/routes_analysis.py):

1. 404 *"Job not found"* when there is no such row. The job's status isn't checked.
2. `parse_lyrics_text(text)` in [`lyrics.py`](../../server/app/pipeline/lyrics.py) strips the text:
   - blank → `None` → 400 *"Paste the lyrics before saving"*;
   - any line with an LRC timestamp → `{"synced": <parsed lines>, "plain": <their text joined by newlines>}`;
   - otherwise → `{"synced": null, "plain": <the text>}`.
3. Writes the result to `analysis/lyrics.json`, creating `analysis/` if needed and replacing
   whatever was there.
4. Returns it as a `LyricsResponse`.

**No offset correction** is applied to pasted LRC. The person pasting chose that timing, so it is
kept exactly as given.

The synced rule is all-or-nothing: once any line has a timestamp, lines without one are dropped
entirely, and `plain` is rebuilt from the timed lines alone. `SaveLyricsRequest` caps the text at
100 000 characters; a longer paste fails FastAPI's validation with a 422 whose `detail` is a list,
which the client can't show, so the dialog reads *Failed to save lyrics (422)*.

## Client side

[`useLyrics(jobId)`](../../web/src/hooks/useLyrics.ts) fetches once per job — from the moment
`ResultsScreen` mounts, in parallel with the stem downloads — and returns `[lyrics, replaceLyrics]`.
The value has three states, because the UI shows three different things, and it is keyed by job id
so a new job reads as loading until its own lookup answers:

| Value | Meaning |
| --- | --- |
| `undefined` | still loading |
| `null` | confirmed none (a 404, or any error) |
| `Lyrics` | found, or saved by hand |

`replaceLyrics` takes the result of a save. `getLyrics` in
[`client.ts`](../../web/src/api/client.ts) is the only API function that maps a 404 to a value
rather than throwing — "this song has no lyrics" is a normal outcome.

### The lyric row

[`ChordBar.tsx`](../../web/src/screens/results/ChordBar.tsx) renders one row under the chord strip,
the same at every width. Its states and strings come from the design template:

| Lyrics | Label | Shows |
| --- | --- | --- |
| `undefined` | Lyrics | *Looking for lyrics…* |
| synced, at least one line | Lyric | the current line as plain text; before the first timed line, the first line, dimmed |
| plain only | Lyrics | *Found, not synced — no timing available.* and **Open lyric sheet** |
| `null` | Lyrics | *None found for this track.* and **Add lyrics manually** |

`currentLineIndex(lines, time)` in [`utils/lyrics.ts`](../../web/src/utils/lyrics.ts) finds the line
with a linear scan that relies on the sorted order and breaks early, returning −1 before the first
line:

```ts
for (let i = 0; i < lines.length; i++) {
  if (lines[i].time <= currentTime) index = i;
  else break;
}
```

It runs every frame while playing. `O(n)` per frame on a few hundred lines with an early exit —
fine, but the obvious candidate if the render loop ever needs tightening.

**The row renders for every track, instrumentals included.** Judging a vocals stem silent mutes it
and leaves the lyric row alone: an instrumental shows whatever the lookup found — usually *None
found for this track.* with *Add lyrics manually* — like any other song. Under the row, the hint
*No vocal content detected — the vocals stem is present but silent.* is added; it sits in the
chords and lyrics section rather than in a view so Mixer, Console and Analog all show it.

### The lyric sheet and manual entry

[`LyricsDialog.tsx`](../../web/src/screens/results/LyricsDialog.tsx) has two modes, both on the
shared [dialog](results-views.md#dialogs) at 560 px wide, and each opens from exactly one row state:

| Mode | Opened by | Content | Actions |
| --- | --- | --- | --- |
| *Lyric sheet* | **Open lyric sheet**, on the plain-only row | the plain lyrics with their line breaks, scrolling past 60% of the viewport's height | *Close* |
| *Add lyrics* | **Add lyrics manually**, on the none-found row | an empty, focused textarea and the hint *Paste plain lyrics, or LRC lines such as [01:24.50] to sync them to the track.* | *Cancel*, *Save lyrics* (disabled while saving or while the text is blank) |

*Save lyrics* sends the text to `PUT /jobs/{job_id}/lyrics` through `saveLyrics`. On success,
`ResultsScreen` stores the result with `replaceLyrics` and closes the dialog, so the row changes
state at once — pasted plain text gives the sheet button, pasted LRC the synced line. On failure the
dialog stays open with a *Lyrics weren't saved* alert carrying the server's message.

Plain lyrics were fetched and cached before this dialog existed but never shown; the sheet is now
where they appear. Synced lyrics have no sheet: their text shows one line at a time, in the row.

## Known gaps

- Lyrics can't be replaced once there are some. *Add lyrics manually* is offered only when none
  were found, so wrong timing, a wrong match or a mistake in a paste can't be corrected from the
  page — only by a `PUT` from outside it, which an open results screen doesn't fetch again.
- Synced lyrics can't be read as a sheet; the sheet opens only for plain lyrics.
- An LRC file's `[offset:]` tag is ignored, and lines with several timestamps keep the extras in
  their text.
- A paste mixing timed and untimed lines silently loses the untimed ones.
- One line at a time; no word-level timing.
