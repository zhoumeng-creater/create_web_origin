from __future__ import annotations

import asyncio
from typing import Any, Dict, Iterable, List, Tuple

from .events import EVENT_BUS
from .models import JobStatus
from .reporter import ProgressReporter
from .store import JobStore
from ..config.runtime import get_runtime_paths
from ..storage.job_fs import ensure_job_dirs
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
    artifacts: List[Dict[str, Any]] = []
    if isinstance(job.assets, dict):
        stored = job.assets.get("artifacts")
        if isinstance(stored, list):
            artifacts = list(stored)
    new_artifacts = _stage_artifacts(job_id, stage)
    if new_artifacts:
        artifacts.extend(new_artifacts)
        assets = dict(job.assets) if isinstance(job.assets, dict) else {}
        assets["artifacts"] = artifacts
        store.update_job(job_id, assets=assets)
        job = store.get_job(job_id)
        if not job:
            return
    runtime_paths = get_runtime_paths()
    job_dir = ensure_job_dirs(runtime_paths.assets_dir, job_id)
    write_manifest(job_dir, job.uir, job.status.value, artifacts, [])
    store.update_job(
        job_id,
        manifest_path=str(job_dir / "manifest.json"),
        manifest_url=make_asset_url(job_id, "manifest.json"),
    )


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
    if stage == JobStatus.COMPOSING_PREVIEW:
        return [
            _asset_ref(
                job_id,
                "preview_config",
                "preview/preview_config.json",
                "application/json",
            )
        ]
    if stage == JobStatus.EXPORTING_VIDEO:
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
