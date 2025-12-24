from __future__ import annotations

from typing import Any, Dict, List, Optional

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from ..scheduler.events import EVENT_BUS
from ..scheduler.store import JOB_STORE

router = APIRouter()
_LOGS_TAIL_LIMIT = 8


@router.websocket("/ws/jobs/{job_id}")
async def job_ws(websocket: WebSocket, job_id: str) -> None:
    job = JOB_STORE.get_job(job_id)
    if not job:
        await websocket.accept()
        await websocket.send_json({"error": "job not found"})
        await websocket.close(code=4404)
        return
    await websocket.accept()
    await websocket.send_json(_job_payload(job, "snapshot", None))
    queue = await EVENT_BUS.subscribe(job_id)
    try:
        while True:
            event = await queue.get()
            job = JOB_STORE.get_job(job_id)
            if not job:
                await websocket.send_json({"error": "job not found"})
                break
            await websocket.send_json(_job_payload(job, event.get("event"), event.get("data")))
    except WebSocketDisconnect:
        pass
    finally:
        await EVENT_BUS.unsubscribe(job_id, queue)


def _job_payload(job: Any, event_name: Optional[str], event_data: Any) -> Dict[str, Any]:
    message = _event_message(event_name, event_data, job)
    logs_tail = _event_logs_tail(event_data, job.logs)
    progress = _event_progress(event_data, job.progress)
    payload: Dict[str, Any] = {
        "job_id": job.job_id,
        "status": job.status.value,
        "stage": job.stage,
        "progress": progress,
        "message": message,
        "hint": message,
        "logs_tail": logs_tail,
    }
    if event_name == "failed":
        payload["error"] = message or "job failed"
    return payload


def _event_message(event_name: Optional[str], event_data: Any, job: Any) -> str:
    if isinstance(event_data, dict):
        for key in ("message", "text", "line"):
            value = event_data.get(key)
            if isinstance(value, str) and value.strip():
                return value.strip()
    if event_name == "failed":
        return job.message or "job failed"
    return job.message or ""


def _event_logs_tail(event_data: Any, logs: List[str]) -> List[str]:
    if isinstance(event_data, dict):
        value = event_data.get("logs_tail")
        if isinstance(value, list):
            return [line for line in value if isinstance(line, str)]
    return _logs_tail(logs)


def _event_progress(event_data: Any, stored_progress: Any) -> float:
    if isinstance(event_data, dict) and "progress" in event_data:
        return _progress_percent(event_data.get("progress"))
    return _progress_percent(stored_progress)


def _progress_percent(value: Any) -> float:
    try:
        progress = float(value)
    except (TypeError, ValueError):
        return 0.0
    if progress <= 1.0:
        progress *= 100.0
    return max(0.0, min(100.0, progress))


def _logs_tail(lines: List[str], limit: int = _LOGS_TAIL_LIMIT) -> List[str]:
    if limit <= 0:
        return []
    if len(lines) <= limit:
        return list(lines)
    return list(lines[-limit:])
