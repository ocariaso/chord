import shutil
from collections.abc import Callable
from pathlib import Path

import julius
import soundfile as sf
import torch
from demucs.api import Separator, save_audio

from app.core.config import settings

# Demucs always works at the model's own rate (44.1 kHz for htdemucs). Stems from a 48 kHz source are
# resampled back to it, so they line up sample-for-sample with the original in a DAW; other source
# rates keep the model's.
_PRESERVED_SAMPLE_RATES = {44100, 48000}

_separator: Separator | None = None


def _resolve_device() -> str:
    if settings.device == "cuda" and not torch.cuda.is_available():
        return "cpu"
    return settings.device


def _get_separator() -> Separator:
    global _separator
    if _separator is None:
        _separator = Separator(model=settings.demucs_model, device=_resolve_device())
    return _separator


def _chunk_callback(on_progress: Callable[[float], None]) -> Callable[[dict], None]:
    """Adapts Demucs' per-chunk callback into a 0-1 fraction of the whole separation."""

    def callback(info: dict) -> None:
        # With the default jobs=0 chunks run in order, so the offset of the chunk starting now is
        # the share of the model's pass already done.
        if info["state"] != "start" or not info["audio_length"]:
            return
        done_in_model = info["segment_offset"] / info["audio_length"]
        on_progress((info["model_idx_in_bag"] + done_in_model) / info["models"])

    return callback


def separate(input_path: Path, output_dir: Path, on_progress: Callable[[float], None] | None = None) -> list[str]:
    """Run Demucs on input_path, writing one WAV per stem into output_dir.

    `on_progress` receives 0-1 as chunks start; an exception raised from it abandons the pass. Stems
    are written to a sibling scratch directory that is renamed into place only once every one of them
    exists, so output_dir is either complete or absent — which is what lets a resumed job skip this."""
    separator = _get_separator()
    # The separator is a process-wide singleton, so the callback is swapped per job rather than
    # fixed at construction.
    separator.update_parameter(callback=_chunk_callback(on_progress) if on_progress else None)

    partial_dir = output_dir.with_name(f"{output_dir.name}.partial")
    shutil.rmtree(partial_dir, ignore_errors=True)
    partial_dir.mkdir(parents=True)
    _, stems = separator.separate_audio_file(input_path)

    source_rate = sf.info(str(input_path)).samplerate
    output_rate = source_rate if source_rate in _PRESERVED_SAMPLE_RATES else separator.samplerate
    stem_names: list[str] = []
    for name, waveform in stems.items():
        if output_rate != separator.samplerate:
            waveform = julius.resample_frac(waveform, separator.samplerate, output_rate)
        save_audio(waveform, str(partial_dir / f"{name}.wav"), samplerate=output_rate)
        stem_names.append(name)

    shutil.rmtree(output_dir, ignore_errors=True)
    partial_dir.rename(output_dir)
    return stem_names
