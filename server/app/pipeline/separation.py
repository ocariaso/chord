import functools
import logging
import math
import os
import queue
import random
import shutil
import threading
import time
from collections.abc import Callable, Sequence
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import demucs.htdemucs
import demucs.transformer
import julius
import numpy as np
import soundfile as sf
import sphn
import torch
import torch.nn.functional as F
from demucs.apply import BagOfModels
from demucs.audio import AudioFile, convert_audio
from demucs.htdemucs import HTDemucs
from demucs.pretrained import get_model
from demucs.utils import center_trim

from app.core.config import settings
from app.pipeline.device import resolve_device

logger = logging.getLogger(__name__)

# Undoes, in place, the normalization a stretch of a model's output is in.
_Restore = Callable[[torch.Tensor], torch.Tensor]

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
_FLAC_FORMAT = dict(format="FLAC", subtype="PCM_16", compression_level=_FLAC_COMPRESSION_LEVEL)

# A stem reaches the job directory through this much buffer, not a FLAC frame — a few kilobytes — at a time. Under
# Docker Desktop the data directory is a share of the host's disk where every write is a round trip: unbuffered,
# writing the stems took four to seven times as long as encoding them.
_WRITE_BUFFER_BYTES = 4 * 2**20

# The separated track stays on the GPU only with room to spare for what else a job puts there meanwhile: about as much
# again — the padded mix, resampling each stem afterwards, the chord and key networks beside it — plus the model's own
# working memory, about 0.5 GiB for htdemucs_6s.
_GPU_MODEL_BYTES = 2**29

# Stems encoded while the model runs go to their encoders a stretch at a time: at most this many seconds of audio in
# one, at most this many waiting for an encoder. Past that the audio stays where it is, on the GPU, until there is room.
_STRETCH_SECONDS = 10
_QUEUED_STRETCHES = 4
# Those encoders give way to every other thread: they are there to use cores the pass leaves idle, and on a host
# with none to spare the thread running the model, and the analysis, must not wait behind them.
_ENCODER_NICENESS = 10

# How many times a chunk is timed in each precision before one is chosen.
_PRECISION_TRIES = 3

# How often a thread waiting on the GPU looks to see whether it has finished.
_GPU_POLL_SECONDS = 0.001

# How far a recorded model's output may sit from the model's own, as a fraction of its peak, and still be used. In
# float32 the two are equal; in half precision cuDNN's choices move them apart by about a thousandth.
_RECORDING_TOLERANCE = 0.02

_model: BagOfModels | None = None
# Whether chunks run in half precision. Settled when the model is loaded onto a GPU, by timing a chunk each way, and
# cleared for the rest of the process by a pass that comes back with a NaN.
_half_precision = False
# Whether passes replay the model from a recorded CUDA graph. Set when the model is loaded onto a GPU, once a
# recording has reproduced it there, and cleared for the rest of the process by a recording that can't be made.
# Otherwise chunks run through the model directly, as they do off a GPU.
_recording = False
_stft_windows: dict[tuple[int, torch.device, torch.dtype], torch.Tensor] = {}


def _stft_window(length: int, like: torch.Tensor) -> torch.Tensor:
    key = (length, like.device, like.dtype)
    if key not in _stft_windows:
        _stft_windows[key] = torch.hann_window(length).to(like)
    return _stft_windows[key]


def _spectro(x: torch.Tensor, n_fft: int = 512, hop_length: int | None = None, pad: int = 0) -> torch.Tensor:
    """demucs.spec.spectro with its window kept on the GPU. demucs builds the window on the CPU and copies it across
    on every call."""
    *other, length = x.shape
    x = x.reshape(-1, length)
    z = torch.stft(
        x,
        n_fft * (1 + pad),
        hop_length or n_fft // 4,
        window=_stft_window(n_fft, x),
        win_length=n_fft,
        normalized=True,
        center=True,
        return_complex=True,
        pad_mode="reflect",
    )
    _, freqs, frames = z.shape
    return z.view(*other, freqs, frames)


def _pad1d(x: torch.Tensor, paddings: tuple[int, int], mode: str = "constant", value: float = 0.0) -> torch.Tensor:
    """demucs.hdemucs.pad1d less its last assert, which compares the padded audio with the original on the GPU and
    waits for the answer."""
    length = x.shape[-1]
    padding_left, padding_right = paddings
    if mode == "reflect":
        max_pad = max(padding_left, padding_right)
        if length <= max_pad:
            extra_pad = max_pad - length + 1
            extra_pad_right = min(padding_right, extra_pad)
            extra_pad_left = extra_pad - extra_pad_right
            paddings = (padding_left - extra_pad_left, padding_right - extra_pad_right)
            x = F.pad(x, (extra_pad_left, extra_pad_right))
    return F.pad(x, paddings, mode, value)


def _keep_forward_on_gpu() -> None:
    """Replaces three demucs helpers that leave the GPU in the middle of a chunk's forward pass with ones that don't,
    arithmetic unchanged. Each was a wait on the CPU for every chunk, and is a step a CUDA graph can't record."""
    demucs.htdemucs.pad1d = _pad1d
    demucs.htdemucs.spectro = _spectro
    # The transformer's positional embedding depends on the chunk's shape alone, and demucs computes it on the CPU for
    # every chunk. Every chunk has one shape.
    embedding = demucs.transformer.create_2d_sin_embedding
    if not hasattr(embedding, "cache_info"):
        demucs.transformer.create_2d_sin_embedding = functools.lru_cache(maxsize=8)(embedding)


def _accept_half_precision(model: HTDemucs) -> None:
    # HTDemucs reads the network's output as a complex spectrogram with view_as_complex, which has no half-precision
    # form. From there on — the inverse STFT, the sum with the waveform branch — it is float32 either way.
    mask = model._mask
    model._mask = lambda z, m: mask(z, m.float())


def _get_model() -> BagOfModels:
    global _model
    if _model is None:
        model = get_model(settings.demucs_model)
        # A named model is a bag already; a bare one becomes a bag of one, so one path weighs every model's sources.
        bag = model if isinstance(model, BagOfModels) else BagOfModels([model])
        if resolve_device().type == "cuda":
            _keep_forward_on_gpu()
            for member in bag.models:
                if isinstance(member, HTDemucs):
                    _accept_half_precision(member)
        # Kept on the device for good: Demucs' own apply_model moves a bag's models there and back on every job.
        _model = bag.to(resolve_device()).eval()
    return _model


def _run_model(model: torch.nn.Module, chunk: torch.Tensor) -> torch.Tensor:
    """One (1, channels, samples) chunk through the model, as float32 whichever precision computed it."""
    if _half_precision and isinstance(model, HTDemucs):
        with torch.autocast(chunk.device.type, dtype=torch.float16):
            return model(chunk).float()
    return model(chunk)


def _finite(audio: torch.Tensor) -> bool:
    # A sum is NaN or infinite when anything under it is, and needs no mask the size of the track to find out.
    return bool(torch.isfinite(audio.sum()))


def _wait_for_gpu() -> None:
    """Sleeps until the GPU has done everything queued so far. Waiting inside CUDA instead means spinning: a whole
    core for as long as the GPU is busy, taken from the analysis and the encoders, which have work for it."""
    queued = torch.cuda.Event()
    queued.record()
    while not queued.query():
        time.sleep(_GPU_POLL_SECONDS)


class _RecordedModel:
    """An HTDemucs forward pass recorded as a CUDA graph, replayed for every chunk of one shape.

    Run directly, a chunk is thousands of GPU operations launched one at a time from Python: 70 ms of this thread's
    time for a chunk the GPU computes in 100, and every launch needs the GIL, so the analysis running beside
    separation — or anything else in the process — held each chunk up by a third or more. A replay is one launch of
    the same operations, with the same results.

    The recording stops short of the inverse STFT, which checks its window on the CPU, something a graph can't hold.
    `_ispec` is swapped for the duration of the recording for a stand-in that keeps the spectrogram it was handed and
    returns zero, which leaves the forward returning its waveform branch alone; every replay refills both, and the
    inverse STFT and the sum are then done as the forward would have done them.

    The model must have run directly, for a chunk of this shape, before it is recorded: what a forward pass builds
    once and keeps — the STFT's window and plan, the positional embedding — is built with the CPU's help."""

    def __init__(self, model: HTDemucs, shape: torch.Size):
        self._model = model
        self._device = next(model.parameters()).device
        self._chunk = torch.zeros(shape, device=self._device)
        self._graph = torch.cuda.CUDAGraph()
        model._ispec = self._keep_spectrogram
        try:
            # A graph records the current device's stream, which needn't be the model's.
            with torch.cuda.device(self._device), torch.cuda.graph(self._graph):
                self._waveform = _run_model(model, self._chunk)
        finally:
            del model._ispec

    def _keep_spectrogram(self, z: torch.Tensor, length: int | None = None, scale: int = 0) -> torch.Tensor:
        self._spectrogram = (z, length, scale)
        return z.real.new_zeros(())

    def __call__(self, chunk: torch.Tensor) -> torch.Tensor:
        with torch.cuda.device(self._device):
            self._chunk.copy_(chunk)
            self._graph.replay()
            # Asleep until the replay is done, so the inverse STFT's check finds its answer waiting.
            _wait_for_gpu()
        return self._waveform + self._model._ispec(*self._spectrogram)


def _record(model: HTDemucs, shape: torch.Size) -> _RecordedModel | None:
    """`model` recorded for chunks of `shape`. None if that fails, which also ends recording for the process."""
    global _recording
    try:
        return _RecordedModel(model, shape)
    except Exception:  # noqa: BLE001 - separation only needs the model itself, and that is still there
        logger.warning("Couldn't record the separation model as a CUDA graph; running it directly", exc_info=True)
        _recording = False
        return None


def _chunk_seconds(bag: BagOfModels, device: torch.device) -> float:
    """How long the bag's models take over one full-length chunk."""
    torch.cuda.synchronize(device)
    started = time.perf_counter()
    for model in bag.models:
        _run_model(model, torch.zeros(1, bag.audio_channels, int(model.samplerate * model.segment), device=device))
    torch.cuda.synchronize(device)
    return time.perf_counter() - started


def _settle_precision(bag: BagOfModels, device: torch.device) -> None:
    """Turns half precision on where this GPU runs the model faster in it. Cards with tensor cores do, by about a
    third; older ones compute half precision slower than float32, and are left as they were."""
    global _half_precision
    if not settings.demucs_half_precision or not any(isinstance(model, HTDemucs) for model in bag.models):
        return
    full = half = math.inf
    # Turn and turn about, so whatever else the machine is doing falls on both, and the fastest try of each: the
    # first also loads whatever kernels CUDA hasn't used yet, and a busy moment can only make a try slower.
    for _ in range(_PRECISION_TRIES):
        _half_precision = False
        full = min(full, _chunk_seconds(bag, device))
        _half_precision = True
        half = min(half, _chunk_seconds(bag, device))
    _half_precision = half < full
    logger.info(
        "A chunk separates in %.0f ms in float32 and %.0f ms in half precision; using %s",
        1000 * full,
        1000 * half,
        "half precision" if _half_precision else "float32",
    )


def _settle_recording(bag: BagOfModels, device: torch.device) -> None:
    """Turns recording on once a chunk of noise has come out of every HTDemucs in the bag the same both ways. A
    recording that can't be made, or doesn't reproduce its model — a demucs whose forward pass this file no longer
    describes — leaves chunks running through the model, and nothing replays a recording this hasn't checked."""
    global _recording
    recordable = [model for model in bag.models if isinstance(model, HTDemucs)]
    if not settings.demucs_cuda_graph or not recordable:
        return
    worst = 0.0
    for model in recordable:
        chunk = torch.randn(1, bag.audio_channels, int(model.samplerate * model.segment), device=device)
        direct = _run_model(model, chunk)
        recorded = _record(model, chunk.shape)
        if recorded is None:
            return
        worst = max(worst, float((recorded(chunk) - direct).abs().max() / direct.abs().max()))
    if worst > _RECORDING_TOLERANCE:
        logger.warning("A recorded CUDA graph is %.2g of its peak from the model; running the model directly", worst)
        return
    _recording = True
    logger.info("Separation replays a recorded CUDA graph, %.2g of its peak from the model run directly", worst)


def load_model() -> None:
    """Loads the separation model onto its device now, rather than inside the first job. On a GPU the model also runs
    once, on one chunk of silence — CUDA loads its kernels on first use, which would otherwise be the first job's
    wait — and how it will run is settled: in which precision, and whether from a recording."""
    bag = _get_model()
    device = resolve_device()
    if device.type == "cuda":
        silence = torch.zeros(bag.audio_channels, bag.samplerate, device=device)
        with torch.inference_mode():
            _separate(bag, silence, device, lambda fraction: None)
            _settle_precision(bag, device)
            _settle_recording(bag, device)
        torch.cuda.empty_cache()


def _read_window(audio: torch.Tensor, start: int, length: int) -> torch.Tensor:
    """audio[..., start:start + length], silent wherever that runs past either end — how Demucs pads a chunk."""
    end = start + length
    inside = audio[..., max(0, start) : min(audio.shape[-1], end)]
    return F.pad(inside, (max(0, -start), max(0, end - audio.shape[-1])))


def _apply_model(
    model: torch.nn.Module,
    mix: torch.Tensor,
    storage: torch.device,
    on_progress: Callable[[float], None],
    on_settled: Callable[[torch.Tensor, int], None] | None = None,
) -> torch.Tensor:
    """One Demucs model's (sources, channels, samples) for a normalized (channels, samples) mix on the model's device,
    accumulated on `storage`.

    This is Demucs' apply_model with its defaults — one random shift, overlapping chunks blended by a triangle — and
    the same arithmetic in the same order, but the overlap-add is kept where `storage` says and done in place. Demucs
    keeps it in RAM, copying every chunk back from the GPU and the whole result several times over.

    A stretch of the result is settled once the next chunk starts past it. `on_settled` is called after every chunk
    with the result so far and how many of its leading samples that is."""
    channels, length = mix.shape
    # The chunk boundaries move by a random amount every run: the mix is padded with up to half a second of silence
    # and read from a random point, and the result's head is dropped by as much.
    max_shift = int(0.5 * model.samplerate)
    shift = random.randint(0, max_shift)
    head = max_shift - shift
    padded = F.pad(mix, (max_shift, max_shift))
    shifted_length = length + max_shift - shift

    segment = int(model.samplerate * model.segment)
    stride = int((1 - settings.demucs_overlap) * segment)
    # Peaks mid-chunk, so where chunks overlap the one whose middle is nearer counts for more.
    weight = torch.cat([torch.arange(1, segment // 2 + 1), torch.arange(segment - segment // 2, 0, -1)]).to(storage)
    weight = weight / weight.max()

    out = torch.zeros(len(model.sources), channels, shifted_length, device=storage)
    total_weight = torch.zeros(shifted_length, device=storage)
    track = out[..., head:]
    settled = 0
    recorded: _RecordedModel | None = None
    for offset in range(0, shifted_length, stride):
        on_progress(offset / shifted_length)
        chunk_length = min(segment, shifted_length - offset)
        # HTDemucs runs every chunk at its training length, centred on the chunk, with the audio either side as context.
        valid_length = model.valid_length(chunk_length) if hasattr(model, "valid_length") else chunk_length
        chunk = _read_window(padded, shift + offset - (valid_length - chunk_length) // 2, valid_length)[None]
        if offset == 0 and _recording and isinstance(model, HTDemucs):
            # Made for this pass and dropped with it: a recording holds the model's working memory for as long as it
            # exists, and takes a few hundredths of a second to make.
            recorded = _record(model, chunk.shape)
        chunk_out = recorded(chunk) if recorded is not None else _run_model(model, chunk)
        chunk_out = center_trim(chunk_out[0], chunk_length).to(storage)
        out[..., offset : offset + chunk_length] += weight[:chunk_length] * chunk_out
        total_weight[offset : offset + chunk_length] += weight[:chunk_length]
        # No later chunk reaches the samples before the next one's start, so their weights are complete. Dividing
        # each stretch as it settles gives what dividing the whole track at the end did, a sample at a time.
        newly_settled = min(offset + stride, shifted_length)
        out[..., settled:newly_settled] /= total_weight[settled:newly_settled]
        settled = newly_settled
        if on_settled is not None and settled > head:
            on_settled(track, settled - head)
    return track


def _separate(
    bag: BagOfModels,
    wav: torch.Tensor,
    storage: torch.device,
    on_progress: Callable[[float], None],
    stream: "_StemStream | None" = None,
) -> torch.Tensor:
    """Every source of a (channels, samples) track at the model's rate, as (sources, channels, samples) on `storage`.
    Demucs' Separator.separate_tensor: the track normalized going in, each model's sources weighed, and the
    normalization undone. `wav` is normalized in place, which spares a copy of the track.

    `stream`, which a bag of one model can have, is fed each stretch of the track as it settles, with the weighing
    and the normalization undone for that stretch as they will be for the whole."""
    global _half_precision
    reference = wav.mean(0)
    mean, std = reference.mean(), reference.std() + 1e-8
    mix = wav.sub_(mean).div_(std)
    mean, std = mean.item(), std.item()

    estimates: torch.Tensor | None = None
    totals = [0.0] * len(bag.sources)
    for index, (model, weights) in enumerate(zip(bag.models, bag.weights)):

        def model_progress(fraction: float, index: int = index) -> None:
            on_progress((index + fraction) / len(bag.models))

        def restore(stretch: torch.Tensor, weights: list[float] = weights) -> torch.Tensor:
            # What the lines after this loop do to the track of a bag of one model, in their order.
            for source, source_weight in enumerate(weights):
                stretch[source] *= source_weight
                stretch[source] /= source_weight
            return stretch.mul_(std).add_(mean)

        on_settled = None if stream is None else (lambda track, settled: stream.feed(track, settled, restore))
        out = _apply_model(model, mix, storage, model_progress, on_settled)
        if _half_precision and not _finite(out):
            # Half precision overflows where float32 wouldn't, and some GPUs return NaN from it outright; either would
            # be written out as a stem. The model's pass is run again in float32, and so is every pass after it.
            logger.warning("Half precision returned audio that isn't finite; separating in float32 from here on")
            _half_precision = False
            if stream is not None:
                stream.restart()
            out = _apply_model(model, mix, storage, model_progress, on_settled)
        for source, source_weight in enumerate(weights):
            out[source] *= source_weight
            totals[source] += source_weight
        estimates = out if estimates is None else estimates.add_(out)
    assert estimates is not None
    for source, total in enumerate(totals):
        estimates[source] /= total
    return estimates.mul_(std).add_(mean)


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
    with open(path, "wb", buffering=_WRITE_BUFFER_BYTES) as out:
        sf.write(out, samples, sample_rate, **_FLAC_FORMAT)


def _write_stems(
    names: Sequence[str], stems: Sequence[torch.Tensor], model_rate: int, output_rate: int, directory: Path
) -> None:
    """One 16-bit FLAC per stem in `directory`, each from the whole of its stem. libsndfile encodes outside the GIL, so
    stems encode side by side while the next is converted: a thread per core, and one more for whichever is waiting on
    the disk."""
    encoders = min(len(names), (os.cpu_count() or 1) + 1)
    # A stem's samples are 140 MB for twelve minutes, so no more are converted than the encoders can take: the one
    # each is writing, and one waiting.
    unwritten = threading.Semaphore(encoders + 1)
    with ThreadPoolExecutor(max_workers=encoders) as encoder:
        writes = []
        for name, stem in zip(names, stems):
            unwritten.acquire()
            samples = _to_pcm16(stem, model_rate, output_rate)
            write = encoder.submit(_write_flac, directory / f"{name}{STEM_SUFFIX}", samples, output_rate)
            write.add_done_callback(lambda _: unwritten.release())
            writes.append(write)
        for write in writes:
            write.result()


class _StemEncoder:
    """One stem's FLAC, encoded on a thread of its own from blocks of (samples, channels) 16-bit PCM handed over in
    order. libFLAC cuts frames by sample count, not by call, so the file is the one a single write of all the blocks
    would make."""

    def __init__(self, path: Path, sample_rate: int, channels: int):
        self._blocks: queue.Queue[np.ndarray | None] = queue.Queue(maxsize=_QUEUED_STRETCHES)
        self._failure: BaseException | None = None
        self._thread = threading.Thread(
            target=self._encode, args=(path, sample_rate, channels), name=f"chord-encode-{path.stem}", daemon=True
        )
        self._thread.start()

    def _encode(self, path: Path, sample_rate: int, channels: int) -> None:
        try:
            os.setpriority(os.PRIO_PROCESS, threading.get_native_id(), _ENCODER_NICENESS)
        except (AttributeError, OSError):
            # Only Linux has a priority for one thread. Elsewhere the encoders compete as any thread does.
            pass
        ended = False
        try:
            with open(path, "wb", buffering=_WRITE_BUFFER_BYTES) as out:
                with sf.SoundFile(out, "w", sample_rate, channels, **_FLAC_FORMAT) as flac:
                    while (block := self._blocks.get()) is not None:
                        flac.write(block)
                    ended = True
        except BaseException as failure:  # noqa: BLE001 - raised by close(), on the thread that can act on it
            self._failure = failure
            # write() blocks on a full queue, so the queue is emptied until close() says there is no more.
            while not ended and self._blocks.get() is not None:
                pass

    def has_room(self) -> bool:
        """Whether write() would return at once. Only one thread writes, so the answer holds until it does."""
        return not self._blocks.full()

    def write(self, block: np.ndarray) -> None:
        self._blocks.put(block)

    def close(self) -> None:
        """Ends the file after the blocks already handed over, and raises whatever stopped the encoder, if anything."""
        self._blocks.put(None)
        self._thread.join()
        if self._failure is not None:
            raise self._failure


class _StemStream:
    """Encodes the stems while the model's pass is still running, a settled stretch at a time.

    Left to the end, converting and encoding six stems was the largest part of a GPU job that wasn't the model, and it
    waited through a pass that leaves the cores idle. A stretch here goes through what the whole stem went through
    there (`_to_pcm16`), in its order: resampled to the output rate, converted to 16-bit, encoded. The encoders run
    when nothing else wants a core, and audio they have no room for yet is left on the GPU for a later call, so a busy
    host is no slower for this: what isn't encoded by the end of the pass is encoded then, as all of it used to be.

    Two things about a stem depend on all of it. Its length at another rate, which julius rounds from the whole
    track's: so resampling goes by julius' frames — `new_sr` samples out for every `old_sr` in, each from the
    kernel's width of audio either side — and only frames whose audio has settled are produced, the track's two ends
    replicated as julius replicates them. And its peak, which decides whether the stem is scaled down to keep it from
    clipping: so stretches are encoded unscaled, which is right for a stem that never needs scaling, and a stem whose
    peak says it does is dropped from here on and encoded by `finish`, whole, as it always was."""

    def __init__(self, bag: BagOfModels, directory: Path, output_rate: int, device: torch.device):
        self._bag = bag
        self._directory = directory
        self._output_rate = output_rate
        self._limit = _STRETCH_SECONDS * bag.samplerate
        # None where the stems stay at the model's rate.
        self._resampler: julius.ResampleFrac | None = None
        if output_rate != bag.samplerate:
            self._resampler = julius.ResampleFrac(bag.samplerate, output_rate).to(device)
        self._encoders: list[_StemEncoder] = []
        self.restart()

    def _path(self, name: str) -> Path:
        return self._directory / f"{name}{STEM_SUFFIX}"

    def restart(self) -> None:
        """Drops whatever has been encoded and starts every file again, for a pass that is being run again."""
        self.abandon()
        self._encoders = [
            _StemEncoder(self._path(name), self._output_rate, self._bag.audio_channels) for name in self._bag.sources
        ]
        # In the model's samples without a resampler, in julius' frames with one.
        self._taken = 0
        self._written = 0
        self._peaks: torch.Tensor | None = None
        # The stems, by index, that have to be scaled, and so encoded whole.
        self._scaled: set[int] = set()

    def _take(self, track: torch.Tensor, settled: int, restore: _Restore) -> torch.Tensor | None:
        """The next stretch of settled audio not yet taken, restored and at the output rate; None once it all is."""
        length = track.shape[-1]
        if self._resampler is None:
            first, last = self._taken, min(settled, self._taken + self._limit)
            if last <= first:
                return None
            self._taken = last
            return restore(track[..., first:last].clone())

        old, new, width = self._resampler.old_sr, self._resampler.new_sr, self._resampler._width
        # The length julius gives the whole stem, computed as julius computes it — in float32, which above 2**24
        # samples is not always the exact floor.
        total = int(torch.floor(torch.as_tensor(new * length / old)))
        frames = -(-total // new)
        # A frame is made from its own old_sr samples and the kernel's width either side.
        ready = frames if settled == length else min(frames, max(0, (settled - width) // old))
        ready = min(ready, self._taken + self._limit // old)
        if ready <= self._taken:
            return None
        first, last = old * self._taken - width, old * ready + width
        self._taken = ready
        stretch = restore(track[..., max(0, first) : min(length, last)].clone())
        missing = (max(0, -first), max(0, last - length))
        stretch = F.pad(stretch.reshape(-1, 1, stretch.shape[-1]), missing, mode="replicate")
        stretch = F.conv1d(stretch, self._resampler.kernel, stride=old).transpose(1, 2)
        return stretch.reshape(*track.shape[:-1], -1)[..., : total - self._written]

    def _has_room(self) -> bool:
        return all(encoder.has_room() for index, encoder in enumerate(self._encoders) if index not in self._scaled)

    def feed(self, track: torch.Tensor, settled: int, restore: _Restore, wait: bool = False) -> None:
        """Encodes what has settled of `track` — (sources, channels, samples) at the model's rate, its first `settled`
        samples final — and hasn't been taken yet, as far as the encoders have room for it, or all of it if `wait`.
        `restore` undoes, in place, the normalization the track is still in."""
        while len(self._scaled) < len(self._encoders) and (wait or self._has_room()):
            stretch = self._take(track, settled, restore)
            if stretch is None:
                return
            self._written += stretch.shape[-1]
            peaks = stretch.abs().amax(dim=(1, 2))
            self._peaks = peaks if self._peaks is None else torch.maximum(self._peaks, peaks)
            # The test _to_pcm16 makes of a whole stem's peak, in its arithmetic. A peak only grows, so a stem that
            # fails it now will fail it whole.
            self._scaled.update(index for index, scale in enumerate((1.01 * self._peaks).tolist()) if scale > 1)
            # libsndfile's scale, rounding and clamp for float written as 16-bit, as in _to_pcm16.
            pcm = stretch.mul_(32768).round_().clamp_(-32768, 32767).to(torch.int16)
            blocks = pcm.permute(0, 2, 1).contiguous().cpu().numpy()
            for index, encoder in enumerate(self._encoders):
                if index not in self._scaled:
                    encoder.write(blocks[index])

    def finish(self, stems: torch.Tensor) -> None:
        """Completes the files from `stems`, the whole track, restored: whatever of it the encoders haven't been given,
        and every stem that has to be scaled."""
        self.feed(stems, stems.shape[-1], lambda stretch: stretch, wait=True)
        self._close()
        scaled = sorted(self._scaled)
        if scaled:
            names = [self._bag.sources[index] for index in scaled]
            whole = [stems[index] for index in scaled]
            _write_stems(names, whole, self._bag.samplerate, self._output_rate, self._directory)

    def _close(self) -> None:
        encoders, self._encoders = self._encoders, []
        failures = []
        for encoder in encoders:
            try:
                encoder.close()
            except BaseException as failure:  # noqa: BLE001 - every file is closed before the first failure is raised
                failures.append(failure)
        if failures:
            raise failures[0]

    def abandon(self) -> None:
        """Closes whatever files are open, for a pass that won't be finished. What is in them doesn't matter."""
        try:
            self._close()
        except Exception:  # noqa: BLE001 - the pass is already failing or starting over, and says why itself
            logger.debug("A stem's encoder failed in a pass that was abandoned", exc_info=True)


def _separate_into(
    directory: Path, input_path: Path, bag: BagOfModels, device: torch.device, on_progress: Callable[[float], None]
) -> None:
    """One 16-bit FLAC per stem of input_path, in `directory`. The track and its stems are this function's alone, so
    that they are gone when it returns."""
    wav, source_rate = _read_audio(input_path, bag, device)
    storage = _storage_device(device, len(bag.sources), wav)
    output_rate = source_rate if source_rate in _PRESERVED_SAMPLE_RATES else bag.samplerate
    # Stems are encoded during the pass where it leaves both the audio and the cores within reach: one model, so a
    # stretch is final when its chunks are done, and a GPU holding the track. A bag of several models settles nothing
    # until the last one has run, and on a CPU the pass is using the cores.
    stream: _StemStream | None = None
    if storage.type == "cuda" and len(bag.models) == 1:
        stream = _StemStream(bag, directory, output_rate, storage)
    try:
        stems = _separate(bag, wav, storage, on_progress, stream)
        del wav
        if stream is None:
            _write_stems(bag.sources, stems, bag.samplerate, output_rate, directory)
        else:
            stream.finish(stems)
    finally:
        if stream is not None:
            stream.abandon()


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
            _separate_into(partial_dir, input_path, bag, device, on_progress or (lambda _: None))
    finally:
        # The allocator would otherwise hold the largest track's memory on the GPU between jobs, away from the desktop
        # and every other program sharing it. It can only hand back what nothing refers to any more, which is why the
        # track lives and dies inside _separate_into: emptied with the stems still in scope here, the cache kept them.
        if device.type == "cuda":
            torch.cuda.empty_cache()

    shutil.rmtree(output_dir, ignore_errors=True)
    partial_dir.rename(output_dir)
    return list(bag.sources)
