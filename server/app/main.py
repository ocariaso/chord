import logging
import os
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api import routes_analysis, routes_jobs, routes_stems
from app.core.config import settings
from app.db.database import init_db
from app.pipeline.reaper import start_reaper
from app.pipeline.worker import start_worker

os.environ.setdefault("TORCH_HOME", str(settings.models_cache_dir))

# Uvicorn configures only its own loggers, and the pipeline's step timings are INFO, which the root logger's
# WARNING default would drop.
logging.basicConfig(format="%(asctime)s %(levelname)s %(name)s: %(message)s")
logging.getLogger("app").setLevel(logging.INFO)


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    start_worker()
    start_reaper()
    yield


app = FastAPI(title="CHORD API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(routes_jobs.router)
app.include_router(routes_stems.router)
app.include_router(routes_analysis.router)


@app.get("/health")
async def health() -> dict:
    return {"status": "ok"}
