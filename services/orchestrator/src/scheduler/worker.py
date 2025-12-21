from __future__ import annotations

import asyncio
from typing import Any, Dict, Iterable, Tuple

from .events import EVENT_BUS
from .models import JobStatus
from .reporter import ProgressReporter
from .store import JobStore
from ..storage.manifest import make_asset_url, write_manifest

JOB_QUEUE: asyncio.Queue[str] = asyncio.Queue()
GPU_SEMAPHORE = asyncio.Semaphore(1)

_PIPELINE: Iterable[Tuple[JobStatus, float, Tuple[float, float]]] = (
    (JobStatus.PLANNING, 0.4, (0.0, 0.1)),
    (JobStatus.RUNNING_MOTION, 1.0, (0.1, 0.4)),
    (JobStatus.RUNNING_SCENE, 1.0, (0.4, 0.6)),
    (JobStatus.RUNNING_MUSIC, 0.8, (0.6, 0.75)),
    (JobStatus.COMPOSING_PREVIEW, 0.6, (0.75, 0.9)),
    (JobStatus.EXPORTING_VIDEO, 0.6, (0.9, 0.99)),
)

_GPU_STAGES = {
    JobStatus.RUNNING_MOTION,
    JobStatus.RUNNING_SCENE,
    JobStatus.RUNNING_MUSIC,
    JobStatus.COMPOSING_PREVIEW,
    JobStatus.EXPORTING_VIDEO,
}


async def enqueue_job(job_id: str) -> None:
    await JOB_QUEUE.put(job_id)


async def worker_loop(store: JobStore) -> None:
    while True:
        job_id = await JOB_QUEUE.get()
        try:
            await _run_job(store, job_id)
        finally:
            JOB_QUEUE.task_done()


async def _run_job(store: JobStore, job_id: str) -> None:
    job = store.get_job(job_id)
    if not job:
        return
    reporter = ProgressReporter(job_id, store, EVENT_BUS)
    if job.status == JobStatus.CANCELED:
        await reporter.status(
            JobStatus.CANCELED,
            job.progress,
            "canceled before start",
        )
        return
    try:
        for stage, duration, progress_range in _PIPELINE:
            if _is_canceled(store, job_id):
                job = store.get_job(job_id)
                progress = job.progress if job else 0.0
                await reporter.status(JobStatus.CANCELED, progress, "canceled")
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
                await reporter.status(JobStatus.CANCELED, progress, "canceled")
                return
            _update_manifest_for_stage(store, job_id, stage)
        await reporter.status(JobStatus.DONE, 1.0, "done")
    except Exception as exc:
        job = store.get_job(job_id)
        progress = job.progress if job else 0.0
        await reporter.status(JobStatus.FAILED, progress, f"failed: {exc}")


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
    await reporter.status(stage, start, message)
    steps = 5
    step_sleep = max(duration / steps, 0.0)
    for idx in range(steps):
        if _is_canceled(store, job_id):
            return True
        await asyncio.sleep(step_sleep)
        progress = start + (end - start) * (idx + 1) / steps
        await reporter.status(stage, progress, message)
    return False


def _is_canceled(store: JobStore, job_id: str) -> bool:
    job = store.get_job(job_id)
    return job is None or job.status == JobStatus.CANCELED


def _update_manifest_for_stage(store: JobStore, job_id: str, stage: JobStatus) -> None:
    job = store.get_job(job_id)
    if not job:
        return
    outputs = _stage_outputs(job_id, stage)
    assets = job.assets or {}
    if outputs:
        assets = _deep_merge(assets, outputs)
        store.update_job(job_id, assets=assets)
        job = store.get_job(job_id)
        if not job:
            return
    manifest_path = write_manifest(job, assets)
    store.update_job(
        job_id,
        manifest_path=str(manifest_path),
        manifest_url=make_asset_url(job_id, "manifest.json"),
    )


def _stage_outputs(job_id: str, stage: JobStatus) -> Dict[str, Any]:
    if stage == JobStatus.RUNNING_SCENE:
        return {
            "scene": {
                "panorama_png": make_asset_url(job_id, "scene.png"),
            }
        }
    if stage == JobStatus.RUNNING_MOTION:
        return {
            "motion": {
                "bvh": make_asset_url(job_id, "motion.bvh"),
                "fps": 30,
            }
        }
    if stage == JobStatus.RUNNING_MUSIC:
        return {
            "music": {
                "wav": make_asset_url(job_id, "music.wav"),
                "secs": 12,
            }
        }
    if stage == JobStatus.EXPORTING_VIDEO:
        return {
            "video": {
                "mp4": make_asset_url(job_id, "final.mp4"),
            }
        }
    return {}


def _deep_merge(base: Dict[str, Any], updates: Dict[str, Any]) -> Dict[str, Any]:
    merged = dict(base)
    for key, value in updates.items():
        if isinstance(value, dict) and isinstance(merged.get(key), dict):
            merged[key] = _deep_merge(merged[key], value)
        elif key not in merged:
            merged[key] = value
    return merged
