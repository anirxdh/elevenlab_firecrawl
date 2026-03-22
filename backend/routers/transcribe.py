import asyncio

from fastapi import APIRouter, File, Form, HTTPException, UploadFile, WebSocket, WebSocketDisconnect

from backend.services.event_bus import event_bus
from backend.services.nova_sonic import transcribe_audio, transcribe_audio_streaming

router = APIRouter()


@router.post("/transcribe")
async def transcribe(
    audio: UploadFile = File(...),
    mime_type: str = Form(default="audio/webm"),
):
    """Receive audio file, transcribe via Nova Sonic, return transcript."""
    audio_bytes = await audio.read()

    if len(audio_bytes) == 0:
        raise HTTPException(status_code=400, detail="Empty audio file")

    if len(audio_bytes) > 25 * 1024 * 1024:  # 25 MB limit
        raise HTTPException(status_code=413, detail="Audio file too large (max 25MB)")

    await event_bus.emit("status", {"stage": "transcribing"})

    try:
        # boto3 is synchronous — run it in a thread pool to avoid blocking the event loop
        transcript = await asyncio.to_thread(transcribe_audio, audio_bytes, mime_type)
        await event_bus.emit("status", {"stage": "done", "transcript": transcript})
        return {"transcript": transcript}
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
        raise HTTPException(status_code=500, detail=f"Transcription failed: {error_msg}")


@router.websocket("/transcribe/stream")
async def transcribe_stream(ws: WebSocket):
    """WebSocket endpoint for streaming transcription.

    Protocol:
    1. Client connects and sends a JSON config message: {"mime_type": "audio/webm"}
    2. Client sends binary audio chunks (accumulated during recording)
    3. Client closes the WebSocket OR sends {"action": "done"} to signal end of audio
    4. Server transcribes the accumulated chunks and sends {"transcript": "..."}

    This eliminates upload latency: the audio data is already on the server
    when the user releases the key, so transcription begins immediately.
    The batch POST /transcribe endpoint remains unchanged as the fallback.
    """
    await ws.accept()
    chunks: list = []
    mime_type = "audio/webm"
    total_bytes = 0

    try:
        while True:
            try:
                data = await ws.receive()
            except WebSocketDisconnect:
                # Client closed the connection — proceed to transcription
                break

            if "text" in data and data["text"] is not None:
                import json
                try:
                    msg = json.loads(data["text"])
                except (json.JSONDecodeError, TypeError):
                    msg = {}

                if msg.get("action") == "done":
                    # Client signalled end of audio — proceed to transcription
                    break
                elif "mime_type" in msg:
                    mime_type = msg["mime_type"]

            elif "bytes" in data and data["bytes"] is not None:
                total_bytes += len(data["bytes"])
                if total_bytes > 25 * 1024 * 1024:
                    await ws.send_json({"error": "Audio too large (max 25MB)"})
                    break
                chunks.append(data["bytes"])

        # Transcribe the accumulated chunks
        await event_bus.emit("status", {"stage": "transcribing"})

        if not chunks:
            await ws.send_json({"error": "No audio data received"})
            await ws.close()
            return

        transcript = await asyncio.to_thread(transcribe_audio_streaming, chunks, mime_type)
        await event_bus.emit("status", {"stage": "done", "transcript": transcript})
        await ws.send_json({"transcript": transcript})

    except Exception as e:
        error_msg = str(e)
        try:
            await ws.send_json({"error": error_msg})
        except Exception:
            pass  # WebSocket may already be closed
    finally:
        try:
            await ws.close()
        except Exception:
            pass  # Already closed
