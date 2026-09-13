from pathlib import Path

from pydantic_settings import BaseSettings

SERVER_DIR = Path(__file__).resolve().parents[2]


class Settings(BaseSettings):
    data_dir: Path = SERVER_DIR / "data"
    db_path: Path = SERVER_DIR / "data" / "db.sqlite3"
    jobs_dir: Path = SERVER_DIR / "data" / "jobs"
    models_cache_dir: Path = SERVER_DIR / "data" / "models_cache"

    demucs_model: str = "htdemucs_6s"
    device: str = "cuda"

    enable_chord_detection: bool = True

    # Longer tracks are refused before separation: six decoded stems of a long mix outgrow what a
    # browser tab can hold. The landing page's "up to 12 minutes" copy assumes the default; 0 disables.
    max_duration_seconds: float = 720

    cors_origins: list[str] = ["http://localhost:5173"]


settings = Settings()
settings.jobs_dir.mkdir(parents=True, exist_ok=True)
settings.models_cache_dir.mkdir(parents=True, exist_ok=True)
