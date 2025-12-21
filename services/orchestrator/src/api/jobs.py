import json
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Body, HTTPException
from fastapi.responses import StreamingResponse

from ..planner.planner import plan_uir
from ..scheduler.events import EVENT_BUS
from ..scheduler.store import JOB_STORE
from ..scheduler.worker import enqueue_job
from ..storage.manifest import read_manifest

router = APIRouter()


def _job_to_dict(job: Any) -> Dict[str, Any]:
    artifacts = _artifacts_partial(job)
    return {
        "job_id": job.job_id,
        "status": job.status.value,
        "stage": job.stage,
        "progress": job.progress,
        "message": job.message,
        "created_at": job.created_at.isoformat(),
        "started_at": job.started_at.isoformat() if job.started_at else None,
        "ended_at": job.ended_at.isoformat() if job.ended_at else None,
        "uir": job.uir,
        "uir_hash": job.uir_hash,
        "manifest_path": job.manifest_path,
        "manifest_url": job.manifest_url,
        "logs": list(job.logs),
        "logs_tail": list(job.logs),
        "assets": dict(job.assets),
        "partial_assets": artifacts,
        "artifacts_partial": artifacts,
        "queue_position": job.queue_position,
        "queue_size": job.queue_size,
        "event_stream": job.event_stream,
    }


def _format_sse(event_name: str, data: Dict[str, Any]) -> str:
    payload = json.dumps(data, ensure_ascii=False)
    return f"event: {event_name}\ndata: {payload}\n\n"


@router.post("")
async def create_job(payload: Optional[Dict[str, Any]] = Body(default=None)) -> Dict[str, str]:
    try:
        uir = plan_uir(payload or {})
        job = JOB_STORE.create_job(uir)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    await enqueue_job(job.job_id)
    return {"job_id": job.job_id}


@router.get("/{job_id}")
async def get_job(job_id: str) -> Dict[str, Any]:
    job = JOB_STORE.get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="job not found")
    payload = _job_to_dict(job)
    try:
        manifest = read_manifest(job_id)
    except Exception:
        manifest = {}
    if manifest:
        payload["manifest"] = manifest
    return payload


@router.get("/{job_id}/events")
async def job_events(job_id: str) -> StreamingResponse:
    job = JOB_STORE.get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="job not found")
    if not job.event_stream:
        raise HTTPException(status_code=409, detail="event stream disabled")

    async def event_stream() -> Any:
        queue = await EVENT_BUS.subscribe(job_id)
        try:
            yield _format_sse("status", _status_snapshot(job))
            while True:
                event = await queue.get()
                yield _format_sse(event["event"], event["data"])
        finally:
            await EVENT_BUS.unsubscribe(job_id, queue)

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache"},
    )


def _artifacts_partial(job: Any) -> List[Dict[str, Any]]:
    artifacts: List[Dict[str, Any]] = []
    if isinstance(job.assets, dict):
        stored = job.assets.get("artifacts")
        if isinstance(stored, list):
            for item in stored:
                if isinstance(item, dict):
                    artifacts.append(dict(item))
    return artifacts


def _status_snapshot(job: Any) -> Dict[str, Any]:
    payload: Dict[str, Any] = {
        "job_id": job.job_id,
        "status": job.status.value,
        "stage": job.stage,
        "progress": job.progress,
        "message": job.message,
        "ts": datetime.now(timezone.utc).isoformat(),
        "artifacts_partial": _artifacts_partial(job),
    }
    if job.queue_position is not None:
        payload["queue_position"] = job.queue_position
    if job.queue_size is not None:
        payload["queue_size"] = job.queue_size
    if job.manifest_url:
        payload["manifest_url"] = job.manifest_url
    return payload
