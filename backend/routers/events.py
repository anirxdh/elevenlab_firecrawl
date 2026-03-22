import asyncio

from fastapi import APIRouter
from sse_starlette.sse import EventSourceResponse

from backend.services.event_bus import event_bus

router = APIRouter()


@router.get("/events")
async def stream_events():
    """SSE endpoint — extension connects here to receive real-time status updates."""

    async def event_generator():
        queue = event_bus.subscribe()
        try:
            while True:
                payload = await queue.get()
                yield {
                    "event": payload["event"],
                    "data": payload["data"],
                }
        except asyncio.CancelledError:
            pass
        finally:
            event_bus.unsubscribe(queue)

    return EventSourceResponse(event_generator())
