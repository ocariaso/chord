# Theming

Every accent-family color in Nocturne — `--color-accent`, `--color-accent-2` and their 100–900
ramps — holds a fixed lightness and chroma per step, but reads its hue from one custom property,
`--accent-hue`. [`useAccentHue`](../../web/src/hooks/useAccentHue.ts) samples the job's cover art
once it exists and sets that property on `App`'s root div; with no thumbnail, no job, or a failed
sample, nothing is set and Nocturne's default (229.6°, the brand blue) applies. See
[A per-track accent hue](../architecture/decisions.md#a-per-track-accent-hue-driven-by-one-custom-property)
for the mechanism and its cost, and [ground rule 6](../conventions/design.md#ground-rules) for why
this is the one token family the design check lets a hook drive at runtime.

The standard is [../conventions/design.md](../conventions/design.md). The UI was built from a
design template, since removed; the two vendored stylesheets below came from it and are owned here
now.

## Three stylesheets

[`main.tsx`](../../web/src/main.tsx) imports, in order:

| Order | File | What it is |
| --- | --- | --- |
| 1 | [`styles/nocturne.css`](../../web/src/styles/nocturne.css) | Nocturne's token sheet and base components (`.btn`, `.input`, `.field`, `.dialog`, `.lighten`), vendored from the design template's Nocturne sheet with one change: its Google Fonts `@import` removed |
| 2 | [`styles/chord-theme.css`](../../web/src/styles/chord-theme.css) | the `ch-` component layer, vendored byte-for-byte from the design template |
| 3 | [`index.css`](../../web/src/index.css) | Tailwind, a full-height root, the page ground and button cursors — and no classes |

The `@import` had to go because a bundled `@import` that no longer opens its stylesheet is invalid;
[`index.html`](../../web/index.html) loads Inter 400/500/600 from Google Fonts instead. Nocturne's
font stacks fall back to `system-ui, sans-serif` when Inter can't load. The old display fonts are
gone with the Studio view.

**The vendored sheets win every conflict with Tailwind, whatever the import order.** Tailwind v4
places its preflight and utilities inside cascade layers, and both vendored sheets are unlayered —
and unlayered rules outrank layered ones. So a `ch-` or Nocturne rule beats a utility on the same
element, and Nocturne's element rules (heading margins, `img { display: block }`,
`:focus { outline: none }`) beat Tailwind's resets. That is why components set margins and layout on
styled elements with inline styles rather than utilities.

Both sheets are treated as vendored: the [ground rules](../conventions/design.md#ground-rules) are to retune a token in Nocturne rather
than add a colour to a component, and to compose existing classes rather than invent new ones.
`npm run lint` checks the part a script can see — a hex colour or colour function, an undefined
token or class, a class defined in app CSS — through
[`scripts/check-design.mjs`](../../web/scripts/check-design.mjs).

## The palette

Nocturne's `:root` tokens, a dark ground with a blue accent:

| Token | Value | Used for |
| --- | --- | --- |
| `--color-bg` | `#161826` | the screen card (`.ch-app`) |
| `--color-surface` | `#232532` | inputs and dialogs |
| `--color-text` | `#e9e9ed` | text |
| `--accent-hue` | `229.6` (default) | the one runtime input to the accent family below — set per job by `useAccentHue` |
| `--color-accent` | `oklch(56% 0.091 var(--accent-hue))` | primary actions, the current chord, progress, focus rings, the vocals stem |
| `--color-accent-100` … `900` | tonal ramp, same hue | tabs, chips, empty meter tracks, the cover tile |
| `--color-neutral-100` … `900` | tonal ramp | every grey, including the *other* stem |
| `--color-divider` | text at 16% | hairlines and fading rules |
| `--space-1` … `--space-8` | 2.8 px steps | spacing |
| `--radius-*`, `--shadow-*` | | shape and elevation |

The ramps are generated in OKLCH on one shared lightness scale, so the same step of the neutral and
accent ramps matches in visual value.

[`chord-theme.css`](../../web/src/styles/chord-theme.css) adds its own tokens on `:root`:

| Token | Value | Role |
| --- | --- | --- |
| `--ch-panel`, `--ch-panel-raised` | `#191b2a`, `#1d1f30` | strip and module panels; raised marks a soloed strip and the master strip |
| `--ch-well`, `--ch-well-deep` | `#131422`, `#0f101c` | recessed tracks such as the chord strip, fader tracks and knob caps |
| `--ch-chrome` | `#1a1c2c` | topbar and transport |
| `--ch-danger`, `--ch-warn` | `oklch(66% 0.16 25)`, `oklch(76% 0.13 85)` | status, used only as 7 px dots and hairlines — never as fills |

`index.css` paints the page with the canvas the template's harness drew, in tokens: a radial gradient from
`--ch-panel-raised` near the top left, through the cards' `--color-bg`, to `--ch-well`. It is sized
to one viewport, over an `html` background of `--ch-well`, so a page longer than the window carries
on in the colour the gradient ends at instead of showing a seam. The harness wrote the same
gradient in hex; each stop is within a few units of its token.

Status hues are deliberately small. The danger dot marks hard failures (a job error, a job not
found, stems that failed to load), every alert on the landing screen — a rejected file, or an upload
or link the server refused or never received — and a failed lyrics save, and the danger hue also
outlines a rejected dropzone; the warn dot marks *Connection lost*; *Cancelled* gets a neutral dot.
[`FailurePanel`](../../web/src/screens/failure/FailurePanel.tsx) never tints the panel itself.

## Stem hues

| Stem | Token | Value |
| --- | --- | --- |
| vocals | `--ch-vocals` | `var(--color-accent)` |
| drums | `--ch-drums` | `oklch(73% 0.09 30)` |
| bass | `--ch-bass` | `oklch(73% 0.09 150)` |
| guitar | `--ch-guitar` | `oklch(73% 0.09 75)` |
| piano | `--ch-piano` | `oklch(73% 0.09 235)` |
| other | `--ch-other` | `var(--color-neutral-600)` |

The four OKLCH hues share one lightness and one low chroma, so no instrument reads as louder than
another; vocals borrows the accent and *other* a neutral grey.

`stemHue(key)` in [`design/stems.ts`](../../web/src/design/stems.ts) returns `var(--ch-<key>)` for
one of the design's six stem keys — a stem outside them isn't loaded, so there is no fallback —
and a view sets it once, as `--stem`, on a stem row, strip, module or export row. Everything inside
inherits it: the dot, the fader fill, the meter bars, the waveform bars and the knob arc. Three
places override it: the small Tone and Pan knobs take `--color-neutral-700`, so only the Level knob
carries the stem's hue; the Console master meter takes `--color-accent`; and status dots reuse
`--stem` for a status hue.

## Runtime values

The component layer takes state through custom properties rather than inline geometry:

| Property | Range | Read by |
| --- | --- | --- |
| `--v` | 0…1 | `.ch-fader`, `.ch-vfader`, `.ch-knob`, `.ch-progress` |
| `--l` | 0…1 | `.ch-meter i`, written every frame by the [meters](metering.md) |
| `--p` | 0…1 | `.ch-playhead`, `.ch-seek` |
| `--stem` | a colour | anything inside a stem scope |

A control is therefore a class plus one variable, and the class turns that variable into a width, a
`left`, a rotation or a gradient stop. Components add Tailwind utilities and inline styles only for
layout, drawing on `var(--space-*)` and `var(--color-*)` tokens, and set no other custom property
inline — the design check flags one. Custom properties aren't interpolated, so controls follow the
pointer exactly, with no transition. The one runtime shape set inline is the waveform's `clip-path`,
because the envelope is data rather than a position.

The stylesheet has a single breakpoint, `max-width: 720px`; what changes there is in
[results views](results-views.md#below-720px).

## Cover art

Artwork is still extracted on the server and shown on two screens.

### Getting the image

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
yt-dlp artwork wins for URL jobs and the ID3 frame is the upload path. Extraction happens before the
audio is read and before separation.

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

### Reporting it

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

### Showing it

[`CoverArt.tsx`](../../web/src/components/CoverArt.tsx) draws a tile filled with
`linear-gradient(150deg, var(--color-accent-800), var(--color-accent-900))`, and when `has_thumbnail`
is true, the plain image on top — no blend. The art already drives the tile's own accent hue, so
tinting the art itself as well would be double theming.

| Where | Size | Corner radius | Hairline outline |
| --- | --- | --- | --- |
| results topbar, at every width | 44 px | 6 px | yes |
| processing screen | 56 px | 8 px | yes |
| processing screen, ≤720 px | 52 px | 8 px | no |

The outline is an inset `neutral-800` hairline on an overlay above the image. The image has an
empty `alt`, since the track title sits beside it.

Because `has_thumbnail` is recomputed for every job response, the processing screen switches from
the gradient tile's music-note mark to the artwork as soon as the file exists — after the download
for a link, before separation for an upload. If the image fails to load, `onError` hides it and the
music-note mark returns. The landing screen, the failure panels and the dialogs show no artwork.

## Known gaps

- `chord-theme.css`'s header comment is out of date twice over: it calls the stem hues "the only
  additions", though the same file hard-codes five surface colours and two status hues, and it
  places them "at the accent's lightness/chroma", though against Nocturne's current accent
  (L 0.660, C 0.125) they are lighter and less saturated.
- A Tailwind utility can't override a vendored rule, which surprises anyone who reaches for one.
- Inter is fetched from Google Fonts at runtime; offline, or where that host is blocked, the UI
  falls back to the system font.
