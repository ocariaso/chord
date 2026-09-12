# Task router

"I want to change X" → the files involved, in the order you'd touch them. Start here rather than
searching.

## Cross-cutting rules

Three changes have a fixed, easy-to-miss checklist:

**Adding a field to the job payload** — five places, or it silently doesn't appear:

1. `SCHEMA` in [`server/app/db/database.py`](../../server/app/db/database.py) — fresh databases
2. `MIGRATED_COLUMNS`, same file — existing databases
3. `JobResponse` in [`server/app/models/schemas.py`](../../server/app/models/schemas.py)
4. `_row_to_response()` in [`server/app/api/routes_jobs.py`](../../server/app/api/routes_jobs.py)
   — it maps columns **explicitly**, so a new column is invisible until added here
5. `Job` in [`web/src/api/client.ts`](../../web/src/api/client.ts)

**Adding or renaming a job status** — [`schemas.py`](../../server/app/models/schemas.py)'s
`JobStatus`, the `JobStatus` union in [`client.ts`](../../web/src/api/client.ts),
`STAGE_LABELS` in [`ProcessingScreen.tsx`](../../web/src/components/ProcessingScreen.tsx), and
**both** `TERMINAL_STATUSES` sets ([`routes_jobs.py`](../../server/app/api/routes_jobs.py) and
[`useJobEvents.ts`](../../web/src/hooks/useJobEvents.ts)) if it's terminal.

**Changing the Demucs model** — `DEMUCS_MODEL` in
[`config.py`](../../server/app/core/config.py), `STEM_NAMES` in
[`schemas.py`](../../server/app/models/schemas.py), `SIMPLE_STEM_ORDER` in
[`StemMixer.tsx`](../../web/src/components/StemMixer.tsx), `STEM_ORDER` **and**
`AMP_COMPONENTS` in [`ampComponents.ts`](../../web/src/components/studio/ampComponents.ts).
Miss `STEM_NAMES` and the API advertises stems that don't exist, producing 404s.

---

## Pipeline and analysis

| Task | Files |
| --- | --- |
| Add a pipeline stage | [`pipeline/pipeline.py`](../../server/app/pipeline/pipeline.py) (stage order, progress ladder, a `_is_cancelled` checkpoint) + a new leaf module in [`pipeline/`](../../server/app/pipeline/). Follow the leaf contract: no database access. |
| Change stage progress or messages | [`pipeline/pipeline.py`](../../server/app/pipeline/pipeline.py) only — the ladder is hardcoded there |
| Improve separation quality | [`pipeline/separation.py`](../../server/app/pipeline/separation.py) + the model checklist above |
| Tune chord detection | [`pipeline/chords.py`](../../server/app/pipeline/chords.py) — `_madmom_label_to_chord`, `_FLAT_TO_SHARP`, `_resolve_relative_ambiguity` |
| Populate real chord confidence | [`pipeline/chords.py`](../../server/app/pipeline/chords.py) (currently hardcoded `1.0`), then a consumer in [`ChordTimeline.tsx`](../../web/src/components/ChordTimeline.tsx) |
| Fix metronome phase alignment | [`pipeline/tempo.py`](../../server/app/pipeline/tempo.py) (return the first beat time — `beat_track`'s positions are currently discarded), a new column via the field checklist, then `scheduleMetronomeClicks` in [`playbackEngine.ts`](../../web/src/audio/playbackEngine.ts) |
| Change lyrics matching | [`pipeline/lyrics.py`](../../server/app/pipeline/lyrics.py) — `guess_candidates`, `_TITLE_NOISE_RE`, `fetch_lyrics` |
| Tune lyrics offset correction | [`pipeline/lyrics.py`](../../server/app/pipeline/lyrics.py) — the four `_RMS_*` / `_MAX_OFFSET_SECONDS` / `_MIN_SCORE_IMPROVEMENT` constants |
| Support another audio format | `ALLOWED_UPLOAD_EXTENSIONS` in [`routes_jobs.py`](../../server/app/api/routes_jobs.py), the `accept` attribute in [`UploadPanel.tsx`](../../web/src/components/UploadPanel.tsx), the extension regex in `guess_candidates` ([`lyrics.py`](../../server/app/pipeline/lyrics.py)), and `handleDownloadAll`'s regex in [`StemMixer.tsx`](../../web/src/components/StemMixer.tsx) |
| Add a URL source | usually nothing — yt-dlp handles it. Site-specific options go in [`pipeline/source.py`](../../server/app/pipeline/source.py) |
| Replace the worker with a real broker | [`pipeline/worker.py`](../../server/app/pipeline/worker.py) + `start_worker()` in [`main.py`](../../server/app/main.py). The leaf modules need no changes — that's why they take no database handles. |

## API

| Task | Files |
| --- | --- |
| Add an endpoint | the matching router in [`api/`](../../server/app/api/) (jobs / stems / analysis), a `response_model` in [`schemas.py`](../../server/app/models/schemas.py), then a function or URL builder in [`client.ts`](../../web/src/api/client.ts) |
| Change an error message | the `HTTPException(detail=...)` — `detail` reaches the user verbatim through the client |
| Change SSE cadence or payload | `job_events` in [`routes_jobs.py`](../../server/app/api/routes_jobs.py); check the nginx SSE directives in [`nginx.conf`](../../web/nginx.conf) still apply |
| Add SSE reconnection | [`useJobEvents.ts`](../../web/src/hooks/useJobEvents.ts) `onerror` (currently closes and gives up), plus `id:`/`retry:` fields in the server generator |
| Raise the upload size limit | `client_max_body_size` in [`nginx.conf`](../../web/nginx.conf) — **and** consider streaming instead of `await file.read()` in [`routes_jobs.py`](../../server/app/api/routes_jobs.py) |
| Stream the zip instead of buffering | `download_stems` in [`routes_stems.py`](../../server/app/api/routes_stems.py); keep it a plain `def` |

## Playback

| Task | Files |
| --- | --- |
| Anything audible | [`audio/playbackEngine.ts`](../../web/src/audio/playbackEngine.ts) — it is the only audio truth |
| Add a transport control | `playbackEngine.ts` (the capability), [`StemMixer.tsx`](../../web/src/components/StemMixer.tsx) (state + handler), then [`TransportBar.tsx`](../../web/src/components/TransportBar.tsx) **and** [`MasterUnit.tsx`](../../web/src/components/studio/MasterUnit.tsx) — both views need it |
| Change mute/solo semantics | `applyGains()` in `playbackEngine.ts` |
| Change the metronome sound | `scheduleClick` in `playbackEngine.ts` |
| Route the metronome through master volume | `playbackEngine.ts` constructor — `metronomeGain` currently connects straight to `destination` |
| Add real pitch shifting | `playbackEngine.ts`, an `AudioWorklet` or offline render. Note [`transpose.ts`](../../web/src/utils/transpose.ts) only rewrites labels today |
| Reduce time-to-play | `load()` in `playbackEngine.ts` — currently all six stems must fully decode first |

## UI

| Task | Files |
| --- | --- |
| Change screen flow | [`App.tsx`](../../web/src/App.tsx) — the whole router is one `useState` |
| Add playback state | [`StemMixer.tsx`](../../web/src/components/StemMixer.tsx), then thread it into both views' props |
| Simple view layout | [`StemMixer.tsx`](../../web/src/components/StemMixer.tsx) (`simpleView`), [`ChordTimeline.tsx`](../../web/src/components/ChordTimeline.tsx), [`StemChannel.tsx`](../../web/src/components/StemChannel.tsx), [`TransportBar.tsx`](../../web/src/components/TransportBar.tsx) |
| Studio view layout | [`studio/StudioMixer.tsx`](../../web/src/components/studio/StudioMixer.tsx), [`studio/constants.ts`](../../web/src/components/studio/constants.ts) (geometry is derived — change a constant, not a literal) |
| Restyle one instrument | that amp in [`studio/amps/`](../../web/src/components/studio/amps/) only — they're deliberately independent |
| Add a new amp design | a component in `studio/amps/` implementing `AmpProps`, registered in [`ampComponents.ts`](../../web/src/components/studio/ampComponents.ts) |
| Change the processing screen | [`ProcessingScreen.tsx`](../../web/src/components/ProcessingScreen.tsx) — remember `StemMixer` reuses it for stem loading, which is what `onCancel` is for |
| Change accent colors | [`useDominantColor.ts`](../../web/src/hooks/useDominantColor.ts) (`toAccentColor` clamps, `DEFAULT_ACCENT_COLORS`), and `cardBg`/`cardBorder` in `StemMixer.tsx` |
| Pass a color into an imperative library | add an explicit sync effect — see the `progressColor` one in [`StemChannel.tsx`](../../web/src/components/StemChannel.tsx); the accent resolves **after** first paint |
| Change the mobile breakpoint | the `useMediaQuery` calls in [`StemMixer.tsx`](../../web/src/components/StemMixer.tsx) and [`studio/StudioMixer.tsx`](../../web/src/components/studio/StudioMixer.tsx) — both must agree |
| Add an animation | [`index.css`](../../web/src/index.css) keyframes; pass measured pixel values as CSS custom properties |

## Data and operations

| Task | Files |
| --- | --- |
| Add/modify a column | the field checklist above. Note: additive only — no renames, drops or rollbacks |
| Add a setting | [`core/config.py`](../../server/app/core/config.py) — it becomes an environment variable automatically. Document it in [../operations/configuration.md](../operations/configuration.md) |
| Add job retention / a library | stop the beacon in [`useJobEvents.ts`](../../web/src/hooks/useJobEvents.ts), surface `GET /jobs` in the UI, **and add a reaper** — see [../data/retention.md](../data/retention.md#if-retention-were-wanted) |
| Change the published port | `PORT` in the environment; nothing in either container knows about it |
| Change container/image names | [`docker-compose.yml`](../../docker-compose.yml), and the proxy target `http://server:8000/` in [`nginx.conf`](../../web/nginx.conf) if the **service** name changes |
| Fix the dev proxy port | `target` in [`vite.config.ts`](../../web/vite.config.ts) — see [../operations/local-development.md](../operations/local-development.md#the-vite-proxy-port-mismatch) |
| Add a system dependency | [`server/Dockerfile`](../../server/Dockerfile)'s `apt-get` line, and note it in [../operations/local-development.md](../operations/local-development.md) for non-Docker users |
| Fix a new madmom incompatibility | [`server/scripts/patch_madmom.sh`](../../server/scripts/patch_madmom.sh) |

## Known issues worth picking up

Each is documented where it lives, not just listed here:

| Issue | Where |
| --- | --- |
| `handleDownloadAll` strips only `.mp3`, so FLAC zips are named `song.flac_stems.zip` | [../features/downloads.md](../features/downloads.md#call-sites) |
| Vite dev proxy targets 8787; the server runs on 8000 | [../operations/local-development.md](../operations/local-development.md#the-vite-proxy-port-mismatch) |
| nginx's 1 MB `client_max_body_size` rejects real uploads | [../operations/troubleshooting.md](../operations/troubleshooting.md#uploads-fail-with-413) |
| SSE never reconnects; a blip freezes the UI permanently | [../architecture/web.md](../architecture/web.md#subscription-and-cleanup) |
| A restart orphans in-flight jobs, and nothing reaps them | [../data/retention.md](../data/retention.md#stale-rows) |
| `stems_model` is declared everywhere and never written | [../data/schema.md](../data/schema.md#field-notes) |
| `key.json` is written but no endpoint serves it | [../features/chords-and-key.md](../features/chords-and-key.md#outputs-and-where-each-one-goes) |
| `ChordSegment.confidence` is hardcoded to `1.0` | [../api/analysis.md](../api/analysis.md#get-jobsjob_idchords) |
| `stem_names` reports a constant, not the real directory | [../api/jobs.md](../api/jobs.md#jobresponse) |
| `MIN_TRANSPOSE`/`MAX_TRANSPOSE`/`formatTranspose` duplicated across two components | [map: web.md](web.md) |
| No tests, no CI | [../architecture/README.md](../architecture/README.md#where-things-are-not) |
