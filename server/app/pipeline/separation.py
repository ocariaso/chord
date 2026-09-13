from pathlib import Path

import torch
from demucs.api import Separator, save_audio

from app.core.config import settings

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


def separate(input_path: Path, output_dir: Path) -> list[str]:
    """Run Demucs on input_path, writing one WAV per stem into output_dir."""
    output_dir.mkdir(parents=True, exist_ok=True)
    separator = _get_separator()
    _, stems = separator.separate_audio_file(input_path)

    stem_names: list[str] = []
    for name, waveform in stems.items():
        save_audio(waveform, str(output_dir / f"{name}.wav"), samplerate=separator.samplerate)
        stem_names.append(name)
    return stem_names
