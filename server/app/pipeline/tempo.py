import librosa
import numpy as np

_WARM_UP_RATE = 44100

# librosa's own defaults: the onset envelope's STFT, the width tempo estimation autocorrelates over, and the tempo its
# prior is centred on. They are spelled out because the estimate is assembled here a block at a time.
_N_FFT = 2048
_HOP_LENGTH = 512
_AUTOCORRELATION_SECONDS = 8.0
_START_BPM = 120.0

# Frames of spectrogram, and of tempogram, worked on at once: tens of megabytes either way, whatever the track's length.
_SPECTROGRAM_BLOCK_FRAMES = 2048
_TEMPOGRAM_BLOCK_FRAMES = 512


def _window(samples: np.ndarray, start: int, length: int) -> np.ndarray:
    """samples[start:start + length] as float32 in [-1, 1], silent wherever that runs past either end — the zeros
    librosa's STFT pads a centred frame with."""
    end = start + length
    inside = np.array(samples[max(0, start) : min(len(samples), end)], dtype=np.float32)
    if np.issubdtype(samples.dtype, np.integer):
        inside /= np.iinfo(samples.dtype).max
    return np.pad(inside, (max(0, -start), max(0, end - len(samples))))


def _onset_envelope(samples: np.ndarray, sample_rate: int) -> np.ndarray:
    """librosa.onset.onset_strength(y, sr, aggregate=np.median), the envelope librosa's beat tracker takes its tempo
    from, with the mel spectrogram under it built a block of frames at a time. Each frame is the one librosa computes,
    so the envelope is the same to the bit."""
    frames = 1 + len(samples) // _HOP_LENGTH
    blocks = []
    for first in range(0, frames, _SPECTROGRAM_BLOCK_FRAMES):
        count = min(_SPECTROGRAM_BLOCK_FRAMES, frames - first)
        # Frame k of a centred STFT covers the samples half a window either side of k hops.
        audio = _window(samples, first * _HOP_LENGTH - _N_FFT // 2, (count - 1) * _HOP_LENGTH + _N_FFT)
        blocks.append(
            librosa.feature.melspectrogram(
                y=audio, sr=sample_rate, n_fft=_N_FFT, hop_length=_HOP_LENGTH, center=False, fmax=0.5 * sample_rate
            )
        )
    spectrogram = librosa.power_to_db(np.concatenate(blocks, axis=-1))
    return librosa.onset.onset_strength(S=spectrogram, sr=sample_rate, hop_length=_HOP_LENGTH, aggregate=np.median)


def _mean_tempogram(onset_envelope: np.ndarray, sample_rate: int) -> np.ndarray:
    """The mean over time of librosa.feature.tempogram(onset_envelope, win_length=8 s): one autocorrelation per frame,
    each normalized to its own peak, which is what librosa.feature.tempo averages to find one tempo for a track. Summed
    a block at a time, so only the last bits of the mean can differ from librosa's."""
    window = librosa.time_to_frames(_AUTOCORRELATION_SECONDS, sr=sample_rate, hop_length=_HOP_LENGTH).item()
    frames = onset_envelope.shape[-1]
    # How tempogram centres a window on every frame: the envelope ramps to zero over half a window at either end.
    padded = np.pad(onset_envelope, window // 2, mode="linear_ramp", end_values=[0, 0])
    total = np.zeros((window, 1))
    for first in range(0, frames, _TEMPOGRAM_BLOCK_FRAMES):
        count = min(_TEMPOGRAM_BLOCK_FRAMES, frames - first)
        block = librosa.feature.tempogram(
            onset_envelope=padded[first : first + count - 1 + window],
            sr=sample_rate,
            hop_length=_HOP_LENGTH,
            win_length=window,
            center=False,
        )
        total += block.sum(axis=-1, keepdims=True)
    return total / frames


def detect_tempo(samples: np.ndarray, sample_rate: int) -> float:
    """Estimate tempo (BPM) from the full mix. `samples` is mono, float or integer PCM.

    This is the tempo `librosa.beat.beat_track` reports, without the beat positions it goes on to track, which nothing
    reads. librosa builds the whole track's spectrogram and then one autocorrelation window per frame at once — over
    a gigabyte for a six-minute track, growing with its length, beside a separation that needs the memory. Here both are
    built in blocks and only their small results kept.

    Kept at the source rate: at half of it the onset envelope has half the frames, and the estimate coarsens by
    enough to make the metronome drift."""
    onset_envelope = _onset_envelope(samples, sample_rate)
    # A track with no onsets at all has no tempo; beat_track answers 0 for it before estimating anything.
    if not onset_envelope.any():
        return 0.0
    tempo = librosa.feature.tempo(
        tg=_mean_tempogram(onset_envelope, sample_rate),
        sr=sample_rate,
        hop_length=_HOP_LENGTH,
        start_bpm=_START_BPM,
        aggregate=None,
    )
    return round(float(np.atleast_1d(tempo)[0]), 1)


def warm_up() -> None:
    """Estimates the tempo of two seconds of noise. librosa imports its submodules on first use and numba compiles
    their vectorized helpers then, which would otherwise be the first job's wait; silence would stop short of the
    tempogram, having no onsets."""
    scale = 0.1 * np.iinfo(np.int16).max
    noise = (np.random.default_rng(0).standard_normal(2 * _WARM_UP_RATE) * scale).astype(np.int16)
    detect_tempo(noise, _WARM_UP_RATE)
