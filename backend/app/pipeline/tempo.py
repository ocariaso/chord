from pathlib import Path

import librosa


def detect_tempo(audio_path: Path) -> float:
    """Estimate tempo (BPM) from the full mix using librosa's beat tracker."""
    y, sr = librosa.load(audio_path, sr=None, mono=True)
    tempo, _ = librosa.beat.beat_track(y=y, sr=sr)
    return round(float(tempo[0]), 1)
