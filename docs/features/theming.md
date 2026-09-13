# Theming from cover art

Every song gives the mixer its own two-color accent, sampled from the track's artwork. It is
the reason the UI feels different per song, and the reason a few components need an explicit
"color arrived late" update path.

## Getting the image

`thumbnail.jpg` in the job directory, produced by one of two routes — both of which shell out
to ffmpeg via [`thumbnail.py`](../../server/app/pipeline/thumbnail.py):

- **Uploads** — `extract_embedded_cover()` pulls an ID3 `APIC` frame out of the audio file:
  `ffmpeg -y -i <audio> -an -vcodec mjpeg -frames:v 1 thumbnail.jpg`. Cover art is carried as a
  video stream in the container, so `-an` drops audio and `-frames:v 1` takes the single frame.
- **URL jobs** — yt-dlp's `writethumbnail` saves the source's artwork, then
  `_normalize_downloaded_thumbnail()` in [`source.py`](../../server/app/pipeline/source.py)
  converts whatever format it landed in (`.webp`, `.png`, `.jpg`) to a plain JPEG with
  `convert_to_jpg()`. This matters because yt-dlp names it `original.<ext>` — the same stem as
  the audio — so it must be renamed before anything globs the directory.

`run_job` only extracts an embedded cover **if `thumbnail.jpg` doesn't already exist**, so the
yt-dlp artwork wins for URL jobs and the ID3 frame is the upload path.

Both helpers funnel through `_run_ffmpeg`, which treats every failure as "no thumbnail":

```python
try:
    result = subprocess.run([...], capture_output=True, timeout=30)
except (OSError, subprocess.TimeoutExpired) as exc:
    logger.warning(...); return False
return result.returncode == 0 and output_path.exists() and output_path.stat().st_size > 0
```

The size check matters — ffmpeg can exit 0 having written a zero-byte file when there's no
cover art to extract.

## Reporting it

`has_thumbnail` is not a column. `_row_to_response` in
[`routes_jobs.py`](../../server/app/api/routes_jobs.py) does a filesystem check on every
serialization:

```python
has_thumbnail = (job_dir(row["id"]) / THUMBNAIL_FILENAME).exists()
```

That's one `stat` per response — including every 0.5 s SSE tick. Cheap, and it means the flag
can never disagree with the disk.

Served by `GET /jobs/{job_id}/thumbnail.jpg`, a plain `FileResponse` with `media_type="image/jpeg"`,
404 when absent.

## Sampling two accent colors

[`useDominantColors(imageUrl)`](../../web/src/hooks/useDominantColor.ts) runs a small clustering
pass entirely in the browser:

1. Load the image with `crossOrigin = "anonymous"`.
2. Draw it into a **32×32** canvas — a deliberate downsample to 1024 pixels, which is what makes
   the rest cheap enough to run synchronously inside `onload`.
3. `getImageData` → an array of `[r, g, b]` triples (alpha ignored).
4. `twoDominantColors(pixels)` — a hand-rolled 2-means:
   - Seed `c1` at the first pixel and `c2` at the pixel furthest from it (max squared distance),
     so the two seeds start maximally separated rather than randomly.
   - Six fixed Lloyd iterations: assign each pixel to the nearer centroid, recompute centroids
     as the mean of their members.
   - Count final membership and return the **larger** cluster as `primary`.
5. `toAccentColor(r, g, b)` converts to HSL and forces legibility:
   - **hue** kept as sampled,
   - **saturation** clamped to `[0.5, 0.85]` — greys become colorful, neons calm down,
   - **lightness** pinned to a constant `42`.

   Lightness is *discarded*, not clamped. Album art of any brightness produces a mid-dark fill
   that always carries white text at an acceptable contrast. It's why the accent can't produce an
   unreadable button.

Returned as `{primary, secondary}`, each `{h, s, l, css}` — the `css` string is a ready-to-use
`hsl(...)`, and the separate components exist for the many places that compose a gradient with
their own alpha, e.g.

```tsx
`radial-gradient(ellipse 90% 70% at 50% 0%, hsl(${p.h}, ${p.s}%, ${p.l}%, 0.24), transparent 80%)`
```

### Failure handling

- No `imageUrl` (no thumbnail) → returns `null`.
- `img.onerror` → `null`.
- A tainted canvas — a cross-origin image without CORS headers makes `getImageData` throw — is
  caught and ignored, leaving the previous value. Same-origin in practice, since the thumbnail is
  served through the app's own `/api`.

Consumers coalesce to the app's own blue:

```tsx
const dominantColors = useDominantColors(job.has_thumbnail ? thumbnailUrl(job.id) : null)
                       ?? DEFAULT_ACCENT_COLORS;
```

`DEFAULT_ACCENT_COLORS` is `hsl(198, 54%, 41%)` / `hsl(198, 54%, 58%)` — the same hue family as
the brand `#307E9F` hardcoded in [`UploadPanel.tsx`](../../web/src/components/UploadPanel.tsx),
which has no job and therefore no thumbnail to sample.

## Where the colors land

`StemMixer` derives two composite surface tokens from the secondary color and threads them down
as `cardBg` / `cardBorder`:

```tsx
const cardBg     = `color-mix(in srgb, ${secondaryColor} 10%, #171717)`;
const cardBorder = `color-mix(in srgb, ${secondaryColor} 35%, transparent)`;
```

A 10% tint over the standard dark base, so stem rows, the chord timeline and the transport bar
all read as one palette rather than as separately-colored widgets. Borders are applied as
`boxShadow: "inset 0 0 0 1px ..."` so they don't change layout size.

| Consumer | Uses |
| --- | --- |
| `StemMixer` header | thumbnail as a background image, with a radial secondary glow and a dark gradient scrim for text legibility |
| Page background | fixed full-viewport radial gradient in the primary hue |
| `ChordTimeline` | active segment fill, metronome toggle, volume slider `accentColor`, lyric line color |
| `TransportBar` | play button fill, range `accentColor` |
| `StemChannel` | WaveSurfer `progressColor`, solo button fill, card surfaces |
| `ProcessingScreen` | the pulsing ring, progress bar, buttons — it samples the thumbnail itself, so the theme is live *during* processing |
| `MasterUnit` | the Simple/Studio LED; most Studio chrome is its own fixed palette |

Note the Studio view is mostly **not** themed — its walnut/brass/LCD palette is hardcoded in
`StudioCabinet` and each amp, because the point of that view is being specific gear rather than
matching the artwork.

## The late-color problem

Sampling completes only after the image loads, which is after first paint. Anything that
*captures* a color at construction time will hold a stale one. WaveSurfer is the case that
actually bites, and [`StemChannel.tsx`](../../web/src/components/StemChannel.tsx) fixes it with a
dedicated effect:

```tsx
// The accent color resolves asynchronously (sampled from the thumbnail after it loads), so keep
// the already-created instance's progress color in sync instead of only setting it at creation.
useEffect(() => {
  waveSurferRef.current?.setOptions({ progressColor: accentColor });
}, [accentColor]);
```

Recreating the instance on a color change would be correct but would flicker the waveform —
which is exactly why the creating effect depends on `[buffer]` alone with the exhaustive-deps
rule disabled. Any future component that passes a color into an imperative library needs the
same treatment.
