import asyncio

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field, field_validator
from slowapi import Limiter
from slowapi.util import get_remote_address

from backend.services.event_bus import event_bus
from backend.services.nova_reasoning import reason_about_page, reason_continue

limiter = Limiter(key_func=get_remote_address)


class TaskRequest(BaseModel):
    command: str = Field(..., max_length=5000)       # User's voice command text
    screenshot: str = Field(..., max_length=15_000_000)    # Base64-encoded PNG screenshot (~10MB base64)
    dom_snapshot: dict  # Structured DOM data (buttons, links, inputs, etc.)
    firecrawl_markdown: str | None = None         # Clean page text from Firecrawl (optional)
    conversation_history: list[dict] | None = None # Prior conversation turns (optional)

    @field_validator('dom_snapshot')
    @classmethod
    def validate_snapshot_size(cls, v):
        import json
        if len(json.dumps(v)) > 2_000_000:  # 2MB limit
            raise ValueError('DOM snapshot too large (max 2MB)')
        return v


class TaskContinueRequest(BaseModel):
    original_command: str = Field(..., max_length=5000)          # The user's original voice command
    action_history: list[dict]     # [{"description": "...", "result": "..."}]
    screenshot: str = Field(..., max_length=15_000_000)                # Base64-encoded PNG screenshot (AFTER actions)
    dom_snapshot: dict             # Structured DOM data after last action
    firecrawl_markdown: str | None = None         # Clean page text from Firecrawl (optional)
    conversation_history: list[dict] | None = None # Prior conversation turns (optional)

    @field_validator('dom_snapshot')
    @classmethod
    def validate_snapshot_size(cls, v):
        import json
        if len(json.dumps(v)) > 2_000_000:  # 2MB limit
            raise ValueError('DOM snapshot too large (max 2MB)')
        return v


router = APIRouter()


@router.post("/task")
@limiter.limit("15/minute")
async def process_task(request: Request, body: TaskRequest):
    """Receive a voice command, screenshot, and DOM snapshot; return answer or action steps."""
    await event_bus.emit("status", {"stage": "understanding"})

    try:
        result = await asyncio.to_thread(
            reason_about_page,
            body.command,
            body.screenshot,
            body.dom_snapshot,
            body.firecrawl_markdown,
            body.conversation_history,
        )
        await event_bus.emit(
            "status",
            {"stage": "task_complete", "type": result.get("type", "unknown")},
        )
        return result
    except ValueError as e:
        error_msg = str(e)
        await event_bus.emit("status", {"stage": "error", "detail": error_msg})
        if "credentials" in error_msg.lower() or "aws" in error_msg.lower():
            raise HTTPException(
                status_code=500,
                detail=f"AWS credentials not configured — check backend .env file: {error_msg}",
            )
        raise HTTPException(status_code=422, detail=error_msg)
    except Exception as e:
        error_msg = str(e)
        await event_bus.emit("status", {"stage": "error", "detail": error_msg})
        if "credentials" in error_msg.lower() or "NoCredentials" in error_msg:
            raise HTTPException(
                status_code=500,
                detail="AWS credentials not configured — check backend .env file",
            )
        raise HTTPException(status_code=500, detail=f"Task processing failed: {error_msg}")


@router.post("/task/continue")
@limiter.limit("30/minute")
async def continue_task(request: Request, body: TaskContinueRequest):
    """Re-evaluate the page after actions have been taken; return done, steps, or answer."""
    await event_bus.emit("status", {"stage": "understanding"})

    try:
        result = await asyncio.to_thread(
            reason_continue,
            body.original_command,
            body.action_history,
            body.screenshot,
            body.dom_snapshot,
            body.firecrawl_markdown,
            body.conversation_history,
        )
        await event_bus.emit(
            "status",
            {"stage": "task_complete", "type": result.get("type", "unknown")},
        )
        return result
    except ValueError as e:
        error_msg = str(e)
        await event_bus.emit("status", {"stage": "error", "detail": error_msg})
        if "credentials" in error_msg.lower() or "aws" in error_msg.lower():
            raise HTTPException(
                status_code=500,
                detail=f"AWS credentials not configured — check backend .env file: {error_msg}",
            )
        raise HTTPException(status_code=422, detail=error_msg)
    except Exception as e:
        error_msg = str(e)
        await event_bus.emit("status", {"stage": "error", "detail": error_msg})
        if "credentials" in error_msg.lower() or "NoCredentials" in error_msg:
            raise HTTPException(
                status_code=500,
                detail="AWS credentials not configured — check backend .env file",
            )
        raise HTTPException(status_code=500, detail=f"Continue task failed: {error_msg}")
