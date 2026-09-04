from pathlib import Path

from pydantic_settings import BaseSettings

BACKEND_DIR = Path(__file__).resolve().parents[2]


class Settings(BaseSettings):
    data_dir: Path = BACKEND_DIR / "data"
    db_path: Path = BACKEND_DIR / "data" / "db.sqlite3"
    jobs_dir: Path = BACKEND_DIR / "data" / "jobs"
    models_cache_dir: Path = BACKEND_DIR / "data" / "models_cache"

    demucs_model: str = "htdemucs_6s"
    device: str = "cuda"

    # Chord/key detection is on hold while separation is validated first.
    enable_chord_detection: bool = False

    cors_origins: list[str] = ["http://localhost:5173"]


settings = Settings()
settings.jobs_dir.mkdir(parents=True, exist_ok=True)
settings.models_cache_dir.mkdir(parents=True, exist_ok=True)
