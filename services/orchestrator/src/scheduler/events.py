from __future__ import annotations

import asyncio
from typing import Any, Dict, Set


class EventBus:
    def __init__(self) -> None:
        self._subscribers: Dict[str, Set[asyncio.Queue[dict]]] = {}
        self._lock = asyncio.Lock()

    async def subscribe(self, job_id: str) -> asyncio.Queue[dict]:
        queue: asyncio.Queue[dict] = asyncio.Queue()
        async with self._lock:
            self._subscribers.setdefault(job_id, set()).add(queue)
        return queue

    async def unsubscribe(self, job_id: str, queue: asyncio.Queue[dict]) -> None:
        async with self._lock:
            subscribers = self._subscribers.get(job_id)
            if not subscribers:
                return
            subscribers.discard(queue)
            if not subscribers:
                del self._subscribers[job_id]

    async def publish(self, job_id: str, event_name: str, data: Dict[str, Any]) -> None:
        async with self._lock:
            subscribers = list(self._subscribers.get(job_id, set()))
        if not subscribers:
            return
        event = {"event": event_name, "data": data}
        for queue in subscribers:
            queue.put_nowait(event)


EVENT_BUS = EventBus()
