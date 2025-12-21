from __future__ import annotations

import asyncio
import time
from collections import deque
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Tuple

from .events import EVENT_BUS
from .models import JobStatus
from .reporter import ProgressReporter
from .store import JOB_STORE, JobStore
from ..config.runtime import get_runtime_paths
from ..storage.job_fs import ensure_job_dirs
from ..storage.manifest import make_asset_url, write_manifest

JOB_QUEUE: asyncio.Queue[str] = asyncio.Queue()
GPU_SEMAPHORE = asyncio.Semaphore(1)

_QUEUE_ORDER: deque[str] = deque()
_QUEUE_LOCK = asyncio.Lock()

_PIPELINE: Iterable[Tuple[JobStatus, float, Tuple[float, float]]] = (
    (JobStatus.PLANNING, 0.4, (0.0, 0.1)),
    (JobStatus.RUNNING_SCENE, 1.0, (0.1, 0.35)),
    (JobStatus.RUNNING_MOTION, 1.0, (0.35, 0.6)),
    (JobStatus.RUNNING_MUSIC, 0.8, (0.6, 0.75)),
    (JobStatus.BUILDING_PREVIEW, 0.6, (0.75, 0.9)),
    (JobStatus.EXPORTING, 0.6, (0.9, 0.99)),
)

_GPU_STAGES = {
    JobStatus.RUNNING_SCENE,
    JobStatus.RUNNING_MOTION,
    JobStatus.RUNNING_MUSIC,
    JobStatus.BUILDING_PREVIEW,
    JobStatus.EXPORTING,
}


async def enqueue_job(job_id: str, store: JobStore = JOB_STORE) -> None:
    snapshot = await _queue_append(job_id)
    await _sync_queue_positions(store, snapshot)
    await JOB_QUEUE.put(job_id)


async def worker_loop(store: JobStore) -> None:
    while True:
        job_id = await JOB_QUEUE.get()
        try:
            snapshot = await _queue_remove(job_id)
            await _sync_queue_positions(store, snapshot)
            await _run_job(store, job_id)
        finally:
            JOB_QUEUE.task_done()


async def _queue_append(job_id: str) -> List[str]:
    async with _QUEUE_LOCK:
        _QUEUE_ORDER.append(job_id)
        return list(_QUEUE_ORDER)


async def _queue_remove(job_id: str) -> List[str]:
    async with _QUEUE_LOCK:
        try:
            _QUEUE_ORDER.remove(job_id)
        except ValueError:
            pass
        return list(_QUEUE_ORDER)


async def _sync_queue_positions(store: JobStore, snapshot: List[str]) -> None:
    total = len(snapshot)
    for index, queued_id in enumerate(snapshot):
        position = index + 1
        job = store.get_job(queued_id)
        if not job:
            continue
        if job.status != JobStatus.QUEUED:
            continue
        store.update_job(queued_id, queue_position=position, queue_size=total)
        reporter = ProgressReporter(queued_id, store, EVENT_BUS)
        message = f"queued ({position}/{total})" if total else "queued"
        await reporter.stage(JobStatus.QUEUED, job.progress, message)


async def _run_job(store: JobStore, job_id: str) -> None:
    job = store.get_job(job_id)
    if not job:
        return
    reporter = ProgressReporter(job_id, store, EVENT_BUS)
    store.update_job(job_id, queue_position=None, queue_size=None)
    if job.status == JobStatus.CANCELED:
        await reporter.stage(
            JobStatus.CANCELED,
            job.progress,
            "canceled before start",
        )
        _persist_manifest(store, job_id, JobStatus.CANCELED, [])
        return
    try:
        for stage, duration, progress_range in _PIPELINE:
            if _is_canceled(store, job_id):
                job = store.get_job(job_id)
                progress = job.progress if job else 0.0
                await reporter.stage(JobStatus.CANCELED, progress, "canceled")
                _persist_manifest(store, job_id, JobStatus.CANCELED, [])
                return
            if stage in _GPU_STAGES:
                async with GPU_SEMAPHORE:
                    canceled = await _simulate_stage(
                        store, reporter, job_id, stage, duration, progress_range
                    )
            else:
                canceled = await _simulate_stage(
                    store, reporter, job_id, stage, duration, progress_range
                )
            if canceled:
                job = store.get_job(job_id)
                progress = job.progress if job else 0.0
                await reporter.stage(JobStatus.CANCELED, progress, "canceled")
                _persist_manifest(store, job_id, JobStatus.CANCELED, [])
                return
            new_artifacts = _update_manifest_for_stage(store, job_id, stage)
            if new_artifacts:
                refreshed = store.get_job(job_id)
                if refreshed:
                    await reporter.stage(stage, refreshed.progress, refreshed.message)
        await reporter.stage(JobStatus.DONE, 1.0, "done")
        _persist_manifest(store, job_id, JobStatus.DONE, [])
    except Exception as exc:
        job = store.get_job(job_id)
        progress = job.progress if job else 0.0
        await reporter.stage(JobStatus.FAILED, progress, f"failed: {exc}")
        errors: List[Dict[str, Any]] = [{"message": str(exc)}]
        if job and job.stage:
            errors[0]["stage"] = job.stage
        _persist_manifest(store, job_id, JobStatus.FAILED, errors)


async def _simulate_stage(
    store: JobStore,
    reporter: ProgressReporter,
    job_id: str,
    stage: JobStatus,
    duration: float,
    progress_range: Tuple[float, float],
) -> bool:
    start, end = progress_range
    message = stage.value.lower().replace("_", " ")
    await reporter.stage(stage, start, message)
    blocking_task = asyncio.create_task(asyncio.to_thread(_blocking_stage, duration))
    steps = 5
    step_sleep = max(duration / steps, 0.0)
    for idx in range(steps):
        if _is_canceled(store, job_id):
            blocking_task.cancel()
            return True
        await asyncio.sleep(step_sleep)
        progress = start + (end - start) * (idx + 1) / steps
        await reporter.stage(stage, progress, message)
    try:
        await blocking_task
    except asyncio.CancelledError:
        return True
    return False


def _blocking_stage(duration: float) -> None:
    time.sleep(max(duration, 0.0))


def _is_canceled(store: JobStore, job_id: str) -> bool:
    job = store.get_job(job_id)
    return job is None or job.status == JobStatus.CANCELED


def _update_manifest_for_stage(
    store: JobStore, job_id: str, stage: JobStatus
) -> List[Dict[str, Any]]:
    job = store.get_job(job_id)
    if not job:
        return []
    artifacts = _collect_artifacts(job)
    new_artifacts = _stage_artifacts(job_id, stage)
    if new_artifacts:
        artifacts.extend(new_artifacts)
        assets = dict(job.assets) if isinstance(job.assets, dict) else {}
        assets["artifacts"] = artifacts
        store.update_job(job_id, assets=assets)
    runtime_paths = get_runtime_paths()
    job_dir = ensure_job_dirs(runtime_paths.assets_dir, job_id)
    if new_artifacts:
        _materialize_artifacts(job_dir, job_id, new_artifacts)
    _persist_manifest(store, job_id, job.status, [], artifacts=artifacts)
    return new_artifacts


def _persist_manifest(
    store: JobStore,
    job_id: str,
    status: JobStatus,
    errors: List[Dict[str, Any]],
    artifacts: Optional[List[Dict[str, Any]]] = None,
) -> None:
    job = store.get_job(job_id)
    if not job:
        return
    if artifacts is None:
        artifacts = _collect_artifacts(job)
    runtime_paths = get_runtime_paths()
    job_dir = ensure_job_dirs(runtime_paths.assets_dir, job_id)
    write_manifest(job_dir, job.uir, status.value, artifacts, errors)
    store.update_job(
        job_id,
        manifest_path=str(job_dir / "manifest.json"),
        manifest_url=make_asset_url(job_id, "manifest.json"),
    )


def _collect_artifacts(job: Any) -> List[Dict[str, Any]]:
    artifacts: List[Dict[str, Any]] = []
    assets = getattr(job, "assets", None)
    if isinstance(assets, dict):
        stored = assets.get("artifacts")
        if isinstance(stored, list):
            for item in stored:
                if isinstance(item, dict):
                    artifacts.append(dict(item))
    return artifacts


def _stage_artifacts(job_id: str, stage: JobStatus) -> List[Dict[str, Any]]:
    if stage == JobStatus.RUNNING_SCENE:
        return [
            _asset_ref(
                job_id,
                "scene_panorama",
                "scene/panorama.png",
                "image/png",
            )
        ]
    if stage == JobStatus.RUNNING_MOTION:
        return [
            _asset_ref(
                job_id,
                "motion_bvh",
                "motion/motion.bvh",
                "text/plain",
            )
        ]
    if stage == JobStatus.RUNNING_MUSIC:
        return [
            _asset_ref(
                job_id,
                "music_wav",
                "music/music.wav",
                "audio/wav",
            )
        ]
    if stage == JobStatus.BUILDING_PREVIEW:
        return [
            _asset_ref(
                job_id,
                "preview_config",
                "preview/preview_config.json",
                "application/json",
            )
        ]
    if stage == JobStatus.EXPORTING:
        return [
            _asset_ref(
                job_id,
                "export_mp4",
                "export/final.mp4",
                "video/mp4",
            )
        ]
    return []


def _asset_ref(job_id: str, role: str, rel_path: str, mime: str) -> Dict[str, Any]:
    return {
        "id": f"{job_id}:{role}",
        "role": role,
        "uri": make_asset_url(job_id, rel_path),
        "mime": mime,
    }


def _materialize_artifacts(job_dir: Path, job_id: str, artifacts: List[Dict[str, Any]]) -> None:
    prefix = f"/assets/{job_id}/"
    for artifact in artifacts:
        uri = artifact.get("uri")
        if not isinstance(uri, str) or not uri.startswith(prefix):
            continue
        rel_path = uri[len(prefix) :]
        if not rel_path:
            continue
        file_path = job_dir / Path(rel_path)
        file_path.parent.mkdir(parents=True, exist_ok=True)
        if file_path.exists():
            continue
        suffix = file_path.suffix.lower()
        if suffix in {".json", ".bvh", ".txt"}:
            file_path.write_text("{}", encoding="utf-8")
        else:
            file_path.write_bytes(b"")
