from __future__ import annotations

from typing import Any, Dict, Optional, Union

from .events import EventBus
from .models import JobStatus
from .store import JobStore


class ProgressReporter:
    def __init__(self, job_id: str, store: JobStore, event_bus: EventBus) -> None:
        self._job_id = job_id
        self._store = store
        self._event_bus = event_bus

    async def status(
        self,
        stage: Union[JobStatus, str],
        progress: float,
        message: str,
        payload: Optional[Dict[str, Any]] = None,
    ) -> None:
        stage_value = stage.value if isinstance(stage, JobStatus) else str(stage)
        status = None
        if isinstance(stage, JobStatus):
            status = stage
        else:
            try:
                status = JobStatus(stage_value)
            except ValueError:
                status = None
        fields: Dict[str, Any] = {
            "stage": stage_value,
            "progress": progress,
            "message": message,
        }
        if status is not None:
            fields["status"] = status
        job = self._store.update_job(self._job_id, **fields)
        if not job:
            return
        data: Dict[str, Any] = {
            "job_id": self._job_id,
            "status": job.status.value,
            "stage": job.stage,
            "progress": job.progress,
            "message": job.message,
        }
        if payload is not None:
            data["payload"] = payload
        await self._event_bus.publish(self._job_id, "status", data)
        if job.status == JobStatus.DONE:
            await self._event_bus.publish(self._job_id, "done", data)
        elif job.status == JobStatus.FAILED:
            await self._event_bus.publish(self._job_id, "failed", data)

    async def log(self, line: str) -> None:
        job = self._store.append_log(self._job_id, line)
        if not job:
            return
        data = {"job_id": self._job_id, "line": line}
        await self._event_bus.publish(self._job_id, "log", data)

    async def asset(
        self,
        kind: str,
        url_or_path: str,
        meta: Optional[Dict[str, Any]] = None,
    ) -> None:
        job = self._store.set_asset(self._job_id, kind, url_or_path, meta)
        if not job:
            return
        data: Dict[str, Any] = {"job_id": self._job_id, "kind": kind, "value": url_or_path}
        if meta is not None:
            data["meta"] = meta
        await self._event_bus.publish(self._job_id, "asset", data)
