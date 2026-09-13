# Analysis API

Chords and lyrics. Router:
[`server/app/api/routes_analysis.py`](../../server/app/api/routes_analysis.py), prefix `/jobs`,
tag `analysis`.

## `GET /jobs/{job_id}/chords`

**Response** — `200`, `ChordSegment[]`. `404` *"Chord analysis not available"* when
`analysis/chords.json` doesn't exist.

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
  (silence or unpitched material). The UI renders `N` as a plain dash.
- **Roots are always sharps.** madmom's flat spellings are converted on the way in, so expect
  `A#`, never `Bb`.
- **`confidence` is hardcoded to `1.0`** for every segment. The field crosses the wire but
  carries no information — the CRF decoder's per-segment likelihood is not extracted, and
  nothing in the UI reads it.

The handler reads the file and returns the parsed JSON directly; it does not consult the
database. A 404 here is normal when `ENABLE_CHORD_DETECTION=false`, and the client treats it as
such — `getChords`'s `.catch` leaves `chordSegments` empty and `ChordTimeline` renders nothing.

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

Either field may be `null`. `synced` times are seconds, already **offset-corrected** against the
separated vocals stem.

This is the only endpoint that performs real work and an outbound network call — see
[why](../architecture/decisions.md#lyrics-are-fetched-by-the-api-not-the-pipeline). On first
request it:

1. Returns the cached `analysis/lyrics.json` if present — including translating a cached literal
   `null` into a 404, which is what stops a miss from re-querying on every mount.
2. Otherwise reads `original_filename`, `author` and `duration_seconds` from the row, derives
   `(track, artist)` candidates, and queries [lrclib.net](https://lrclib.net) — the precise
   `/get` endpoint first (needs a duration), then the fuzzy `/search`.
3. If synced lyrics came back and `stems/vocals.wav` exists, cross-correlates expected vs.
   measured vocal activity to find a constant time shift, and applies it clamped at zero.
4. Writes the result — or `null` — to `analysis/lyrics.json`.

**Latency on a cache miss is seconds**, spanning up to four sequential lrclib requests (10 s
timeout each) plus reading and analyzing the vocals WAV. Every network failure degrades to
"no lyrics" rather than an error. The cache has no invalidation.

If only `plainLyrics` came back, `synced` is `null` — the UI then shows
*"Lyrics found (not synced)"* and does not render the text, even though it crosses the wire.

Client handling is the one place a 404 is mapped to a value rather than an exception:

```ts
export async function getLyrics(jobId: string): Promise<Lyrics | null> {
  const res = await fetch(`${API_BASE}/jobs/${jobId}/lyrics`);
  if (res.status === 404) return null;      // "no lyrics" is a normal outcome
  if (!res.ok) throw new Error(`Failed to fetch lyrics (${res.status})`);
  return res.json();
}
```

See [../features/lyrics.md](../features/lyrics.md) for the candidate-guessing rules, the LRC
parser and the offset algorithm's tuning constants.
