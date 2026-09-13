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
`DEMUCS_MODEL` without changing `STEM_NAMES` breaks the contract: `_row_to_response` advertises
all six names on a `done` job regardless of what was actually written, so the browser would
request stems that don't exist and each would 404.

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

Switching between CPU and GPU therefore requires a **rebuild**, not just an environment change.

## Lazy, cached loading

```python
_separator: Separator | None = None

def _get_separator() -> Separator:
    global _separator
    if _separator is None:
        _separator = Separator(model=settings.demucs_model, device=_resolve_device())
    return _separator
```

A module-level singleton, constructed on first use. Model weights are hundreds of MB and take
seconds to load onto the device, so this happens once per process and every later job reuses it.
The same lazy-singleton pattern appears in [`chords.py`](../../server/app/pipeline/chords.py)
for madmom's processors.

Because only the single worker thread ever calls `separate()`, the unguarded `global` is safe
here. It would not be if concurrency were introduced.

## Weights cache

[`main.py`](../../server/app/main.py) sets `TORCH_HOME` to `settings.models_cache_dir` **before**
any torch import:

```python
os.environ.setdefault("TORCH_HOME", str(settings.models_cache_dir))
```

That resolves to `server/data/models_cache/`, which is inside the bind mount. Without it, torch
would download `htdemucs_6s` into the container's `~/.cache` and lose it on every recreate —
a repeated multi-hundred-MB download. **The first separation on a fresh install downloads the
weights**, which is why the first job is much slower than the rest.

## Output

```python
def separate(input_path: Path, output_dir: Path) -> list[str]:
    output_dir.mkdir(parents=True, exist_ok=True)
    separator = _get_separator()
    _, stems = separator.separate_audio_file(input_path)
    for name, waveform in stems.items():
        save_audio(waveform, str(output_dir / f"{name}.wav"), samplerate=separator.samplerate)
```

One WAV per stem in `data/jobs/<job_id>/stems/`, at the model's native sample rate (44.1 kHz for
htdemucs). Output is **uncompressed** — roughly 10 MB per stem-minute, so a four-minute song is
~250 MB across six stems. That size drives three other decisions: the zip endpoint builds in
memory, the browser must download all six before playback, and discard-on-leave deletes the
directory.

`separate()` returns the list of names it wrote, but `run_job` ignores the return value — the
API reports the constant `STEM_NAMES` instead.

## Cost and timing

Roughly, for a four-minute track:

| Device | Separation time |
| --- | --- |
| Modern NVIDIA GPU | tens of seconds |
| CPU | several minutes |

The progress bar does not move during this stage — it sits at `0.10` from the start of
separation until `0.50` when tempo detection begins, because Demucs' internal progress isn't
surfaced through the API CHORD uses. See
[job-lifecycle.md](../architecture/job-lifecycle.md#progress-values).

A cancel requested during separation is not acted on until the pass completes; see
[cooperative cancellation](../architecture/decisions.md#cooperative-cancellation).

## Client side

The browser fetches all six stems in parallel and decodes each into an `AudioBuffer`
([`playbackEngine.ts`](../../web/src/audio/playbackEngine.ts) `load()`), then plays them
sample-locked off one `AudioContext` clock. That machinery is documented in
[../architecture/audio-playback.md](../architecture/audio-playback.md).

The vocals buffer gets one extra check: `detectHasVocals` in
[`hasVocals.ts`](../../web/src/utils/hasVocals.ts) measures RMS over every 8th sample against a
`0.01` threshold, so an instrumental's near-silent vocals stem suppresses the lyrics UI rather
than showing a stale line.
