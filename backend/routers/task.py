import asyncio

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field, field_validator

from backend.services.event_bus import event_bus
from backend.services.nova_reasoning import reason_about_page, reason_continue


class TaskRequest(BaseModel):
    command: str = Field(..., max_length=5000)       # User's voice command text
    screenshot: str = Field(..., max_length=15_000_000)    # Base64-encoded PNG screenshot (~10MB base64)
    dom_snapshot: dict  # Structured DOM data (buttons, links, inputs, etc.)

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

    @field_validator('dom_snapshot')
    @classmethod
    def validate_snapshot_size(cls, v):
        import json
        if len(json.dumps(v)) > 2_000_000:  # 2MB limit
            raise ValueError('DOM snapshot too large (max 2MB)')
        return v


router = APIRouter()


@router.post("/task")
async def process_task(request: TaskRequest):
    """Receive a voice command, screenshot, and DOM snapshot; return answer or action steps."""
    await event_bus.emit("status", {"stage": "understanding"})

    try:
        # boto3 is synchronous — run it in a thread pool to avoid blocking the event loop
        result = await asyncio.to_thread(
            reason_about_page,
            request.command,
            request.screenshot,
            request.dom_snapshot,
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
async def continue_task(request: TaskContinueRequest):
    """Re-evaluate the page after actions have been taken; return done, steps, or answer."""
    await event_bus.emit("status", {"stage": "understanding"})

    try:
        # boto3 is synchronous — run it in a thread pool to avoid blocking the event loop
        result = await asyncio.to_thread(
            reason_continue,
            request.original_command,
            request.action_history,
            request.screenshot,
            request.dom_snapshot,
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
