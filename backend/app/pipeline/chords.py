from pathlib import Path
from typing import Protocol

import librosa
import numpy as np
import soundfile as sf

from app.models.schemas import ChordSegment, KeyEstimate

NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]

# Krumhansl-Kessler key profiles.
_MAJOR_PROFILE = np.array([6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88])
_MINOR_PROFILE = np.array([6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17])

HARMONIC_STEMS = ["bass", "other", "vocals"]


def _build_triad_templates() -> tuple[list[str], np.ndarray]:
    labels: list[str] = []
    templates: list[np.ndarray] = []
    for root in range(12):
        for quality, intervals in (("maj", (0, 4, 7)), ("min", (0, 3, 7))):
            template = np.zeros(12)
            for interval in intervals:
                template[(root + interval) % 12] = 1.0
            templates.append(template / np.linalg.norm(template))
            labels.append(f"{NOTE_NAMES[root]}{'' if quality == 'maj' else 'm'}")
    labels.append("N")
    templates.append(np.zeros(12))
    return labels, np.array(templates)


_CHORD_LABELS, _CHORD_TEMPLATES = _build_triad_templates()
_SILENCE_INDEX = len(_CHORD_LABELS) - 1


class ChordDetector(Protocol):
    def analyze(self, y: np.ndarray, sr: int) -> tuple[list[ChordSegment], KeyEstimate]:
        ...


class LibrosaTemplateChordDetector:
    """Chroma + triad-template chord detection with Viterbi smoothing."""

    hop_length = 2048

    def analyze(self, y: np.ndarray, sr: int) -> tuple[list[ChordSegment], KeyEstimate]:
        chroma = librosa.feature.chroma_cqt(y=y, sr=sr, hop_length=self.hop_length)
        chroma = librosa.decompose.nn_filter(chroma, aggregate=np.median, metric="cosine")

        rms = librosa.feature.rms(y=y, hop_length=self.hop_length)[0]
        silence_mask = rms < (0.05 * rms.max() if rms.max() > 0 else 0)

        norms = np.linalg.norm(chroma, axis=0, keepdims=True)
        norms[norms == 0] = 1.0
        chroma_normed = chroma / norms

        similarity = _CHORD_TEMPLATES[:-1] @ chroma_normed  # (24, T)
        probs = np.vstack([similarity, np.zeros((1, similarity.shape[1]))])
        probs = np.clip(probs, 0, None)
        probs[_SILENCE_INDEX, silence_mask] = probs.max(axis=0)[silence_mask] + 0.1
        col_sums = probs.sum(axis=0, keepdims=True)
        col_sums[col_sums == 0] = 1.0
        probs = probs / col_sums

        n_states = len(_CHORD_LABELS)
        self_transition = 0.92
        transition = np.full((n_states, n_states), (1 - self_transition) / (n_states - 1))
        np.fill_diagonal(transition, self_transition)

        state_sequence = librosa.sequence.viterbi(probs, transition)

        times = librosa.frames_to_time(np.arange(len(state_sequence)), sr=sr, hop_length=self.hop_length)
        segments = self._collapse_segments(state_sequence, times, probs)

        key_estimate = self._estimate_key(chroma_normed)
        return segments, key_estimate

    def _collapse_segments(
        self, state_sequence: np.ndarray, times: np.ndarray, probs: np.ndarray
    ) -> list[ChordSegment]:
        segments: list[ChordSegment] = []
        start_idx = 0
        for i in range(1, len(state_sequence) + 1):
            if i == len(state_sequence) or state_sequence[i] != state_sequence[start_idx]:
                state = state_sequence[start_idx]
                end_time = float(times[i]) if i < len(times) else float(times[-1]) + (times[-1] - times[-2] if len(times) > 1 else 0.0)
                confidence = float(np.mean(probs[state, start_idx:i]))
                segments.append(
                    ChordSegment(
                        start=float(times[start_idx]),
                        end=end_time,
                        chord=_CHORD_LABELS[state],
                        confidence=confidence,
                    )
                )
                start_idx = i
        return segments

    def _estimate_key(self, chroma_normed: np.ndarray) -> KeyEstimate:
        mean_chroma = chroma_normed.mean(axis=1)
        best_key, best_mode, best_score = "C", "major", -1.0
        for root in range(12):
            for mode, profile in (("major", _MAJOR_PROFILE), ("minor", _MINOR_PROFILE)):
                rotated = np.roll(profile, root)
                score = float(np.corrcoef(mean_chroma, rotated)[0, 1])
                if score > best_score:
                    best_key, best_mode, best_score = NOTE_NAMES[root], mode, score
        return KeyEstimate(key=best_key, mode=best_mode, confidence=max(best_score, 0.0))


def get_chord_detector() -> ChordDetector:
    return LibrosaTemplateChordDetector()


def load_harmonic_bed(stems_dir: Path) -> tuple[np.ndarray, int]:
    """Sum bass+other+vocals (drums excluded) to reduce percussive chroma noise."""
    tracks: list[np.ndarray] = []
    sr = 0
    for name in HARMONIC_STEMS:
        y, sr = sf.read(stems_dir / f"{name}.wav", always_2d=False)
        if y.ndim > 1:
            y = y.mean(axis=1)
        tracks.append(y)
    if not tracks:
        raise FileNotFoundError(f"No harmonic stems found in {stems_dir}")
    min_len = min(len(t) for t in tracks)
    mix = sum(t[:min_len] for t in tracks)
    return mix, sr


def analyze_stems(stems_dir: Path) -> tuple[list[ChordSegment], KeyEstimate]:
    y, sr = load_harmonic_bed(stems_dir)
    detector = get_chord_detector()
    return detector.analyze(y, sr)
