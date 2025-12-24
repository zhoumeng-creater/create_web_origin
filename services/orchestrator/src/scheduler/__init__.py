from importlib import import_module

from .events import EVENT_BUS, EventBus
from .models import Job, JobStatus
from .reporter import ProgressReporter
from .store import JOB_STORE, JobStore

__all__ = [
    "EVENT_BUS",
    "GPU_SEMAPHORE",
    "JOB_QUEUE",
    "JOB_STORE",
    "EventBus",
    "Job",
    "JobStatus",
    "JobStore",
    "ProgressReporter",
    "enqueue_job",
    "worker_loop",
]

_LAZY_WORKER_EXPORTS = {
    "GPU_SEMAPHORE",
    "JOB_QUEUE",
    "enqueue_job",
    "worker_loop",
}


def __getattr__(name: str) -> object:
    if name in _LAZY_WORKER_EXPORTS:
        module = import_module(f"{__name__}.worker")
        return getattr(module, name)
    raise AttributeError(f"module '{__name__}' has no attribute '{name}'")
