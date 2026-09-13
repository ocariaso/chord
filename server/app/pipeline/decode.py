from pathlib import Path

from madmom.audio.signal import Signal

# madmom's chord and key models both read mono at 44.1 kHz, and their SignalProcessor passes a Signal already in
# that shape through untouched — so one decode serves chords, key and tempo in place of three.
SAMPLE_RATE = 44100


def decode_mono(audio_path: Path) -> Signal:
    """The whole file as a mono Signal at SAMPLE_RATE, decoded by ffmpeg."""
    return Signal(str(audio_path), sample_rate=SAMPLE_RATE, num_channels=1)
