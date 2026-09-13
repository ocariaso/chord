# Stem separation

Splitting one mixed track into six isolated audio sources. This is the slowest stage of the
pipeline and the reason the GPU path exists.

## Model

[`separation.py`](../../server/app/pipeline/separation.py) uses Demucs through its Python API
(`demucs.api.Separator`), with the model named by `settings.demucs_model` —
default **`htdemucs_6s`**.

`htdemucs_6s` is the six-source Hybrid Transformer Demucs model. The stem set it produces is
what `STEM_NAMES` in [`schemas.py`](../../server/app/models/schemas.py) hardcodes:

```python
STEM_NAMES = ["vocals", "drums", "bass", "guitar", "piano", "other"]
```

The standard four-source `htdemucs` would produce only `vocals/drums/bass/other`. Changing
`DEMUCS_MODEL` without changing `STEM_NAMES` breaks the contract twice over:

- `_row_to_response` advertises all six names on a `done` job regardless of what was actually
  written, so the browser requests stems that don't exist and each one 404s.
- `_stems_complete` in [`pipeline.py`](../../server/app/pipeline/pipeline.py) also checks
  `STEM_NAMES`, so a model with a different stem set never counts as finished and every
  [resume](#resume) separates again.

The web side loads only the stems in `STEM_KEYS` in
[`design/stems.ts`](../../web/src/design/stems.ts) — the same six, in the same order. A name outside
them has no label or hue in the design, so it is neither fetched nor shown.

`piano` and `guitar` are the weakest separations in this model — a known property of
`htdemucs_6s`, not a bug in CHORD. Tracks without those instruments produce near-silent stems
rather than absent ones.

## Device selection

```python
def _resolve_device() -> str:
    if settings.device == "cuda" and not torch.cuda.is_available():
        return "cpu"
    return settings.device
```

`DEVICE` comes from Compose: the base [`docker-compose.yml`](../../docker-compose.yml) sets
`DEVICE: ${DEVICE:-cpu}`, and [`docker-compose.gpu.yml`](../../docker-compose.gpu.yml) overrides
it to `cuda` along with reserving the NVIDIA devices.
[`scripts/start.sh`](../../scripts/start.sh) picks the overlay automatically by probing
`nvidia-smi`.

The `torch.cuda.is_available()` guard means asking for CUDA on a machine without it degrades to
CPU instead of crashing — useful because the GPU overlay also selects a CUDA torch wheel at
build time, and a container built for CUDA may still land somewhere without a visible device.

Which torch wheel gets installed is a **build argument**, not runtime config:

```yaml
TORCH_INDEX_URL: ${TORCH_INDEX_URL:-https://download.pytorch.org/whl/cpu}   # base
TORCH_INDEX_URL: https://download.pytorch.org/whl/cu124                     # gpu overlay
```

Switching between CPU and GPU therefore requires a **rebuild**, not an environment change alone.

## Lazy, cached loading

```python
_separator: Separator | None = None

def _get_separator() -> Separator:
    global _separator
    if _separator is None:
        _separator = Separator(model=settings.demucs_model, device=_resolve_device(), overlap=settings.demucs_overlap)
    return _separator
```

A module-level singleton. Loading the weights onto the device takes seconds, so this happens once
per process and every later job reuses it — and it happens before the first job: the worker thread
calls `pipeline.warm_up()` before it takes anything off the queue, which calls `load_model()` here.
A job submitted during the warm-up waits on *Queued*.

`overlap` is `DEMUCS_OVERLAP`: how much of each chunk is blended with its neighbours. Its default,
`0.25`, is Demucs' own. Lowering it is an opt-in trade — a value such as `0.1` is less work and
separates faster, with more audible seams where chunks meet. See
[configuration](../operations/configuration.md#server-environment-variables).
The same lazy-singleton pattern appears in [`chords.py`](../../server/app/pipeline/chords.py)
for madmom's processors.

Because the separator is shared, its progress callback can't be fixed at construction:
`separate()` swaps it in for each job with `separator.update_parameter(callback=...)`. That, like
the unguarded `global`, is safe only because the single worker thread is the only caller; it would
not be if concurrency were introduced.

## Weights cache

The `htdemucs_6s` weights (about 53 MB) are **baked into the server image**. demucs 4.1 loads a
named model from the Hugging Face Hub and caches it under `HF_HOME`;
[`server/Dockerfile`](../../server/Dockerfile) points `HF_HOME` at `/opt/models/huggingface`,
downloads the model there at build time, then sets `HF_HUB_OFFLINE=1`, so the separator reads the
baked copy and nothing downloads at runtime. Left to the first job, the weights landed in the
container's ephemeral `~/.cache/huggingface` and were fetched again after every rebuild —
`TORCH_HOME`, which [`main.py`](../../server/app/main.py) points at the data volume, is only
demucs' fallback path.

The model is therefore chosen at build time: `DEMUCS_MODEL` is a build argument, which the image
also sets as the runtime variable. What a runtime-only override does is in
[configuration](../operations/configuration.md#demucs-weights).

## Output

```python
def separate(input_path, output_dir, on_progress=None) -> list[str]:
    separator = _get_separator()
    separator.update_parameter(callback=_chunk_callback(on_progress) if on_progress else None)

    partial_dir = output_dir.with_name(f"{output_dir.name}.partial")      # stems.partial/
    shutil.rmtree(partial_dir, ignore_errors=True)
    partial_dir.mkdir(parents=True)
    _, stems = separator.separate_audio_file(input_path)

    source_rate = sf.info(str(input_path)).samplerate
    output_rate = source_rate if source_rate in _PRESERVED_SAMPLE_RATES else separator.samplerate
    for name, waveform in stems.items():
        if output_rate != separator.samplerate:
            waveform = julius.resample_frac(waveform, separator.samplerate, output_rate)
        samples = prevent_clip(waveform, mode="rescale").t().cpu().numpy()
        sf.write(str(partial_dir / f"{name}{STEM_SUFFIX}"), samples, output_rate, subtype="PCM_16")

    shutil.rmtree(output_dir, ignore_errors=True)
    partial_dir.rename(output_dir)
```

One 16-bit FLAC per stem in `data/jobs/<job_id>/stems/` (`STEM_SUFFIX = ".flac"`), whatever the
source's depth. `prevent_clip(mode="rescale")` — Demucs' own, the one its `save_audio` applies —
scales a stem that would clip down as a whole rather than clipping it, and libsndfile encodes the
FLAC in-process, where `save_audio` would start an ffmpeg process per file. FLAC is lossless at about
half WAV's bytes: the same stems as WAV are about 10 MB per stem-minute at 44.1 kHz and 11.5 MB at
48 kHz, roughly 830 MB for a twelve-minute 48 kHz track. The size still drives other decisions: the
browser must download all six before playback, and discard-on-leave deletes the directory. Export
converts back: the WAVs the export dialog saves are decoded from these files as they stream — see
[downloads](downloads.md) and
[why](../architecture/decisions.md#stems-are-stored-as-flac-and-exported-as-wav).

`separate()` returns the list of names it wrote, but `run_job` ignores the return value — the
API reports the constant `STEM_NAMES` instead.

### Written complete or not at all

All six files go into `stems.partial/`, which is renamed to `stems/` only after the last one is
written. So **`stems/` is either complete or absent**, and that guarantee is what lets a resume trust
it. Each run deletes any leftover `stems.partial/` before starting. Stems are written only after
Demucs returns, so a pass abandoned by a cancel leaves an empty `stems.partial/` behind (until the job
is resumed, discarded or reaped), while a crash in the middle of writing can leave some FLACs in it — never in
`stems/`.

### Sample rate

Demucs works at the model's own rate, 44.1 kHz for htdemucs. `_PRESERVED_SAMPLE_RATES = {44100,
48000}` decides what gets written:

| Source rate | Stems written at |
| --- | --- |
| 44.1 kHz | 44.1 kHz, as the model produced them |
| 48 kHz | 48 kHz — resampled back from 44.1 kHz with `julius.resample_frac` |
| anything else (32, 88.2, 96 kHz…) | 44.1 kHz |

The point is the exported files: stems from a 48 kHz source line up sample-for-sample with the
original in a DAW. Playback doesn't depend on it, because the browser decodes every stem to the
audio context's rate anyway. The cost is one resampling pass per stem for 48 kHz sources. The
landing page advertises the behavior (*44.1 / 48 kHz preserved through separation*).

## Progress

Separation reports measured progress. `_chunk_callback` adapts Demucs' per-chunk callback: at each
chunk's *start* (end events are ignored), the chunk's `segment_offset / audio_length` is the share of
the current model's pass already done — which holds because Demucs' default `jobs=0` runs chunks in
order — and `(model_idx_in_bag + that) / models` extends it across a bag of models.

`_separation_progress` in `pipeline.py` maps that fraction onto `_SEPARATION_PROGRESS = (0.1, 0.85)`
and writes the row only when progress has moved `_PROGRESS_WRITE_STEP = 0.01` of the bar since the
last write. That is one write per percentage point of the *overall* bar — at most 75 across
separation. The bar moves in chunk-sized steps, so a short track moves in fewer, larger ones.

Separation fills most of the bar because tempo, chord and key detection run beside it, on the job's
analysis thread, rather than after it. Their steps appear only for a step still running once the
stems are written:

| Progress | Stage message |
| --- | --- |
| 0.05 | *Downloading audio* (links only) |
| 0.10 → 0.85 | *Separating stems*, measured |
| 0.85 | *Detecting tempo* — only if tempo detection hasn't finished |
| 0.90 | *Detecting chords and key* — only if chord and key detection hasn't finished |
| 1.00 | *Done* |

The bar holds at 0.10 while the separator is constructed and its weights load, because no chunk has
started yet. The processing screen shows the percentage and the bar as they are; it offers no
time-remaining estimate.

## Cancelling during separation

The progress callback doubles as the cancellation check. At most every two seconds
(`_SUPERSEDED_POLL_SECONDS`), `on_progress` asks `_is_superseded` whether the row is gone, cancelled,
or on a newer `attempt`, and if so raises `_Superseded`. The exception propagates out of Demucs,
abandoning the pass, and `run_job` returns without writing anything.

The check runs only when a chunk starts, so a cancel takes effect at the first chunk start at least
two seconds after the previous check: seconds on a GPU, longer on a CPU, where each chunk is slow.
Whatever the pass had computed is thrown away. See
[cooperative cancellation](../architecture/decisions.md#cooperative-cancellation).

Every row write in `run_job` is scoped to the run — `WHERE id = ? AND attempt = ? AND status !=
'cancelled'` — so a run that loses the race can never overwrite a cancel or a newer attempt.

## Resume

A cancelled job can be resumed from its failure panel (*Resume job*), which calls
`POST /jobs/{job_id}/resume`: the row goes back to `queued` with progress 0 and its messages and log
cleared, `attempt` is incremented, and the job is enqueued again. The worker is serial, so the new
attempt starts only after the cancelled run has returned.

`run_job` skips separation when `_stems_complete(stems_dir)` finds all six FLACs. Because `stems/` is
written atomically, that means the previous attempt finished separating — the cancel came while its
tempo or chord results were being waited for. A job directory from before stems were FLAC holds
`.wav` files, which don't count. A cancel **during** separation leaves no `stems/`, and the resumed attempt
separates from the start; there is no per-chunk or per-stem resume. Link jobs also skip the download
when `original.mp3` is already there, and keep the title and author it found, which were written
outside the attempt guard. The lifecycle is in [job lifecycle](../architecture/job-lifecycle.md).

## Cost and timing

Roughly, for a four-minute track:

| Device | Separation time |
| --- | --- |
| Modern NVIDIA GPU | tens of seconds |
| CPU | several minutes |

Tempo, chord and key detection run at the same time, on their own thread, so on a GPU the job is
done soon after the stems are. On a CPU they compete with Demucs for the same cores.

The weights load before the first job, during the worker's warm-up, together with the beat
tracker's numba compile and the madmom networks; a job submitted during it waits on *Queued*. Each
step's seconds are logged — see
[troubleshooting](../operations/troubleshooting.md#where-a-jobs-time-goes).

## Client side

Separation isn't finished for the user until the stems are in the browser.
[`ResultsScreen`](../../web/src/screens/results/ResultsScreen.tsx) creates a
[`PlaybackEngine`](../../web/src/audio/playbackEngine.ts) per job and calls `load()` with one input
per template stem in `job.stem_names`. `load()` fetches them all in parallel, reads each response
whole, and decodes each into an `AudioBuffer` at the context's rate; they then play sample-locked
off one `AudioContext` clock, as described in [audio playback](../architecture/audio-playback.md).

### Loading stems

While loading, `ResultsScreen` renders the processing screen as the template's `processing-loading`
state: every stage but the last done — on the web layout with the durations measured while the job
ran — and the last current, the bar at 100%, *Loading stems…* as the message. That screen holds, unchanged, from the
first request to the last decoded buffer. `load()` reports no progress, so nothing tells the
download apart from the decode, or a slow connection from a stalled one. The *Cancel* button here
leaves the job: it returns to the landing screen, and discard-on-leave deletes the finished job on
the server ([why](../architecture/decisions.md#discard-on-leave)).

Loading is memory-hungry. `fetchStem` holds each stem's whole FLAC as an `ArrayBuffer` until it is
decoded, for all six at once, and the decoded buffers are 32-bit float — about 276 MB per stem for
twelve minutes at 48 kHz. That is the reason for the [duration limit](ingest.md#the-duration-limit). Once decoding
finishes, the waveform envelope for every stem is computed on the main thread.

### Stems failed to load

`load()` doesn't reject when a stem fails. It resolves with `{name, url, message}` for every stem
whose fetch or decode failed — the message is the HTTP status plus the server's `detail` (for
example `404 Stem not ready`), or the decoder's error. Any failure puts `ResultsScreen` in its
failed phase, the template's `results-load-error`:

| Part | Content |
| --- | --- |
| Title | *Stems failed to load* |
| Body | *Separation finished but three stem files could not be fetched. Chords, key and tempo are still available.* — the count in words, and *one stem file* for one |
| Log | one line per failure: `GET <url> — <message>` |
| Primary | *Retry download* — calls `load()` again with only the failures; the panel stays up, the button reading *Retrying…* |
| Secondary | *Open anyway* — always offered: the results screen with whatever did load, which can be nothing |

### Silent vocals

The vocals buffer gets one extra check: `detectHasVocals` in
[`hasVocals.ts`](../../web/src/utils/hasVocals.ts) measures RMS over every 8th sample of the first
channel against a `0.01` threshold. An instrumental's near-silent vocals stem is kept but **starts
muted**, reads *Silent* on its Console strip while it stays muted, and gets a note under the Mixer's
stems — see [results views](results-views.md#mixer). The lyric row is unaffected. A vocals stem that
failed to load has no buffer to measure and counts as having vocals.
