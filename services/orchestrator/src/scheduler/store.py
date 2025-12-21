from __future__ import annotations

import json
import threading
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional
from uuid import uuid4

from .models import Job, JobStatus
from ..config.runtime import get_runtime_paths
from ..storage.job_fs import ensure_job_dirs, write_uir
from ..storage.manifest import make_asset_url, write_manifest
from ..uir import parse_uir, stable_hash

_TERMINAL_STATUSES = {JobStatus.DONE, JobStatus.FAILED, JobStatus.CANCELED}


def _now() -> datetime:
    return datetime.now(timezone.utc)


class JobStore:
    def __init__(self, max_log_lines: int = 200) -> None:
        self._jobs: Dict[str, Job] = {}
        self._lock = threading.Lock()
        self._max_log_lines = max_log_lines

    def create_job(self, uir: Dict[str, Any]) -> Job:
        uir_model = parse_uir(uir)
        uir_payload = json.loads(uir_model.json(by_alias=True, exclude_none=True))
        job_id = uuid4().hex
        job_section = uir_payload.get("job")
        if isinstance(job_section, dict):
            job_section["id"] = job_id
        uir_digest = stable_hash(uir_payload)
        job = Job(
            job_id=job_id,
            uir=uir_payload,
            uir_hash=uir_digest,
            status=JobStatus.QUEUED,
        )
        runtime_paths = get_runtime_paths()
        job_dir = ensure_job_dirs(runtime_paths.assets_dir, job_id)
        write_uir(job_dir, uir_payload)
        write_manifest(job_dir, uir_payload, job.status.value, [], [])
        job.manifest_path = str(job_dir / "manifest.json")
        job.manifest_url = make_asset_url(job_id, "manifest.json")
        with self._lock:
            self._jobs[job_id] = job
        return job

    def get_job(self, job_id: str) -> Optional[Job]:
        with self._lock:
            return self._jobs.get(job_id)

    def list_jobs(self, status: Optional[JobStatus] = None) -> List[Job]:
        with self._lock:
            if status is None:
                return list(self._jobs.values())
            return [job for job in self._jobs.values() if job.status == status]

    def update_job(self, job_id: str, **fields: Any) -> Optional[Job]:
        with self._lock:
            job = self._jobs.get(job_id)
            if not job:
                return None
            for key, value in fields.items():
                if key == "status":
                    if isinstance(value, str):
                        value = JobStatus(value)
                    if not isinstance(value, JobStatus):
                        raise ValueError(f"Invalid status: {value!r}")
                    job.status = value
                    if "stage" not in fields:
                        job.stage = value.value
                    if job.started_at is None and value != JobStatus.QUEUED:
                        job.started_at = _now()
                    if value in _TERMINAL_STATUSES and job.ended_at is None:
                        job.ended_at = _now()
                    continue
                if key == "progress" and isinstance(value, (int, float)):
                    value = max(0.0, min(1.0, float(value)))
                if hasattr(job, key):
                    setattr(job, key, value)
            return job

    def append_log(self, job_id: str, line: str) -> Optional[Job]:
        with self._lock:
            job = self._jobs.get(job_id)
            if not job:
                return None
            job.logs.append(line)
            overflow = len(job.logs) - self._max_log_lines
            if overflow > 0:
                del job.logs[:overflow]
            return job

    def set_asset(
        self,
        job_id: str,
        kind: str,
        value: Any,
        meta: Optional[Dict[str, Any]] = None,
    ) -> Optional[Job]:
        with self._lock:
            job = self._jobs.get(job_id)
            if not job:
                return None
            assets = dict(job.assets)
            _assign_asset(assets, kind, value, meta)
            job.assets = assets
            return job

    def cancel_job(self, job_id: str, message: str = "canceled") -> Optional[Job]:
        return self.update_job(job_id, status=JobStatus.CANCELED, message=message)


JOB_STORE = JobStore()


def _assign_asset(
    assets: Dict[str, Any],
    kind: str,
    value: Any,
    meta: Optional[Dict[str, Any]],
) -> None:
    parts = kind.split(".", 1)
    if len(parts) == 2:
        category, field = parts
        bucket = assets.get(category)
        if not isinstance(bucket, dict):
            bucket = {}
        bucket[field] = value
        if meta:
            bucket.update(meta)
        assets[category] = bucket
        return
    if meta:
        entry = {"value": value}
        entry.update(meta)
        assets[kind] = entry
    else:
        assets[kind] = value
