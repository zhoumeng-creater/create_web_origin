from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
from enum import Enum
from typing import Any, Dict, List, Optional


class JobStatus(str, Enum):
    QUEUED = "QUEUED"
    PLANNING = "PLANNING"
    RUNNING_SCENE = "RUNNING_SCENE"
    RUNNING_MOTION = "RUNNING_MOTION"
    RUNNING_MUSIC = "RUNNING_MUSIC"
    BUILDING_PREVIEW = "BUILDING_PREVIEW"
    EXPORTING = "EXPORTING"
    DONE = "DONE"
    FAILED = "FAILED"
    CANCELED = "CANCELED"


def _now() -> datetime:
    return datetime.now(timezone.utc)


@dataclass
class Job:
    job_id: str
    status: JobStatus = JobStatus.QUEUED
    stage: str = ""
    progress: float = 0.0
    message: str = ""
    created_at: datetime = field(default_factory=_now)
    started_at: Optional[datetime] = None
    ended_at: Optional[datetime] = None
    uir: Dict[str, Any] = field(default_factory=dict)
    uir_hash: str = ""
    manifest_path: Optional[str] = None
    manifest_url: Optional[str] = None
    logs: List[str] = field(default_factory=list)
    assets: Dict[str, Any] = field(default_factory=dict)
    queue_position: Optional[int] = None
    queue_size: Optional[int] = None
    event_stream: bool = False

    def __post_init__(self) -> None:
        if not self.stage:
            self.stage = self.status.value
