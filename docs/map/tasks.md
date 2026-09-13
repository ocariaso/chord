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

A stage writes the new column with `_update_job` in
[`pipeline.py`](../../server/app/pipeline/pipeline.py), which takes columns as keywords. If a
resumed job should start without it, clear it in `resume_job`'s `UPDATE` too.

**Adding or renaming a job status** — [`schemas.py`](../../server/app/models/schemas.py)'s
`JobStatus`, the `JobStatus` union in [`client.ts`](../../web/src/api/client.ts),
`processingStage` in [`design/stages.ts`](../../web/src/design/stages.ts), `renderJob` in
[`App.tsx`](../../web/src/App.tsx), and **both** `TERMINAL_STATUSES` sets
([`routes_jobs.py`](../../server/app/api/routes_jobs.py) and
[`useJobEvents.ts`](../../web/src/hooks/useJobEvents.ts)) if it's terminal. A status with its own
panel takes its words from `failureCopy` in [`design/copy.ts`](../../web/src/design/copy.ts).
`run_job` starts only on a `queued` row, so a status a job can be queued under needs its guard
changed too.

**Changing the Demucs model** — `demucs_model` in [`config.py`](../../server/app/core/config.py)
and the `DEMUCS_MODEL` build argument in [`server/Dockerfile`](../../server/Dockerfile), which
picks the weights baked into the image (a runtime-only override downloads on the first job),
`STEM_NAMES` in [`schemas.py`](../../server/app/models/schemas.py), and on the web the design's
stems: `STEM_KEYS`, the Tone pivots and `STEM_HUES` in [`design/stems.ts`](../../web/src/design/stems.ts), the
`StemKey` union in [`design/player.ts`](../../web/src/design/player.ts), `stemNames` and every
string that says *six* (`intro`) or lists the stems (`stemsHint`) in
[`design/copy.ts`](../../web/src/design/copy.ts), and a `--ch-<stem>` hue in
[`chord-theme.css`](../../web/src/styles/chord-theme.css) for any new stem name. **Only stems in
`STEM_KEYS` are loaded**, so a new stem left out of it is never played, shown or offered for single
download. Miss `STEM_NAMES` and the API advertises stems that don't exist, producing 404s.

---

## Pipeline and analysis

| Task | Files |
| --- | --- |
| Add a pipeline stage | [`pipeline/pipeline.py`](../../server/app/pipeline/pipeline.py) — its place in `run_job`, a `stage` name with an entry in `_STAGE_FAILURE_MESSAGES`, a progress step, and an `_is_superseded` checkpoint after it — plus a new leaf module in [`pipeline/`](../../server/app/pipeline/). Follow the leaf contract: no database access. For the screen: its label in `processingCopy.stages` ([`design/copy.ts`](../../web/src/design/copy.ts)), which is `PROCESSING_STAGES`, and its index in `processingStage` ([`design/stages.ts`](../../web/src/design/stages.ts)) |
| Change stage progress or messages | [`pipeline/pipeline.py`](../../server/app/pipeline/pipeline.py) — `_SEPARATION_PROGRESS` and the fixed steps are there. A stage message is also a label in `processingCopy.stages` ([`design/copy.ts`](../../web/src/design/copy.ts)), and `processingStage` recognises *Detecting tempo* only by it; rename both together |
| Change what a failure says | a `UserFacingError` subclass in [`pipeline/errors.py`](../../server/app/pipeline/errors.py) for a sentence written for the user (the exception it's raised `from` becomes the log), or `_STAGE_FAILURE_MESSAGES` in `pipeline.py` for everything unexpected. That sentence is the panel's body; its title — *Separation failed*, whichever stage failed — and its buttons are `failureCopy["job-error"]` in [`design/copy.ts`](../../web/src/design/copy.ts) |
| Change the track length limit | `max_duration_seconds` in [`core/config.py`](../../server/app/core/config.py) — and the *up to 12 minutes* hints (`dropHint`, `phoneDropHint`) in [`design/copy.ts`](../../web/src/design/copy.ts), which assume the default |
| Improve separation quality | [`pipeline/separation.py`](../../server/app/pipeline/separation.py) + the model checklist above |
| Change which sample rates survive separation | `_PRESERVED_SAMPLE_RATES` in [`pipeline/separation.py`](../../server/app/pipeline/separation.py), and the *44.1 / 48 kHz preserved* hint (`landingCopy.dropHint`) in [`design/copy.ts`](../../web/src/design/copy.ts) |
| Tune chord detection | [`pipeline/chords.py`](../../server/app/pipeline/chords.py) — `_madmom_label_to_chord`, `_FLAT_TO_SHARP`, `_resolve_relative_ambiguity` |
| Populate real chord confidence | [`pipeline/chords.py`](../../server/app/pipeline/chords.py) (currently hardcoded `1.0`), then a consumer in [`results/ChordBar.tsx`](../../web/src/screens/results/ChordBar.tsx) |
| Fix metronome phase alignment | [`pipeline/tempo.py`](../../server/app/pipeline/tempo.py) (return the first beat time — `beat_track`'s positions are currently discarded), a new column via the field checklist, then `scheduleClicksAhead` in [`playbackEngine.ts`](../../web/src/audio/playbackEngine.ts), which puts beat one at track time zero |
| Change lyrics matching | [`pipeline/lyrics.py`](../../server/app/pipeline/lyrics.py) — `guess_candidates`, `_TITLE_NOISE_RE`, `fetch_lyrics` |
| Tune lyrics offset correction | [`pipeline/lyrics.py`](../../server/app/pipeline/lyrics.py) — the four `_RMS_*` / `_MAX_OFFSET_SECONDS` / `_MIN_SCORE_IMPROVEMENT` constants |
| Change how pasted lyrics are read | `parse_lyrics_text` in [`pipeline/lyrics.py`](../../server/app/pipeline/lyrics.py) — LRC timestamps make them synced. The editor is [`results/LyricsDialog.tsx`](../../web/src/screens/results/LyricsDialog.tsx) |
| Support another audio format | `ALLOWED_UPLOAD_EXTENSIONS` in [`routes_jobs.py`](../../server/app/api/routes_jobs.py); `ACCEPTED_EXTENSIONS` and the `accept` attribute in [`LandingScreen.tsx`](../../web/src/screens/landing/LandingScreen.tsx), and the format copy (`dropHint`, `phoneDropHint`, `rejectedDropHint`, `rejectedBody`) in [`design/copy.ts`](../../web/src/design/copy.ts); the extension regex in `guess_candidates` ([`lyrics.py`](../../server/app/pipeline/lyrics.py)); and the title regex in [`results/ExportDialog.tsx`](../../web/src/screens/results/ExportDialog.tsx) |
| Add a URL source | usually nothing — yt-dlp handles it. Site-specific options go in [`pipeline/source.py`](../../server/app/pipeline/source.py) |
| Replace the worker with a real broker | [`pipeline/worker.py`](../../server/app/pipeline/worker.py) + `start_worker()` in [`main.py`](../../server/app/main.py). The leaf modules need no changes — that's why they take no database handles. Cancellation doesn't travel through the queue: a run polls its own row (`_is_superseded`) |

## API

| Task | Files |
| --- | --- |
| Add an endpoint | the matching router in [`api/`](../../server/app/api/) (jobs / stems / analysis), a `response_model` in [`schemas.py`](../../server/app/models/schemas.py), then a function or URL builder in [`client.ts`](../../web/src/api/client.ts). A handler that blocks — network, heavy file work — is a plain `def`, as `get_lyrics` and `download_stems` are |
| Change an error message | the `HTTPException(detail=...)` — `detail` reaches the user verbatim through `errorFrom` in [`client.ts`](../../web/src/api/client.ts). Pipeline failures are in the table above |
| Change SSE cadence or payload | `job_events` in [`routes_jobs.py`](../../server/app/api/routes_jobs.py); check the nginx SSE directives in [`nginx.conf`](../../web/nginx.conf) still apply. The reconnect policy is `MAX_RECONNECT_ATTEMPTS` and the backoff constants in [`useJobEvents.ts`](../../web/src/hooks/useJobEvents.ts) |
| Change the upload size limit | `client_max_body_size` in [`nginx.conf`](../../web/nginx.conf) — the server streams uploads to disk (`_save_upload` in [`routes_jobs.py`](../../server/app/api/routes_jobs.py)) and sets no limit of its own. The 413 sentence is in `createJob` ([`client.ts`](../../web/src/api/client.ts)) |
| Change what a resume reuses | `run_job` in [`pipeline.py`](../../server/app/pipeline/pipeline.py) — it keeps a downloaded `original.mp3` (with the title `_record_track_identity` saved) and complete stems. `resume_job` in [`routes_jobs.py`](../../server/app/api/routes_jobs.py) resets the row and bumps `attempt`, which is what makes the cancelled run's writes miss |
| Stream the zip instead of buffering | `download_stems` in [`routes_stems.py`](../../server/app/api/routes_stems.py); keep it a plain `def` |

## Playback

| Task | Files |
| --- | --- |
| Anything audible | [`audio/playbackEngine.ts`](../../web/src/audio/playbackEngine.ts) — it is the only audio truth |
| Add a transport control | `playbackEngine.ts` (the capability), [`results/ResultsScreen.tsx`](../../web/src/screens/results/ResultsScreen.tsx) (state + handler), then [`results/Transport.tsx`](../../web/src/screens/results/Transport.tsx) — its `.ch-transport`, and the compact `.ch-m-bar` if phones should get it (that bar carries only play, seek and *Click*) |
| Change mute/solo semantics | `applyGains()` and `isAudible()` in `playbackEngine.ts`, and `audible()` in [`design/player.ts`](../../web/src/design/player.ts), which mirrors them. The state label and panel classes in [`results/ConsoleStrip.tsx`](../../web/src/screens/results/ConsoleStrip.tsx), and the panel classes in [`results/AnalogModule.tsx`](../../web/src/screens/results/AnalogModule.tsx), show solo first instead ([State](../conventions/design.md#state)) — a soloed, muted strip reads *Soloed* |
| Change the metronome sound | `scheduleClick` in `playbackEngine.ts` |
| Route the metronome through master volume | the `PlaybackEngine` constructor — `metronomeGain` connects straight to `destination` |
| Change time-stretch quality | the constants at the top of [`audio/stretchProcessor.js`](../../web/src/audio/stretchProcessor.js) (`FRAME_SECONDS`, `SEEK_SECONDS`, `COARSE_STEP`). How far ahead audio is fed is `LOOKAHEAD_SECONDS` there and `STRETCH_BLOCK_SECONDS` in `playbackEngine.ts`. Keep `process()` free of allocations |
| Change the speed choices | `SPEED_OPTIONS` in [`results/Transport.tsx`](../../web/src/screens/results/Transport.tsx) |
| Add real pitch shifting | `playbackEngine.ts` and a worklet. [`transpose.ts`](../../web/src/utils/transpose.ts) only rewrites labels today, and the stretch worklet changes speed, not pitch |
| Reduce time-to-play | `load()` in `playbackEngine.ts` — every stem must download and decode before the results show, and it reports no progress, so the loading screen sits at 100% meanwhile |
| Change metering | the math in [`audio/meters.ts`](../../web/src/audio/meters.ts); the analyser taps and `readMeters` in `playbackEngine.ts`; then the displays — [`results/ConsoleView.tsx`](../../web/src/screens/results/ConsoleView.tsx), [`results/AnalogView.tsx`](../../web/src/screens/results/AnalogView.tsx) and the dial scales in [`results/OutputDial.tsx`](../../web/src/screens/results/OutputDial.tsx). The Console's meter scales are in [`design/player.ts`](../../web/src/design/player.ts) |
| Change a fader law | [`design/player.ts`](../../web/src/design/player.ts): `FADER_RANGE_DB` and `db()` for the stems — **and** `STEM_METER_SCALE` and the `0 / −12 / −24 / −∞` `TICKS` in [`results/ConsoleStrip.tsx`](../../web/src/screens/results/ConsoleStrip.tsx), which are spaced for a 36 dB range — or `MASTER_TICKS` for the master, which also drives `MASTER_METER_SCALE` and must match the `0 / −6 / −18 / −∞` `TICKS` in [`results/MasterStrip.tsx`](../../web/src/screens/results/MasterStrip.tsx) |

## UI

| Task | Files |
| --- | --- |
| Change screen flow | [`App.tsx`](../../web/src/App.tsx) — `renderJob` derives the screen from the job's status; there is no screen state |
| Change the copy on a screen | [`design/copy.ts`](../../web/src/design/copy.ts) — every rendered string, grouped by screen. Strings from the design template are verbatim and app-authored ones sit under their comment; see [../conventions/design.md](../conventions/design.md). The stage labels are also the server's stage messages, and some hints restate server settings — the length limit, the preserved sample rates, the accepted formats, the six stems |
| Change how a screen looks | its folder under [`web/src/screens/`](../../web/src/screens/) — `landing/`, `processing/`, `failure/` or `results/` — covering every state [Screens and their states](../conventions/design.md#screens-and-their-states) lists for it, composing the `ch-` classes with runtime values passed as `--v`, `--l`, `--p` and `--stem`. The rules are [../conventions/design.md](../conventions/design.md); `npm run lint` enforces what a script can see through [`scripts/check-design.mjs`](../../web/scripts/check-design.mjs) |
| Add playback state | `PlayerState` in [`design/player.ts`](../../web/src/design/player.ts), with an action in [`results/playerReducer.ts`](../../web/src/screens/results/playerReducer.ts), if the design's [state model](../conventions/design.md#state) has it; otherwise `useState` in [`results/ResultsScreen.tsx`](../../web/src/screens/results/ResultsScreen.tsx). Then `StemDisplay` / `StemControls` in [`results/types.ts`](../../web/src/screens/results/types.ts) if the views need it |
| Change the results layout | [`results/ResultsScreen.tsx`](../../web/src/screens/results/ResultsScreen.tsx) — the section order, and its loading / failed / ready phases |
| Change the phone layout | below 720px [`results/ResultsScreen.tsx`](../../web/src/screens/results/ResultsScreen.tsx) forces the Mixer and drops the tabs, [`results/Transport.tsx`](../../web/src/screens/results/Transport.tsx) renders its `compact` bar, and [`chord-theme.css`](../../web/src/styles/chord-theme.css) stacks the stem rows ([`results/MixerView.tsx`](../../web/src/screens/results/MixerView.tsx) hides the column labels, [`results/AnalysisBar.tsx`](../../web/src/screens/results/AnalysisBar.tsx) its dividers). The landing and processing screens branch inside [`LandingScreen.tsx`](../../web/src/screens/landing/LandingScreen.tsx) and [`ProcessingScreen.tsx`](../../web/src/screens/processing/ProcessingScreen.tsx). The rules are [Responsive](../conventions/design.md#responsive) |
| Change one results view | [`results/MixerView.tsx`](../../web/src/screens/results/MixerView.tsx) with [`StemRow.tsx`](../../web/src/screens/results/StemRow.tsx); [`ConsoleView.tsx`](../../web/src/screens/results/ConsoleView.tsx) with [`ConsoleStrip.tsx`](../../web/src/screens/results/ConsoleStrip.tsx) and [`MasterStrip.tsx`](../../web/src/screens/results/MasterStrip.tsx); or [`AnalogView.tsx`](../../web/src/screens/results/AnalogView.tsx) with [`AnalogModule.tsx`](../../web/src/screens/results/AnalogModule.tsx) and [`OutputDial.tsx`](../../web/src/screens/results/OutputDial.tsx) — they share only [`controls/`](../../web/src/components/controls/), `design/player.ts` and `results/types.ts` |
| Change the processing screen | [`processing/ProcessingScreen.tsx`](../../web/src/screens/processing/ProcessingScreen.tsx) — remember `ResultsScreen` reuses it for stem loading, which is what `loading` is for. The stage list is [`design/stages.ts`](../../web/src/design/stages.ts) |
| Change a failure panel | [`failure/FailurePanel.tsx`](../../web/src/screens/failure/FailurePanel.tsx) for the layout; [`App.tsx`](../../web/src/App.tsx) for job failures, lost connections and cancelled jobs; [`results/ResultsScreen.tsx`](../../web/src/screens/results/ResultsScreen.tsx) for stems that fail to load; `failureCopy` in [`design/copy.ts`](../../web/src/design/copy.ts) for the words |
| Change colors, type or spacing | the tokens in [`styles/nocturne.css`](../../web/src/styles/nocturne.css), which the `ch-` classes in [`styles/chord-theme.css`](../../web/src/styles/chord-theme.css) read. Both came from the design template and are owned here now: add a token rather than a literal, never edit them to fix one component ([Ground rules](../conventions/design.md#ground-rules)), and record a change in their entries in [web.md](web.md). A Tailwind class can't override either: they're unlayered. `check-design.mjs` fails lint on a new colour, an undefined token or class, or a spacing token written in px — see [../conventions/design.md](../conventions/design.md) |
| Change a stem's color | its `--ch-<stem>` in [`styles/chord-theme.css`](../../web/src/styles/chord-theme.css); `STEM_HUES` in [`design/stems.ts`](../../web/src/design/stems.ts) points each stem at it, and `check-design.mjs` fails a hue the stylesheet doesn't define |
| Change the mobile breakpoint | `PHONE_QUERY` in [`design/layout.ts`](../../web/src/design/layout.ts), the `max-[720px]:` utilities in [`App.tsx`](../../web/src/App.tsx), [`results/MixerView.tsx`](../../web/src/screens/results/MixerView.tsx) and [`results/AnalysisBar.tsx`](../../web/src/screens/results/AnalysisBar.tsx), and `@media (max-width: 720px)` in [`chord-theme.css`](../../web/src/styles/chord-theme.css) — all must agree |
| Add motion | there is none besides the playhead and the meters; follow [`results/ResultsScreen.tsx`](../../web/src/screens/results/ResultsScreen.tsx), which honors `prefers-reduced-motion` |
| Check a screen against the design | [Checking a UI change](../conventions/design.md#checking-a-ui-change), with the states each screen must render in [Screens and their states](../conventions/design.md#screens-and-their-states); the screens under [`web/src/screens/`](../../web/src/screens/) are the reference implementation |

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
| Vite dev proxy targets 8787; the server runs on 8000 | [../operations/local-development.md](../operations/local-development.md#the-vite-proxy-port-mismatch) |
| A restart orphans in-flight jobs, and nothing reaps them | [../data/retention.md](../data/retention.md#stale-rows) |
| *Discard* right after *Cancel* deletes the job directory while the cancelled run may still write into it | [../architecture/job-lifecycle.md](../architecture/job-lifecycle.md) |
| A resume re-separates from scratch unless all six stems were written | [../features/stem-separation.md](../features/stem-separation.md) |
| Stems are always 16-bit WAV, whatever the source's depth | [../features/stem-separation.md](../features/stem-separation.md) |
| A link whose metadata has no duration downloads in full before the length limit refuses it | [../features/ingest.md](../features/ingest.md) |
| `stems_model` is declared everywhere and never written | [../data/schema.md](../data/schema.md#field-notes) |
| `key.json` is written but no endpoint serves it | [../features/chords-and-key.md](../features/chords-and-key.md#outputs-and-where-each-one-goes) |
| `ChordSegment.confidence` is hardcoded to `1.0` | [../api/analysis.md](../api/analysis.md#get-jobsjob_idchords) |
| `stem_names` reports a constant, not the real directory | [../api/jobs.md](../api/jobs.md#jobresponse) |
| Pasted LRC with `[offset:]` tags, several timestamps on a line, or untimed lines mixed in loses lines | [../features/lyrics.md](../features/lyrics.md) |
| Speed control needs `AudioWorklet`, which browsers expose only to secure origins — over plain HTTP to anything but `localhost`, the speed chip is disabled | [../features/speed-and-loop.md](../features/speed-and-loop.md) |
| `ResultsScreen` dispatches the playhead time into its `PlayerState` every frame, so the whole results screen re-renders every frame while playing | [../features/results-views.md](../features/results-views.md) |
| No tests, no CI | [../architecture/README.md](../architecture/README.md#where-things-are-not) |
