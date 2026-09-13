import logging
import queue
import threading

from app.pipeline.pipeline import run_job

logger = logging.getLogger(__name__)

job_queue: "queue.Queue[str]" = queue.Queue()
_worker_thread: threading.Thread | None = None


def enqueue(job_id: str) -> None:
    job_queue.put(job_id)


def _consume() -> None:
    while True:
        job_id = job_queue.get()
        try:
            run_job(job_id)
        except Exception:  # noqa: BLE001 - run_job already records failures on the job row
            logger.exception("Unhandled error processing job %s", job_id)
        finally:
            job_queue.task_done()


def start_worker() -> None:
    global _worker_thread
    if _worker_thread is None:
        _worker_thread = threading.Thread(target=_consume, daemon=True, name="chord-job-worker")
        _worker_thread.start()
