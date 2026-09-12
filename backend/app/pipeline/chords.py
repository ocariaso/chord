import re
from pathlib import Path

from madmom.features.chords import CNNChordFeatureProcessor, CRFChordRecognitionProcessor
from madmom.features.key import CNNKeyRecognitionProcessor, key_prediction_to_label

from app.models.schemas import ChordSegment, KeyEstimate

NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]

# madmom's key model names some keys with flats (e.g. "Db major"); the rest of the
# app only deals in sharps, so normalize to the enharmonic sharp spelling on the way in.
_FLAT_TO_SHARP = {"Cb": "B", "Db": "C#", "Eb": "D#", "Fb": "E", "Gb": "F#", "Ab": "G#", "Bb": "A#"}

_ROOT_RE = re.compile(r"^([A-G][#b]?)")


def _normalize_root(root: str) -> str:
    return _FLAT_TO_SHARP.get(root, root)


_chord_feature_processor: CNNChordFeatureProcessor | None = None
_chord_decode_processor: CRFChordRecognitionProcessor | None = None
_key_processor: CNNKeyRecognitionProcessor | None = None


def _chord_root(label: str) -> str | None:
    match = _ROOT_RE.match(label)
    return _normalize_root(match.group(1)) if match else None


def _madmom_label_to_chord(label: str) -> str:
    """Convert madmom's "C#:min" style label to our "C#m" convention."""
    if label == "N":
        return "N"
    root, _, quality = label.partition(":")
    root = _normalize_root(root)
    if quality == "maj":
        return root
    if quality == "min":
        return f"{root}m"
    return f"{root}{quality}"


def _get_chord_processors() -> tuple[CNNChordFeatureProcessor, CRFChordRecognitionProcessor]:
    global _chord_feature_processor, _chord_decode_processor
    if _chord_feature_processor is None:
        _chord_feature_processor = CNNChordFeatureProcessor()
        _chord_decode_processor = CRFChordRecognitionProcessor()
    return _chord_feature_processor, _chord_decode_processor


def _get_key_processor() -> CNNKeyRecognitionProcessor:
    global _key_processor
    if _key_processor is None:
        _key_processor = CNNKeyRecognitionProcessor()
    return _key_processor


def _resolve_relative_ambiguity(key_estimate: KeyEstimate, segments: list[ChordSegment]) -> KeyEstimate:
    """Break major/relative-minor ties using which tonic chord actually dominates."""
    root_index = NOTE_NAMES.index(key_estimate.key)
    if key_estimate.mode == "major":
        relative_index, relative_mode = (root_index - 3) % 12, "minor"
    else:
        relative_index, relative_mode = (root_index + 3) % 12, "major"

    def total_duration(note: str) -> float:
        return sum(s.end - s.start for s in segments if _chord_root(s.chord) == note)

    original_weight = total_duration(NOTE_NAMES[root_index])
    relative_weight = total_duration(NOTE_NAMES[relative_index])

    if relative_weight > original_weight:
        return KeyEstimate(key=NOTE_NAMES[relative_index], mode=relative_mode, confidence=key_estimate.confidence)
    return key_estimate


def analyze_audio(audio_path: Path) -> tuple[list[ChordSegment], KeyEstimate]:
    feature_proc, decode_proc = _get_chord_processors()
    features = feature_proc(str(audio_path))
    raw_chords = decode_proc(features)
    segments = [
        ChordSegment(start=float(start), end=float(end), chord=_madmom_label_to_chord(label), confidence=1.0)
        for start, end, label in raw_chords
    ]

    prediction = _get_key_processor()(str(audio_path))
    key_name, mode = key_prediction_to_label(prediction).rsplit(" ", 1)
    key_estimate = KeyEstimate(key=_normalize_root(key_name), mode=mode, confidence=float(prediction.max()))
    key_estimate = _resolve_relative_ambiguity(key_estimate, segments)

    return segments, key_estimate
