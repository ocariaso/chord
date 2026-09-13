import math


class UserFacingError(Exception):
    """Raised with a message written for the person using CHORD; run_job shows it verbatim.

    Chain the underlying exception (`raise ... from exc`) and its text becomes the job's log."""


class TrackTooLongError(UserFacingError):
    def __init__(self, duration_seconds: float, limit_seconds: float):
        # Rounded up: truncating would describe a track a moment over the limit as exactly the limit.
        minutes, seconds = divmod(math.ceil(duration_seconds), 60)
        super().__init__(
            f"This track is {minutes}:{seconds:02d} long. "
            f"CHORD separates tracks up to {limit_seconds / 60:g} minutes."
        )
