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
([`schemas.py`](../../server/app/models/schemas.py) and
[`useJobEvents.ts`](../../web/src/hooks/useJobEvents.ts)) if it's terminal — the server's set also
decides which jobs the reaper may delete. A status with its own
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
download. Miss `STEM_NAMES` and the API advertises stems that don't exist, producing 404s. On a GPU
the model also decides how fast it runs: only an `HTDemucs` gets half precision and the recorded
CUDA graph in [`separation.py`](../../server/app/pipeline/separation.py), both checked against
`htdemucs_6s` alone, and any other architecture runs directly in float32 — read the start-up log
lines after a change of model.

---

## Pipeline and analysis

| Task | Files |
| --- | --- |
| Add a pipeline stage | [`pipeline/pipeline.py`](../../server/app/pipeline/pipeline.py) — its place in `run_job`, a `stage` name with an entry in `_STAGE_FAILURE_MESSAGES`, a progress step, and an `_is_superseded` checkpoint after it — plus a new leaf module in [`pipeline/`](../../server/app/pipeline/). Follow the leaf contract: no database access. Work that reads only the original can run beside separation: submit it in `_start_analysis`, collect its future in stage order, and write its stage message only if it isn't done — it can't be interrupted by a cancel. For the screen: its label in `processingCopy.stages` ([`design/copy.ts`](../../web/src/design/copy.ts)), which is `PROCESSING_STAGES`, and its index in `processingStage` ([`design/stages.ts`](../../web/src/design/stages.ts)) |
| Change stage progress or messages | [`pipeline/pipeline.py`](../../server/app/pipeline/pipeline.py) — `_SEPARATION_PROGRESS`, `_TEMPO_PROGRESS` and `_CHORDS_PROGRESS` are there, and so is how often separation writes: `_PROGRESS_WRITE_STEP` and `_PROGRESS_WRITE_SECONDS`, the second kept equal to the event stream's `_EVENT_POLL_SECONDS` in [`routes_jobs.py`](../../server/app/api/routes_jobs.py). Tempo and chord detection run beside separation, so their steps are written only when they are still running once the stems are — a fast one is never a current stage. A stage message is also a label in `processingCopy.stages` ([`design/copy.ts`](../../web/src/design/copy.ts)), and `processingStage` recognises *Detecting tempo* only by it; rename both together |
| Find where a job's time goes | `docker compose logs -f server` — `_timed` in [`pipeline/pipeline.py`](../../server/app/pipeline/pipeline.py) logs each step's seconds at `INFO` (download, separation, analysis decode, tempo, chords and key, model warm-up) and the job's total; [`main.py`](../../server/app/main.py) sets the level that lets them through. *Separation* is the decode, the model's pass and writing the stems together; at start-up [`separation.py`](../../server/app/pipeline/separation.py) also logs a chunk's milliseconds in each precision. What was measured, and what is left, is in [stem separation](../features/stem-separation.md#cost-and-timing) and [the todo](../todos/encode-stems-during-separation.md) |
| Trade separation quality for speed | `DEMUCS_OVERLAP` in the server's environment — `demucs_overlap` in [`core/config.py`](../../server/app/core/config.py), default `0.25`, Demucs' own. A lower value such as `0.1` is faster, with more audible seams where chunks meet. The other way round, `DEMUCS_HALF_PRECISION=false` (`demucs_half_precision`) gives float32 stems for about a third more time in the model on a GPU. Changing a default means documenting it in [../operations/configuration.md](../operations/configuration.md) |
| Change how a chunk runs on a GPU | [`pipeline/separation.py`](../../server/app/pipeline/separation.py) — `_run_model` and `_settle_precision` (half precision), `_RecordedModel`, `_record` and `_settle_recording` (the recorded CUDA graph), `_keep_forward_on_gpu` (the three demucs helpers it replaces). A change to demucs' forward pass has to be mirrored there; `_settle_recording` is what notices if it wasn't. `DEMUCS_HALF_PRECISION` and `DEMUCS_CUDA_GRAPH` turn either off. Read [how a chunk runs on a GPU](../features/stem-separation.md#how-a-chunk-runs-on-a-gpu) first, and check a change against float32 stems with the same `random.seed` — with both settings' effects off they are byte-identical to plain Demucs-in-CHORD |
| Encode stems faster, or during the pass | `_write_stems`, `_write_flac` and `_to_pcm16` in [`pipeline/separation.py`](../../server/app/pipeline/separation.py); the plan for doing it beside the pass is [../todos/encode-stems-during-separation.md](../todos/encode-stems-during-separation.md) |
| Change what a failure says | a `UserFacingError` subclass in [`pipeline/errors.py`](../../server/app/pipeline/errors.py) for a sentence written for the user (the exception it's raised `from` becomes the log), or `_STAGE_FAILURE_MESSAGES` in `pipeline.py` for everything unexpected. That sentence is the panel's body; its title — *Separation failed*, whichever stage failed — and its buttons are `failureCopy["job-error"]` in [`design/copy.ts`](../../web/src/design/copy.ts) |
| Change the track length limit | `max_duration_seconds` in [`core/config.py`](../../server/app/core/config.py) — and the *up to 12 minutes* hints (`dropHint`, `phoneDropHint`) in [`design/copy.ts`](../../web/src/design/copy.ts), which assume the default |
| Improve separation quality | [`pipeline/separation.py`](../../server/app/pipeline/separation.py) + the model checklist above |
| Change which sample rates survive separation | `_PRESERVED_SAMPLE_RATES` in [`pipeline/separation.py`](../../server/app/pipeline/separation.py), and the *44.1 / 48 kHz preserved* hint (`landingCopy.dropHint`) in [`design/copy.ts`](../../web/src/design/copy.ts) |
| Change where the models run, or their precision | `resolve_device()` in [`pipeline/device.py`](../../server/app/pipeline/device.py) — every model's device, the CPU fallback and its warning, and the process-wide `cudnn.allow_tf32 = False` that keeps the chord and key networks matching madmom. Whether a separated track stays on the GPU is `_storage_device` and `_GPU_MODEL_BYTES` in [`pipeline/separation.py`](../../server/app/pipeline/separation.py). Demucs' own precision isn't decided here but by `_settle_precision` in `separation.py`, under `DEMUCS_HALF_PRECISION` — see *Change how a chunk runs on a GPU* above |
| Run another madmom model on torch | wrap its processor in `run_on_torch` ([`pipeline/networks.py`](../../server/app/pipeline/networks.py)); a layer type `_convert` doesn't know raises at load — add it there, checked against madmom's own `activate` on random input, as the five it has were |
| Tune chord detection | [`pipeline/chords.py`](../../server/app/pipeline/chords.py) — `_madmom_label_to_chord`, `_FLAT_TO_SHARP`, `_resolve_relative_ambiguity` |
| Populate real chord confidence | [`pipeline/chords.py`](../../server/app/pipeline/chords.py) (currently hardcoded `1.0`), then a consumer in [`results/ChordBar.tsx`](../../web/src/screens/results/ChordBar.tsx) |
| Change how tempo is estimated | [`pipeline/tempo.py`](../../server/app/pipeline/tempo.py) — it is librosa's estimate assembled in blocks, so its constants are librosa's defaults and the block sizes are only memory. Check any change against `librosa.beat.beat_track`'s tempo on real audio and on silence, and watch peak memory: holding it flat in the track's length is the point of the file |
| Fix metronome phase alignment | [`pipeline/tempo.py`](../../server/app/pipeline/tempo.py) — no beat is placed today, only a tempo estimated. Run `librosa.beat.beat_track(onset_envelope=…, bpm=…)` on the onset envelope and tempo `detect_tempo` already has, return the first beat's time, and add the tracker to `warm_up()`, since numba compiles it on first use. Then a new column via the field checklist, and `scheduleClicksAhead` in [`playbackEngine.ts`](../../web/src/audio/playbackEngine.ts), which puts beat one at track time zero |
| Change lyrics matching | [`pipeline/lyrics.py`](../../server/app/pipeline/lyrics.py) — `guess_candidates`, `_TITLE_NOISE_RE`, `fetch_lyrics` |
| Tune lyrics offset correction | [`pipeline/lyrics.py`](../../server/app/pipeline/lyrics.py) — `_RMS_HOP_SECONDS`, `_RMS_ACTIVITY_RATIO`, `_MAX_OFFSET_SECONDS` and `_MIN_SCORE_IMPROVEMENT`. `_RMS_BLOCK_WINDOWS` is only how much of the vocals stem is read at a time |
| Change how pasted lyrics are read | `parse_lyrics_text` in [`pipeline/lyrics.py`](../../server/app/pipeline/lyrics.py) — LRC timestamps make them synced. The editor is [`results/LyricsDialog.tsx`](../../web/src/screens/results/LyricsDialog.tsx) |
| Support another audio format | `ALLOWED_UPLOAD_EXTENSIONS` in [`routes_jobs.py`](../../server/app/api/routes_jobs.py); `ACCEPTED_EXTENSIONS` and the `accept` attribute in [`LandingScreen.tsx`](../../web/src/screens/landing/LandingScreen.tsx), and the format copy (`dropHint`, `phoneDropHint`, `rejectedDropHint`, `rejectedBody`) in [`design/copy.ts`](../../web/src/design/copy.ts); the extension regex in `guess_candidates` ([`lyrics.py`](../../server/app/pipeline/lyrics.py)); and the title regex in [`results/ExportDialog.tsx`](../../web/src/screens/results/ExportDialog.tsx) |
| Add a URL source | usually nothing — yt-dlp handles it. Site-specific options go in [`pipeline/source.py`](../../server/app/pipeline/source.py). If the source's codec shows on the processing screen as `FLAC 16/…`, yt-dlp named a codec `_SOURCE_CODECS` doesn't have, or none and an extension `_SOURCE_EXTENSIONS` doesn't |
| Change the format a link's audio is kept in | `DOWNLOAD_FILENAME` and the `FFmpegExtractAudio` options in [`pipeline/source.py`](../../server/app/pipeline/source.py) — `run_job` and `_normalize_downloaded_thumbnail` find the file by that name. libsndfile must be able to read it (`metadata.read_audio_info`), and so must `sphn` or ffmpeg. Existing link jobs keep the old file, so their resumes download again |
| Change what the processing screen says a track's format is | `read_audio_info` in [`pipeline/metadata.py`](../../server/app/pipeline/metadata.py) for the label's shape; `_source_codec` and its two tables in [`pipeline/source.py`](../../server/app/pipeline/source.py) for a link's codec. An upload's label is written by `run_job` with `status=separating`, a link's by `_record_track_identity` with its title |
| Replace the worker with a real broker | [`pipeline/worker.py`](../../server/app/pipeline/worker.py) + `start_worker()` in [`main.py`](../../server/app/main.py). The leaf modules need no changes — that's why they take no database handles. Cancellation doesn't travel through the queue: a run polls its own row (`_is_superseded`) |

## API

| Task | Files |
| --- | --- |
| Add an endpoint | the matching router in [`api/`](../../server/app/api/) (jobs / stems / analysis), a `response_model` in [`schemas.py`](../../server/app/models/schemas.py), then a function or URL builder in [`client.ts`](../../web/src/api/client.ts). A handler that blocks — network, heavy file work — is a plain `def`, as `get_lyrics` and `download_stems` are |
| Change an error message | the `HTTPException(detail=...)` — `detail` reaches the user verbatim through `errorFrom` in [`client.ts`](../../web/src/api/client.ts). Pipeline failures are in the table above |
| Change SSE cadence or payload | `job_events` and `_EVENT_POLL_SECONDS` in [`routes_jobs.py`](../../server/app/api/routes_jobs.py) — and `_PROGRESS_WRITE_SECONDS` in [`pipeline.py`](../../server/app/pipeline/pipeline.py), which throttles separation's progress writes to the same interval, since a write the stream doesn't read is wasted; check the nginx SSE directives in [`nginx.conf`](../../web/nginx.conf) still apply. The reconnect policy is `MAX_RECONNECT_ATTEMPTS` and the backoff constants in [`useJobEvents.ts`](../../web/src/hooks/useJobEvents.ts) |
| Change the upload size limit | `client_max_body_size` in [`nginx.conf`](../../web/nginx.conf) — the server streams uploads to disk (`_save_upload` in [`routes_jobs.py`](../../server/app/api/routes_jobs.py)) and sets no limit of its own. The 413 sentence is in `createJob` ([`client.ts`](../../web/src/api/client.ts)) |
| Change what a resume reuses | `run_job` in [`pipeline.py`](../../server/app/pipeline/pipeline.py) — it keeps a downloaded `original.flac` (with the title, author and source format `_record_track_identity` saved) and complete stems. `resume_job` in [`routes_jobs.py`](../../server/app/api/routes_jobs.py) resets the row and bumps `attempt`, which is what makes the cancelled run's writes miss |
| Change the stored stem format | `STEM_SUFFIX` and the `soundfile.write` call in `_write_flac` in [`pipeline/separation.py`](../../server/app/pipeline/separation.py), which names the format outright because it writes to a file object; the literal `.flac` in `get_stem`'s route and its `media_type` in [`routes_stems.py`](../../server/app/api/routes_stems.py) (`_wav_stream` decodes whatever libsndfile reads, and assumes 16-bit); `stemUrl` in [`client.ts`](../../web/src/api/client.ts); and `flacSampleRate` in [`playbackEngine.ts`](../../web/src/audio/playbackEngine.ts), which reads the stems' sample rate out of the FLAC header — another format yields none, and the engine then decodes at the device's rate. Existing job directories keep the old format, which `_stems_complete` won't recognise, so their resumes separate again |
| Change the export format | `_wav_stream`, `_wav_size` and `download_stem_wav` in [`routes_stems.py`](../../server/app/api/routes_stems.py), and the entry names in `_zip_stream`; `stemDownloadUrl` in [`client.ts`](../../web/src/api/client.ts); the saved name in [`results/ExportDialog.tsx`](../../web/src/screens/results/ExportDialog.tsx) and `dialogCopy.export` (`hint`, `format`) in [`design/copy.ts`](../../web/src/design/copy.ts) |
| Change how the zip is built | `_zip_stream` and `download_stems` in [`routes_stems.py`](../../server/app/api/routes_stems.py) — keep it streamed through `_ChunkSink`, never buffered, and a plain `def`. Deflate is at `compresslevel=1`: near-silent stems compress well even there |

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
| Reduce time-to-play | `load()` in `playbackEngine.ts` — every stem must download and decode before the results show, and it reports no progress, so the loading screen sits at 100% meanwhile. Three things already shorten it: `adoptSampleRate` opens the context at the stems' rate so `decodeAudioData` doesn't resample; [`results/ResultsScreen.tsx`](../../web/src/screens/results/ResultsScreen.tsx) orders its request-starting effects chords, stems, lyrics, so no stem queues behind the lyrics lookup for one of the browser's six connections; and `_StemFile` in [`routes_stems.py`](../../server/app/api/routes_stems.py) sends a megabyte per read. What's left is the download and the decode themselves |
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
| Change how long jobs are kept | `JOB_TTL_HOURS` in the server's environment, passed through by [`docker-compose.yml`](../../docker-compose.yml). It is `job_ttl_hours` in [`core/config.py`](../../server/app/core/config.py): default `24`, and `0` turns the reaper off. What a sweep deletes, and the hour of grace, are in [`pipeline/reaper.py`](../../server/app/pipeline/reaper.py). An open page keeps its job with a heartbeat every `HEARTBEAT_INTERVAL_MS` from [`useJobEvents.ts`](../../web/src/hooks/useJobEvents.ts) to `heartbeat_job` in [`routes_jobs.py`](../../server/app/api/routes_jobs.py), which writes `last_seen_at` — see [../data/retention.md](../data/retention.md#the-reaper) |
| Add job retention / a library | stop the beacon in [`useJobEvents.ts`](../../web/src/hooks/useJobEvents.ts), surface `GET /jobs` in the UI, **and stop the reaper deleting the library** — see [../data/retention.md](../data/retention.md#if-retention-were-wanted) |
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
| A restart orphans in-flight jobs, and the reaper leaves them alone | [../data/retention.md](../data/retention.md#stale-rows) |
| *Discard* right after *Cancel* deletes the job directory while the cancelled run may still write into it | [../architecture/job-lifecycle.md](../architecture/job-lifecycle.md) |
| A resume re-separates from scratch unless all six stems were written | [../features/stem-separation.md](../features/stem-separation.md) |
| Stems are always 16-bit (stored as FLAC, exported as WAV), whatever the source's depth | [../features/stem-separation.md](../features/stem-separation.md) |
| A cancelled or superseded run's tempo or chord step keeps running on its analysis thread, overlapping the next job | [../architecture/job-lifecycle.md](../architecture/job-lifecycle.md#cancelling) |
| The stems are converted and encoded after the model's pass, not beside it: two to four seconds of a GPU job with the cores idle before it | [../todos/encode-stems-during-separation.md](../todos/encode-stems-during-separation.md) |
| A link whose codec yt-dlp doesn't name — a direct `.webm` link — is labelled `FLAC 16/…`, as if it were lossless | [../features/ingest.md](../features/ingest.md#the-download) |
| A link job's directory from before link audio was kept as FLAC holds `original.mp3`, so resuming it downloads again | [../features/stem-separation.md](../features/stem-separation.md#resume) |
| A link whose metadata has no duration downloads in full before the length limit refuses it | [../features/ingest.md](../features/ingest.md) |
| The GPU image holds PyPI's newest torch, not the overlay's CUDA 12.4 build — torch 2.14 for CUDA 13.0 as of November 2026 — so on an older driver every job runs on the CPU (the log warns) | [../operations/docker.md](../operations/docker.md#the-gpu-overlay) |
| `stems_model` is declared everywhere and never written | [../data/schema.md](../data/schema.md#field-notes) |
| `key.json` is written but no endpoint serves it | [../features/chords-and-key.md](../features/chords-and-key.md#outputs-and-where-each-one-goes) |
| `ChordSegment.confidence` is hardcoded to `1.0` | [../api/analysis.md](../api/analysis.md#get-jobsjob_idchords) |
| `stem_names` reports a constant, not the real directory | [../api/jobs.md](../api/jobs.md#jobresponse) |
| Pasted LRC with `[offset:]` tags, several timestamps on a line, or untimed lines mixed in loses lines | [../features/lyrics.md](../features/lyrics.md) |
| Speed control needs `AudioWorklet`, which browsers expose only to secure origins — over plain HTTP to anything but `localhost`, the speed chip is disabled | [../features/speed-and-loop.md](../features/speed-and-loop.md) |
| No tests, no CI | [../architecture/README.md](../architecture/README.md#where-things-are-not) |
