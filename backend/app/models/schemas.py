from enum import Enum

from pydantic import BaseModel


class JobStatus(str, Enum):
    QUEUED = "queued"
    FETCHING = "fetching"
    SEPARATING = "separating"
    ANALYZING = "analyzing"
    DONE = "done"
    ERROR = "error"
    CANCELLED = "cancelled"


class ChordSegment(BaseModel):
    start: float
    end: float
    chord: str
    confidence: float


class KeyEstimate(BaseModel):
    key: str
    mode: str
    confidence: float


class CreateJobFromUrlRequest(BaseModel):
    url: str


class JobResponse(BaseModel):
    id: str
    original_filename: str
    status: JobStatus
    progress: float
    stage_message: str | None = None
    error_message: str | None = None
    stems_model: str | None = None
    duration_seconds: float | None = None
    key_estimate: str | None = None
    key_confidence: float | None = None
    tempo_bpm: float | None = None
    created_at: str
    updated_at: str
    stem_names: list[str] = []


STEM_NAMES = ["vocals", "drums", "bass", "guitar", "piano", "other"]
