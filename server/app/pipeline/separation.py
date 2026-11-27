import os
import random
import shutil
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import julius
import numpy as np
import soundfile as sf
import sphn
import torch
import torch.nn.functional as F
from demucs.apply import BagOfModels
from demucs.audio import AudioFile, convert_audio
from demucs.pretrained import get_model
from demucs.utils import center_trim

from app.core.config import settings
from app.pipeline.device import resolve_device

# Lossless like the WAV Demucs writes by default, at about half the bytes — and every stem is downloaded whole
# before playback can start. decodeAudioData reads FLAC natively.
STEM_SUFFIX = ".flac"

# Demucs always works at the model's own rate (44.1 kHz for htdemucs). Stems from a 48 kHz source are
# resampled back to it, so they line up sample-for-sample with the original in a DAW; other source
# rates keep the model's.
_PRESERVED_SAMPLE_RATES = {44100, 48000}

# FLAC level 4 of 0-8: within a fraction of a percent of the size of libsndfile's default 5, encoded about a third
# faster. Encoding is on the critical path; every stem is also on the wire before playback starts, so not lower.
_FLAC_COMPRESSION_LEVEL = 0.5

# The separated track stays on the GPU only with room to spare for what else a job puts there meanwhile: about as much
# again — the padded mix, resampling each stem afterwards, the chord and key networks beside it — plus the model's own
# working memory, about 0.5 GiB for htdemucs_6s.
_GPU_MODEL_BYTES = 2**29

_model: BagOfModels | None = None


def _get_model() -> BagOfModels:
    global _model
    if _model is None:
        model = get_model(settings.demucs_model)
        # A named model is a bag already; a bare one becomes a bag of one, so one path weighs every model's sources.
        bag = model if isinstance(model, BagOfModels) else BagOfModels([model])
        # Kept on the device for good: Demucs' own apply_model moves a bag's models there and back on every job.
        _model = bag.to(resolve_device()).eval()
    return _model


def load_model() -> None:
    """Loads the separation model onto its device now, rather than inside the first job. On a GPU the model also runs
    once, on one chunk of silence: CUDA loads its kernels on first use, which would otherwise be the first job's wait."""
    bag = _get_model()
    if resolve_device().type == "cuda":
        silence = torch.zeros(bag.audio_channels, bag.samplerate, device=resolve_device())
        with torch.inference_mode():
            _separate(bag, silence, resolve_device(), lambda fraction: None)
        torch.cuda.empty_cache()


def _read_window(audio: torch.Tensor, start: int, length: int) -> torch.Tensor:
    """audio[..., start:start + length], silent wherever that runs past either end — how Demucs pads a chunk."""
    end = start + length
    inside = audio[..., max(0, start) : min(audio.shape[-1], end)]
    return F.pad(inside, (max(0, -start), max(0, end - audio.shape[-1])))


def _apply_model(
    model: torch.nn.Module, mix: torch.Tensor, storage: torch.device, on_progress: Callable[[float], None]
) -> torch.Tensor:
    """One Demucs model's (sources, channels, samples) for a normalized (channels, samples) mix on the model's device,
    accumulated on `storage`.

    This is Demucs' apply_model with its defaults — one random shift, overlapping chunks blended by a triangle — and
    the same arithmetic in the same order, but the overlap-add is kept where `storage` says and done in place. Demucs
    keeps it in RAM, copying every chunk back from the GPU and the whole result several times over."""
    channels, length = mix.shape
    # The chunk boundaries move by a random amount every run: the mix is padded with up to half a second of silence
    # and read from a random point, and the result's head is dropped by as much.
    max_shift = int(0.5 * model.samplerate)
    shift = random.randint(0, max_shift)
    padded = F.pad(mix, (max_shift, max_shift))
    shifted_length = length + max_shift - shift

    segment = int(model.samplerate * model.segment)
    stride = int((1 - settings.demucs_overlap) * segment)
    # Peaks mid-chunk, so where chunks overlap the one whose middle is nearer counts for more.
    weight = torch.cat([torch.arange(1, segment // 2 + 1), torch.arange(segment - segment // 2, 0, -1)]).to(storage)
    weight = weight / weight.max()

    out = torch.zeros(len(model.sources), channels, shifted_length, device=storage)
    total_weight = torch.zeros(shifted_length, device=storage)
    for offset in range(0, shifted_length, stride):
        on_progress(offset / shifted_length)
        chunk_length = min(segment, shifted_length - offset)
        # HTDemucs runs every chunk at its training length, centred on the chunk, with the audio either side as context.
        valid_length = model.valid_length(chunk_length) if hasattr(model, "valid_length") else chunk_length
        chunk = _read_window(padded, shift + offset - (valid_length - chunk_length) // 2, valid_length)
        chunk_out = center_trim(model(chunk[None])[0], chunk_length).to(storage)
        out[..., offset : offset + chunk_length] += weight[:chunk_length] * chunk_out
        total_weight[offset : offset + chunk_length] += weight[:chunk_length]
    out /= total_weight
    return out[..., max_shift - shift :]


def _separate(
    bag: BagOfModels, wav: torch.Tensor, storage: torch.device, on_progress: Callable[[float], None]
) -> torch.Tensor:
    """Every source of a (channels, samples) track at the model's rate, as (sources, channels, samples) on `storage`.
    Demucs' Separator.separate_tensor: the track normalized going in, each model's sources weighed, and the
    normalization undone. `wav` is normalized in place, which spares a copy of the track."""
    reference = wav.mean(0)
    mean, std = reference.mean(), reference.std() + 1e-8
    mix = wav.sub_(mean).div_(std)

    estimates: torch.Tensor | None = None
    totals = [0.0] * len(bag.sources)
    for index, (model, weights) in enumerate(zip(bag.models, bag.weights)):
        out = _apply_model(model, mix, storage, lambda fraction, i=index: on_progress((i + fraction) / len(bag.models)))
        for source, source_weight in enumerate(weights):
            out[source] *= source_weight
            totals[source] += source_weight
        estimates = out if estimates is None else estimates.add_(out)
    assert estimates is not None
    for source, total in enumerate(totals):
        estimates[source] /= total
    return estimates.mul_(std.item()).add_(mean.item())


def _read_audio(input_path: Path, bag: BagOfModels, device: torch.device) -> tuple[torch.Tensor, int]:
    """The track as (channels, samples) at the model's rate and channel count on `device`, and its own sample rate."""
    try:
        data, source_rate = sphn.read(str(input_path))
    except Exception:  # noqa: BLE001 - Demucs falls back to ffmpeg for whatever sphn can't decode, and so does this
        audio = AudioFile(input_path)
        wav = audio.read(streams=0, samplerate=bag.samplerate, channels=bag.audio_channels)
        return wav.to(device), audio.samplerate()
    # Resampled where the model runs, which on a GPU is where it's cheap.
    wav = torch.from_numpy(data).to(device)
    return convert_audio(wav, int(source_rate), bag.samplerate, bag.audio_channels), int(source_rate)


def _storage_device(device: torch.device, sources: int, wav: torch.Tensor) -> torch.device:
    """Where the separated track accumulates: beside the model when the GPU has room for it, otherwise in RAM."""
    if device.type != "cuda":
        return device
    free, _ = torch.cuda.mem_get_info(device)
    cached = torch.cuda.memory_reserved(device) - torch.cuda.memory_allocated(device)
    # Not "whatever fits": on Windows the driver spills an over-full GPU into system memory rather than failing, and
    # everything on it then runs several times slower.
    track_bytes = sources * wav.numel() * wav.element_size()
    needed = 2 * track_bytes + _GPU_MODEL_BYTES
    return device if needed <= free + cached else torch.device("cpu")


def _to_pcm16(stem: torch.Tensor, model_rate: int, output_rate: int) -> np.ndarray:
    """One stem as (samples, channels) 16-bit PCM at `output_rate`, computed where it was separated. The stem is
    scaled in place: each is read once, and a long track's stems are large."""
    if output_rate != model_rate:
        stem = julius.resample_frac(stem, model_rate, output_rate)
    # Clipping is prevented the way Demucs' prevent_clip does it, the same arithmetic without its copy; the scale,
    # rounding and clamp are libsndfile's own for float written as 16-bit, so these are the samples it would write.
    lowest, highest = torch.aminmax(stem)
    peak = torch.maximum(-lowest, highest)
    stem.div_(max((1.01 * peak).item(), 1))
    pcm = stem.mul_(32768).round_().clamp_(-32768, 32767).to(torch.int16)
    return pcm.t().contiguous().cpu().numpy()


def _write_flac(path: Path, samples: np.ndarray, sample_rate: int) -> None:
    sf.write(str(path), samples, sample_rate, subtype="PCM_16", compression_level=_FLAC_COMPRESSION_LEVEL)


def separate(input_path: Path, output_dir: Path, on_progress: Callable[[float], None] | None = None) -> list[str]:
    """Run Demucs on input_path, writing one 16-bit FLAC per stem into output_dir.

    `on_progress` receives 0-1 as chunks start; an exception raised from it abandons the pass. Stems
    are written to a sibling scratch directory that is renamed into place only once every one of them
    exists, so output_dir is either complete or absent — which is what lets a resumed job skip this."""
    bag = _get_model()
    device = resolve_device()
    partial_dir = output_dir.with_name(f"{output_dir.name}.partial")
    shutil.rmtree(partial_dir, ignore_errors=True)
    partial_dir.mkdir(parents=True)

    try:
        with torch.inference_mode():
            wav, source_rate = _read_audio(input_path, bag, device)
            stems = _separate(bag, wav, _storage_device(device, len(bag.sources), wav), on_progress or (lambda _: None))
            del wav
            output_rate = source_rate if source_rate in _PRESERVED_SAMPLE_RATES else bag.samplerate
            # libsndfile encodes outside the GIL, so stems encode side by side while the next is converted; more
            # threads than cores only queue.
            with ThreadPoolExecutor(max_workers=min(len(bag.sources), os.cpu_count() or 1)) as encoder:
                writes = [
                    encoder.submit(
                        _write_flac,
                        partial_dir / f"{name}{STEM_SUFFIX}",
                        _to_pcm16(stem, bag.samplerate, output_rate),
                        output_rate,
                    )
                    for name, stem in zip(bag.sources, stems)
                ]
                for write in writes:
                    write.result()
    finally:
        # The allocator would otherwise hold the largest track's memory on the GPU between jobs, away from the desktop
        # and every other program sharing it.
        if device.type == "cuda":
            torch.cuda.empty_cache()

    shutil.rmtree(output_dir, ignore_errors=True)
    partial_dir.rename(output_dir)
    return list(bag.sources)
