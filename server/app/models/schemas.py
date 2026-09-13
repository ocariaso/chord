from enum import Enum

from pydantic import BaseModel, Field


class JobStatus(str, Enum):
    QUEUED = "queued"
    FETCHING = "fetching"
    SEPARATING = "separating"
    ANALYZING = "analyzing"
    DONE = "done"
    ERROR = "error"
    CANCELLED = "cancelled"


TERMINAL_STATUSES = {JobStatus.DONE.value, JobStatus.ERROR.value, JobStatus.CANCELLED.value}


class ChordSegment(BaseModel):
    start: float
    end: float
    chord: str
    confidence: float


class KeyEstimate(BaseModel):
    key: str
    mode: str
    confidence: float


class LyricsLine(BaseModel):
    time: float
    text: str


class LyricsResponse(BaseModel):
    synced: list[LyricsLine] | None = None
    plain: str | None = None


class SaveLyricsRequest(BaseModel):
    text: str = Field(max_length=100_000)


class CreateJobFromUrlRequest(BaseModel):
    url: str


class JobResponse(BaseModel):
    id: str
    original_filename: str
    author: str | None = None
    status: JobStatus
    progress: float
    stage_message: str | None = None
    error_message: str | None = None
    error_log: str | None = None
    stems_model: str | None = None
    duration_seconds: float | None = None
    audio_format: str | None = None
    key_estimate: str | None = None
    key_confidence: float | None = None
    tempo_bpm: float | None = None
    created_at: str
    updated_at: str
    stem_names: list[str] = []
    has_thumbnail: bool = False


STEM_NAMES = ["vocals", "drums", "bass", "guitar", "piano", "other"]
