import librosa
import numpy as np

_WARM_UP_RATE = 22050


def detect_tempo(samples: np.ndarray, sample_rate: int) -> float:
    """Estimate tempo (BPM) from the full mix using librosa's beat tracker. `samples` is mono, float or integer PCM.

    Kept at the source rate: at half of it the onset envelope has half the frames, and the estimate coarsens by
    enough to make the metronome drift."""
    y = np.asarray(samples, dtype=np.float32)
    if np.issubdtype(samples.dtype, np.integer):
        y /= np.iinfo(samples.dtype).max
    tempo, _ = librosa.beat.beat_track(y=y, sr=sample_rate)
    return round(float(np.atleast_1d(tempo)[0]), 1)


def warm_up() -> None:
    """Runs the beat tracker once on two seconds of noise. numba compiles it on first use in every process, which takes
    longer than tracking a whole song; silence would skip the compiled path, having no onsets to track."""
    detect_tempo(np.random.default_rng(0).standard_normal(2 * _WARM_UP_RATE).astype(np.float32) * 0.1, _WARM_UP_RATE)
