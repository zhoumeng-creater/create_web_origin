from __future__ import annotations

import asyncio
from typing import Any, Dict, Iterable, List, Optional, Tuple

from .events import EVENT_BUS
from .models import JobStatus
from .reporter import ProgressReporter
from .store import JobStore
from ..adapters.base import AdapterResult, build_error
from ..adapters.registry import get_adapter
from ..config.runtime import get_runtime_paths
from ..storage.job_fs import ensure_job_dirs
from ..storage.manifest import make_asset_url, write_manifest

JOB_QUEUE: asyncio.Queue[str] = asyncio.Queue()
GPU_SEMAPHORE = asyncio.Semaphore(1)
_PROVIDER_SEMAPHORES: Dict[str, asyncio.Semaphore] = {}

_PIPELINE: Iterable[Tuple[JobStatus, float, Tuple[float, float]]] = (
    (JobStatus.PLANNING, 0.4, (0.0, 0.1)),
    (JobStatus.RUNNING_MOTION, 1.0, (0.1, 0.35)),
    (JobStatus.RUNNING_SCENE, 1.0, (0.35, 0.55)),
    (JobStatus.RUNNING_MUSIC, 0.8, (0.55, 0.7)),
    (JobStatus.RUNNING_CHARACTER, 0.5, (0.7, 0.78)),
    (JobStatus.COMPOSING_PREVIEW, 0.6, (0.78, 0.9)),
    (JobStatus.EXPORTING_VIDEO, 0.6, (0.9, 0.99)),
)

_STAGE_MODALITY = {
    JobStatus.RUNNING_MOTION: "motion",
    JobStatus.RUNNING_SCENE: "scene",
    JobStatus.RUNNING_MUSIC: "music",
    JobStatus.RUNNING_CHARACTER: "character",
    JobStatus.COMPOSING_PREVIEW: "preview",
    JobStatus.EXPORTING_VIDEO: "export",
}

_STAGE_MESSAGES = {
    JobStatus.PLANNING: "planning",
    JobStatus.RUNNING_MOTION: "running motion",
    JobStatus.RUNNING_SCENE: "running scene",
    JobStatus.RUNNING_MUSIC: "running music",
    JobStatus.RUNNING_CHARACTER: "running character",
    JobStatus.COMPOSING_PREVIEW: "composing preview",
    JobStatus.EXPORTING_VIDEO: "exporting video",
}

_DEFAULT_PROVIDERS = {
    "scene": "diffusion360_local",
    "motion": "animationgpt_local",
    "music": "musicgpt_cli",
    "character": "builtin_library",
    "preview": "web_threejs",
    "export": "ffmpeg_export",
}

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
    runtime_paths = get_runtime_paths()
    job_dir = ensure_job_dirs(runtime_paths.assets_dir, job_id)
    try:
        for stage, _duration, progress_range in _PIPELINE:
            if _is_canceled(store, job_id):
                await _mark_canceled(store, reporter, job_id)
                return
            start, end = progress_range
            message = _STAGE_MESSAGES.get(
                stage, stage.value.lower().replace("_", " ")
            )
            await reporter.status(stage, start, message)
            modality = _STAGE_MODALITY.get(stage)
            if not modality:
                await reporter.status(stage, end, message)
                _write_manifest(store, job_id, stage.value, [])
                continue
            if not _modality_requested(job.uir, modality):
                await reporter.status(stage, end, f"{modality} skipped")
                _write_manifest(store, job_id, stage.value, [])
                continue
            provider_id = _resolve_provider_id(job.uir, modality)
            if not provider_id:
                error = build_error(
                    "E_VALIDATION_ROUTING",
                    f"missing provider for {modality}",
                    detail={"modality": modality},
                    retryable=False,
                )
                await _fail_job(
                    store,
                    reporter,
                    job_id,
                    _current_progress(store, job_id, start),
                    f"{modality} routing missing",
                    error,
                )
                return
            try:
                adapter = get_adapter(provider_id)
            except KeyError:
                error = build_error(
                    "E_DEPENDENCY_MISSING",
                    f"adapter not registered: {provider_id}",
                    detail={"provider_id": provider_id, "modality": modality},
                    retryable=False,
                )
                await _fail_job(
                    store,
                    reporter,
                    job_id,
                    _current_progress(store, job_id, start),
                    f"{modality} adapter missing",
                    error,
                )
                return
            if adapter.modality and adapter.modality != modality:
                error = build_error(
                    "E_UNSUPPORTED",
                    f"adapter modality mismatch: {adapter.modality}",
                    detail={"provider_id": provider_id, "expected": modality},
                    retryable=False,
                )
                await _fail_job(
                    store,
                    reporter,
                    job_id,
                    _current_progress(store, job_id, start),
                    f"{modality} adapter mismatch",
                    error,
                )
                return
            try:
                await asyncio.to_thread(adapter.validate, job.uir)
            except Exception as exc:
                error = build_error(
                    "E_VALIDATION_INPUT",
                    "validation failed",
                    detail={"error": str(exc)},
                    retryable=False,
                )
                await _fail_job(
                    store,
                    reporter,
                    job_id,
                    _current_progress(store, job_id, start),
                    f"{modality} validation failed",
                    error,
                )
                return
            try:
                result = await _run_adapter(
                    adapter,
                    provider_id,
                    job.uir,
                    job_dir,
                    reporter,
                    stage,
                    progress_range,
                )
            except Exception as exc:
                error = build_error(
                    "E_MODEL_RUNTIME",
                    "adapter execution failed",
                    detail={"error": str(exc), "provider_id": provider_id},
                    retryable=True,
                )
                await _fail_job(
                    store,
                    reporter,
                    job_id,
                    _current_progress(store, job_id, start),
                    f"{modality} failed",
                    error,
                )
                return
            if not _result_ok(result):
                error = _result_error(result, provider_id)
                await _fail_job(
                    store,
                    reporter,
                    job_id,
                    _current_progress(store, job_id, start),
                    f"{modality} failed",
                    error,
                )
                return
            artifacts = _result_artifacts(result)
            _store_artifacts(store, job_id, artifacts)
            await _emit_asset_events(reporter, artifacts)
            await reporter.status(stage, end, f"{modality} done")
            _write_manifest(store, job_id, stage.value, [])
        await reporter.status(JobStatus.DONE, 1.0, "done")
        _write_manifest(store, job_id, JobStatus.DONE.value, [])
    except Exception as exc:
        error = build_error(
            "E_MODEL_RUNTIME",
            "worker failed",
            detail={"error": str(exc)},
            retryable=True,
        )
        await _fail_job(
            store,
            reporter,
            job_id,
            _current_progress(store, job_id, 0.0),
            f"failed: {exc}",
            error,
        )


async def _run_adapter(
    adapter: Any,
    provider_id: str,
    uir: Dict[str, Any],
    out_dir: Any,
    reporter: ProgressReporter,
    stage: JobStatus,
    progress_range: Tuple[float, float],
) -> AdapterResult:
    loop = asyncio.get_running_loop()
    bridge = _AdapterReporter(loop, reporter, stage, progress_range)
    semaphore = _provider_semaphore(provider_id, adapter)
    await semaphore.acquire()
    try:
        return await asyncio.to_thread(adapter.run, uir, out_dir, bridge)
    finally:
        semaphore.release()


def _provider_semaphore(provider_id: str, adapter: Any) -> asyncio.Semaphore:
    key = provider_id or getattr(adapter, "modality", "") or "default"
    semaphore = _PROVIDER_SEMAPHORES.get(key)
    if semaphore is None:
        semaphore = asyncio.Semaphore(_max_concurrency(adapter))
        _PROVIDER_SEMAPHORES[key] = semaphore
    return semaphore


def _max_concurrency(adapter: Any) -> int:
    value = getattr(adapter, "max_concurrency", 1)
    try:
        limit = int(value)
    except (TypeError, ValueError):
        limit = 1
    if limit < 1:
        limit = 1
    return limit


class _AdapterReporter:
    def __init__(
        self,
        loop: asyncio.AbstractEventLoop,
        reporter: ProgressReporter,
        stage: JobStatus,
        progress_range: Tuple[float, float],
    ) -> None:
        self._loop = loop
        self._reporter = reporter
        self._stage = stage
        self._start, self._end = progress_range

    def stage(
        self,
        name: str,
        progress: float,
        message: str = "",
        extra: Optional[Dict[str, Any]] = None,
    ) -> None:
        normalized = _normalize_progress(progress)
        overall = self._start + (self._end - self._start) * normalized
        msg = message or name or self._stage.value.lower().replace("_", " ")
        payload = _payload_with_stage(name, extra)
        self._schedule(self._reporter.status(self._stage, overall, msg, payload))

    def log(self, line: str) -> None:
        self._schedule(self._reporter.log(line))

    def _schedule(self, coro: Any) -> None:
        asyncio.run_coroutine_threadsafe(coro, self._loop)


def _payload_with_stage(
    name: str, extra: Optional[Dict[str, Any]]
) -> Optional[Dict[str, Any]]:
    payload: Optional[Dict[str, Any]] = None
    if extra is not None:
        if isinstance(extra, dict):
            payload = dict(extra)
        else:
            payload = {"extra": extra}
    if name:
        payload = dict(payload or {})
        payload.setdefault("adapter_stage", name)
    return payload


def _normalize_progress(value: Any) -> float:
    try:
        progress = float(value)
    except (TypeError, ValueError):
        return 0.0
    if progress > 1.0:
        progress = progress / 100.0
    return max(0.0, min(1.0, progress))


def _result_ok(result: Any) -> bool:
    return isinstance(result, dict) and bool(result.get("ok"))


def _result_artifacts(result: Any) -> List[Dict[str, Any]]:
    if isinstance(result, dict):
        artifacts = result.get("artifacts")
        if isinstance(artifacts, list):
            return [artifact for artifact in artifacts if isinstance(artifact, dict)]
    return []


def _result_error(result: Any, provider_id: str) -> Dict[str, Any]:
    fallback = build_error(
        "E_MODEL_RUNTIME",
        f"adapter returned ok=false: {provider_id}",
        detail={"provider_id": provider_id},
        retryable=True,
    )
    if isinstance(result, dict):
        return _normalize_error(result.get("error"), fallback)
    return fallback


def _normalize_error(error: Any, fallback: Dict[str, Any]) -> Dict[str, Any]:
    if not isinstance(error, dict):
        return fallback
    code = error.get("code") or fallback.get("code")
    message = error.get("message") or fallback.get("message")
    detail = error.get("detail")
    if not isinstance(detail, dict):
        detail = {}
    retryable = error.get("retryable")
    if retryable is None:
        retryable = fallback.get("retryable", False)
    return {
        "code": str(code or ""),
        "message": str(message or ""),
        "detail": detail,
        "retryable": bool(retryable),
    }


def _resolve_provider_id(uir: Dict[str, Any], modality: str) -> Optional[str]:
    routing = uir.get("routing")
    if isinstance(routing, dict):
        entry = routing.get(modality)
        if isinstance(entry, dict):
            provider = entry.get("provider")
            if isinstance(provider, str) and provider.strip():
                return provider.strip()
    return _DEFAULT_PROVIDERS.get(modality)


def _modality_requested(uir: Dict[str, Any], modality: str) -> bool:
    intent = uir.get("intent")
    if isinstance(intent, dict):
        targets = intent.get("targets")
        if isinstance(targets, list):
            return modality in {str(target) for target in targets}
    modules = uir.get("modules")
    if isinstance(modules, dict):
        module = modules.get(modality)
        if isinstance(module, dict):
            return bool(module.get("enabled", False))
    return True


def _store_artifacts(
    store: JobStore, job_id: str, artifacts: List[Dict[str, Any]]
) -> None:
    if not artifacts:
        return
    job = store.get_job(job_id)
    if not job:
        return
    assets = dict(job.assets) if isinstance(job.assets, dict) else {}
    stored = assets.get("artifacts")
    merged: List[Dict[str, Any]] = []
    if isinstance(stored, list):
        merged.extend([item for item in stored if isinstance(item, dict)])
    merged.extend(artifacts)
    assets["artifacts"] = merged
    store.update_job(job_id, assets=assets)


async def _emit_asset_events(
    reporter: ProgressReporter, artifacts: List[Dict[str, Any]]
) -> None:
    for artifact in artifacts:
        if not isinstance(artifact, dict):
            continue
        uri = artifact.get("uri")
        if not uri:
            continue
        role = artifact.get("role")
        role_value = str(role) if role else ""
        asset_type = _asset_type_from_role(role_value)
        kind = _asset_kind(asset_type, role_value)
        meta = _asset_meta(artifact, role_value, asset_type)
        await reporter.asset(kind, uri, meta or None)


def _asset_type_from_role(role: str) -> str:
    if not role:
        return ""
    return role.split("_", 1)[0]


def _asset_kind(asset_type: str, role: str) -> str:
    if asset_type and role:
        return f"{asset_type}.{role}"
    return role or asset_type or "artifact"


def _asset_meta(
    artifact: Dict[str, Any], role: str, asset_type: str
) -> Dict[str, Any]:
    meta: Dict[str, Any] = {}
    if role:
        meta["role"] = role
    if asset_type:
        meta["type"] = asset_type
    if "mime" in artifact and artifact.get("mime"):
        meta["mime"] = artifact.get("mime")
    if "bytes" in artifact and artifact.get("bytes") is not None:
        meta["bytes"] = artifact.get("bytes")
    if "id" in artifact and artifact.get("id"):
        meta["id"] = artifact.get("id")
    if "meta" in artifact and isinstance(artifact.get("meta"), dict):
        meta["meta"] = artifact.get("meta")
    return meta


def _write_manifest(
    store: JobStore,
    job_id: str,
    status: str,
    errors: List[Dict[str, Any]],
) -> None:
    job = store.get_job(job_id)
    if not job:
        return
    artifacts = _stored_artifacts(job)
    runtime_paths = get_runtime_paths()
    job_dir = ensure_job_dirs(runtime_paths.assets_dir, job_id)
    write_manifest(job_dir, job.uir, status, artifacts, errors)
    store.update_job(
        job_id,
        manifest_path=str(job_dir / "manifest.json"),
        manifest_url=make_asset_url(job_id, "manifest.json"),
    )


def _stored_artifacts(job: Any) -> List[Dict[str, Any]]:
    if isinstance(job.assets, dict):
        stored = job.assets.get("artifacts")
        if isinstance(stored, list):
            return [item for item in stored if isinstance(item, dict)]
    return []


def _is_canceled(store: JobStore, job_id: str) -> bool:
    job = store.get_job(job_id)
    return job is None or job.status == JobStatus.CANCELED


async def _mark_canceled(
    store: JobStore, reporter: ProgressReporter, job_id: str
) -> None:
    job = store.get_job(job_id)
    progress = job.progress if job else 0.0
    await reporter.status(JobStatus.CANCELED, progress, "canceled")


async def _fail_job(
    store: JobStore,
    reporter: ProgressReporter,
    job_id: str,
    progress: float,
    message: str,
    error: Dict[str, Any],
) -> None:
    await reporter.status(JobStatus.FAILED, progress, message, payload=error)
    _write_manifest(store, job_id, JobStatus.FAILED.value, [error])


def _current_progress(store: JobStore, job_id: str, fallback: float) -> float:
    job = store.get_job(job_id)
    if not job:
        return fallback
    return job.progress


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
