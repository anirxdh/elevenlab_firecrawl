import os
import time
from collections import deque

import uvicorn
from dotenv import load_dotenv
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from slowapi import Limiter
from slowapi.errors import RateLimitExceeded
from slowapi.util import get_remote_address

load_dotenv(os.path.join(os.path.dirname(__file__), ".env"))

from backend.routers.events import router as events_router
from backend.routers.task import router as task_router
from backend.routers.firecrawl import router as firecrawl_router
from backend.routers.transcribe import router as transcribe_router
from backend.services.nova_reasoning import SUPPORTED_MODELS, get_active_model

# Rate limiter
limiter = Limiter(key_func=get_remote_address)

app = FastAPI(title="ScreenSense Backend")
app.state.limiter = limiter


@app.exception_handler(RateLimitExceeded)
async def rate_limit_handler(request: Request, exc: RateLimitExceeded):
    return JSONResponse(
        status_code=429,
        content={"detail": "Rate limit exceeded — try again shortly"},
    )


app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
    allow_credentials=True,
)


# ── Centralized debug log (last 100 entries) ────────────────────────────────
_debug_log: deque = deque(maxlen=100)


def log_debug(source: str, message: str, level: str = "info"):
    """Add an entry to the in-memory debug log."""
    _debug_log.append({
        "ts": time.strftime("%H:%M:%S"),
        "source": source,
        "level": level,
        "message": message,
    })


class ClientLogEntry(BaseModel):
    source: str = "extension"
    level: str = "info"
    message: str


@app.get("/health")
async def health():
    return {"status": "ok"}


@app.get("/debug")
async def get_debug_log():
    """View all recent debug entries in one place — open http://localhost:8000/debug"""
    return {"entries": list(_debug_log)}


@app.post("/debug")
async def post_debug_log(entry: ClientLogEntry):
    """Extension can POST errors here for centralized logging."""
    log_debug(entry.source, entry.message, entry.level)
    return {"ok": True}


@app.get("/models")
async def list_models():
    """List available AI models and the currently active one."""
    active = get_active_model()
    return {
        "active": active,
        "available": {
            key: {"model_id": m["model_id"], "description": m["description"]}
            for key, m in SUPPORTED_MODELS.items()
        },
    }


app.include_router(events_router)
app.include_router(task_router)
app.include_router(firecrawl_router)
app.include_router(transcribe_router)


if __name__ == "__main__":
    uvicorn.run(
        "backend.main:app",
        host="0.0.0.0",
        port=int(os.getenv("BACKEND_PORT", "8000")),
        reload=True,
    )
