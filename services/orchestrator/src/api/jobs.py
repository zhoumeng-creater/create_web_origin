import json
from typing import Any, Dict, Optional

from fastapi import APIRouter, Body, HTTPException
from fastapi.responses import StreamingResponse

from ..scheduler.events import EVENT_BUS
from ..scheduler.store import JOB_STORE
from ..scheduler.worker import enqueue_job

router = APIRouter()


def _job_to_dict(job: Any) -> Dict[str, Any]:
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
        "assets": dict(job.assets),
    }


def _format_sse(event_name: str, data: Dict[str, Any]) -> str:
    payload = json.dumps(data, ensure_ascii=False)
    return f"event: {event_name}\ndata: {payload}\n\n"


@router.post("")
async def create_job(uir: Optional[Dict[str, Any]] = Body(default=None)) -> Dict[str, str]:
    try:
        job = JOB_STORE.create_job(uir or {})
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    await enqueue_job(job.job_id)
    return {"job_id": job.job_id}


@router.get("/{job_id}")
async def get_job(job_id: str) -> Dict[str, Any]:
    job = JOB_STORE.get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="job not found")
    return _job_to_dict(job)


@router.get("/{job_id}/events")
async def job_events(job_id: str) -> StreamingResponse:
    job = JOB_STORE.get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="job not found")

    async def event_stream() -> Any:
        queue = await EVENT_BUS.subscribe(job_id)
        try:
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
