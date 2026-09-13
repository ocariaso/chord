# Analysis API

Chords and lyrics. Router:
[`server/app/api/routes_analysis.py`](../../server/app/api/routes_analysis.py), prefix `/jobs`,
tag `analysis`.

## `GET /jobs/{job_id}/chords`

**Response** — `200`, `ChordSegment[]`. `404` *"Chord analysis not available"* when
`analysis/chords.json` doesn't exist — which is also the answer for a job id that doesn't exist.

```json
[
  { "start": 0.0,  "end": 2.34, "chord": "N",   "confidence": 1.0 },
  { "start": 2.34, "end": 4.68, "chord": "C",   "confidence": 1.0 },
  { "start": 4.68, "end": 7.02, "chord": "Am",  "confidence": 1.0 },
  { "start": 7.02, "end": 9.36, "chord": "F#m7","confidence": 1.0 }
]
```

- Segments are contiguous and ordered; `end` of one is `start` of the next.
- `chord` uses CHORD's own convention, normalized from madmom's `root:quality` labels: `C` for
  major, `Cm` for minor, `C7`/`Cmaj7` etc. for anything else, and **`N` for "no chord"**
  (silence or unpitched material). The UI shows *—* for `N` in the current-chord
  readout, leaves `N` segments of the strip unlabelled, and skips them in the list of upcoming
  chords.
- **Roots are always sharps.** madmom's flat spellings are converted on the way in, so expect
  `A#`, never `Bb`. See
  [why](../architecture/decisions.md#sharps-everywhere-normalized-at-the-boundary).
- **`confidence` is hardcoded to `1.0`** for every segment. The field crosses the wire but
  carries no information — the CRF decoder's per-segment likelihood is not extracted, and
  nothing in the UI reads it.

The handler reads the file and returns the parsed JSON directly; it does not consult the
database. A 404 is normal when `ENABLE_CHORD_DETECTION=false`. `ResultsScreen` treats *any* failure
of `getChords` — a 404 and a network error alike — as "no analysis": it sets the segments to
`null`, and [`ChordBar`](../../web/src/screens/results/ChordBar.tsx) shows *"No chord
analysis for this track."* where the strip would be.

See [../features/chords-and-key.md](../features/chords-and-key.md).

## `GET /jobs/{job_id}/lyrics`

**Response** — `200`, `LyricsResponse`. `404` *"No lyrics found"* or *"Job not found"*.

```json
{
  "synced": [
    { "time": 12.34, "text": "First line" },
    { "time": 16.78, "text": "Second line" }
  ],
  "plain": "First line\nSecond line\n…"
}
```

Either field may be `null`. `synced` times are seconds. Lyrics found by the lookup are
**offset-corrected** against the separated vocals stem; lyrics saved with
[`PUT`](#put-jobsjob_idlyrics) come back exactly as pasted.

This endpoint performs real work and an outbound network call — see
[why](../architecture/decisions.md#lyrics-are-fetched-by-the-api-not-the-pipeline). On first
request it:

1. Returns the cached `analysis/lyrics.json` if present, whether a lookup or a `PUT` wrote it —
   including translating a cached literal `null` into a 404, which is what stops a miss from
   re-querying on every mount.
2. Otherwise reads `original_filename`, `author` and `duration_seconds` from the row, derives
   `(track, artist)` candidates, and queries [lrclib.net](https://lrclib.net) — the precise
   `/get` endpoint first (needs a duration), then the fuzzy `/search`.
3. If synced lyrics came back and `stems/vocals.wav` exists, cross-correlates expected vs.
   measured vocal activity to find a constant time shift, and applies it clamped at zero.
4. Writes the result — or `null` — to `analysis/lyrics.json`.

**Latency on a cache miss is seconds**, spanning up to four sequential lrclib requests (10 s
timeout each) plus reading and analyzing the vocals WAV. The handler is a plain `def`, so FastAPI
runs it in its threadpool: a slow lookup holds up only its own request, not other requests or open
event streams. Every network failure degrades to "no lyrics" rather than an error. The cache has
no invalidation; only a `PUT` replaces it.

Client handling is the one place a 404 is mapped to a value rather than an exception — "no
lyrics" is a normal outcome:

```ts
export async function getLyrics(jobId: string): Promise<Lyrics | null> {
  const res = await fetch(`${API_BASE}/jobs/${jobId}/lyrics`);
  if (res.status === 404) return null;
  if (!res.ok) throw new ApiError(`Failed to fetch lyrics (${res.status})`, res.status);
  return res.json();
}
```

How [`ChordBar`](../../web/src/screens/results/ChordBar.tsx) shows each outcome:

| Outcome | Lyric row |
| --- | --- |
| request pending | *Looking for lyrics…* |
| `synced` lines | the line at the playhead, as plain text |
| only `plain` | *Found, not synced — no timing available.* with *Open lyric sheet*, which shows the text in a dialog |
| 404, or any other failure | *None found for this track.* with *Add lyrics manually*, which opens the paste dialog |

An instrumental — a near-silent vocals stem — gets the same row: the request is made and its
outcome shown like any other track's.

See [../features/lyrics.md](../features/lyrics.md) for the candidate-guessing rules, the LRC
parser and the offset algorithm's tuning constants.

## `PUT /jobs/{job_id}/lyrics`

Replace a job's lyrics with text a person pasted.

**Request** — `application/json`:

```json
{ "text": "[00:12.34] First line\n[00:16.78] Second line" }
```

**Response** — `200`, `LyricsResponse` — the stored result.

| Code | When |
| --- | --- |
| 404 | no such job — *"Job not found"* |
| 400 | `text` is empty or whitespace — *"Paste the lyrics before saving"* |
| 422 | `text` missing, or longer than 100 000 characters (`SaveLyricsRequest`'s `max_length`) |

```bash
curl -X PUT http://localhost:8080/api/jobs/<job_id>/lyrics \
     -H 'Content-Type: application/json' \
     -d '{"text":"[00:12.34] First line\n[00:16.78] Second line"}'
```

`lyrics.parse_lyrics_text` decides the shape:

| Pasted text | Stored result |
| --- | --- |
| at least one line starting with an LRC timestamp (`[mm:ss.xx]`) | `synced`: the timestamped lines, sorted by time; `plain`: their text joined by newlines |
| no timestamped lines | `synced: null`; `plain`: the text as pasted, trimmed |
| blank | nothing — the 400 above |

In the synced case, every line without a leading timestamp — LRC tags such as `[ar:…]` included —
is dropped from both fields. Only the first timestamp on a line is read; the rest of the line,
further timestamps and all, becomes its text.

The result is written to `analysis/lyrics.json`, creating `analysis/` if needed and **replacing
whatever was cached**, a cached `null` included; the next `GET` returns it. Timing is kept exactly
as pasted — no offset correction, since the person pasting chose that timing. The job's status
isn't checked, so any existing job accepts lyrics.

The web client calls it through `saveLyrics` from
[`LyricsDialog`](../../web/src/screens/results/LyricsDialog.tsx), which *Add lyrics manually* opens
when none were found; lyrics that were found can't be replaced from the UI. The dialog's Save button is
disabled while the text is blank, so the 400 is a backstop. Calling this endpoint directly replaces
the stored lyrics too, but a results page that is already open doesn't fetch lyrics again, and a job
can't be reopened once left.
