"""
Speech-to-text service using AWS Transcribe Streaming as primary,
with Groq Whisper as fallback.
"""

import asyncio
import os
import requests

# Try to import AWS Transcribe Streaming SDK
try:
    from amazon_transcribe.client import TranscribeStreamingClient
    from amazon_transcribe.handlers import TranscriptResultStreamHandler
    from amazon_transcribe.model import TranscriptEvent
    HAS_TRANSCRIBE_SDK = True
except ImportError:
    HAS_TRANSCRIBE_SDK = False


def _get_audio_format(mime_type: str) -> str:
    """Map mime type to file extension."""
    if "webm" in mime_type:
        return "webm"
    elif "ogg" in mime_type:
        return "ogg"
    elif "mp4" in mime_type:
        return "mp4"
    elif "wav" in mime_type:
        return "wav"
    else:
        return "webm"


def _get_transcribe_media_encoding(mime_type: str) -> str:
    """Map mime type to AWS Transcribe media encoding."""
    if "ogg" in mime_type:
        return "ogg-opus"
    elif "flac" in mime_type:
        return "flac"
    elif "wav" in mime_type:
        return "pcm"
    else:
        # Default to ogg-opus for webm/opus which is common from browser MediaRecorder
        return "ogg-opus"


class _TranscriptHandler(TranscriptResultStreamHandler):
    """Handler that accumulates transcript results from AWS Transcribe Streaming."""

    def __init__(self, stream):
        super().__init__(stream)
        self.transcript_parts = []

    async def handle_transcript_event(self, transcript_event: TranscriptEvent):
        results = transcript_event.transcript.results
        for result in results:
            if not result.is_partial:
                for alt in result.alternatives:
                    self.transcript_parts.append(alt.transcript)


async def _transcribe_with_aws(audio_bytes: bytes, mime_type: str) -> str:
    """Transcribe audio using AWS Transcribe Streaming SDK."""
    region = os.getenv("AWS_REGION", "us-east-1")

    client = TranscribeStreamingClient(region=region)

    media_encoding = _get_transcribe_media_encoding(mime_type)

    stream = await client.start_stream_transcription(
        language_code="en-US",
        media_sample_rate_hz=48000,
        media_encoding=media_encoding,
    )

    # Send audio data in chunks
    chunk_size = 1024 * 16  # 16KB chunks
    for i in range(0, len(audio_bytes), chunk_size):
        chunk = audio_bytes[i:i + chunk_size]
        await stream.input_stream.send_audio_event(audio_chunk=chunk)

    # Signal end of audio
    await stream.input_stream.end_stream()

    # Process results
    handler = _TranscriptHandler(stream.output_stream)
    await handler.handle_events()

    transcript = " ".join(handler.transcript_parts).strip()
    if not transcript:
        raise ValueError("No transcript produced — audio may be too short or unclear")

    return transcript


def _transcribe_with_groq(audio_bytes: bytes, mime_type: str) -> str:
    """Transcribe audio using Groq Whisper API (fallback)."""
    groq_key = os.getenv("GROQ_API_KEY")

    if not groq_key or groq_key == "your-key-here":
        raise ValueError(
            "Groq API key not configured — set GROQ_API_KEY in backend/.env"
        )

    ext = _get_audio_format(mime_type)

    try:
        response = requests.post(
            "https://api.groq.com/openai/v1/audio/transcriptions",
            headers={"Authorization": f"Bearer {groq_key}"},
            files={"file": (f"recording.{ext}", audio_bytes, mime_type)},
            data={"model": "whisper-large-v3-turbo", "language": "en"},
            timeout=30,
        )

        if response.status_code != 200:
            raise ValueError(
                f"Groq Whisper error (HTTP {response.status_code}): {response.text}"
            )

        result = response.json()
        transcript = result.get("text", "").strip()

        if not transcript:
            raise ValueError(
                "No transcript produced — audio may be too short or unclear"
            )

        return transcript

    except requests.exceptions.Timeout:
        raise ValueError("Transcription timed out — try again")
    except requests.exceptions.ConnectionError:
        raise ValueError("Cannot reach Groq API — check your internet connection")
    except Exception as e:
        if isinstance(e, ValueError):
            raise
        raise ValueError(f"Groq transcription failed: {e}") from e


def transcribe_audio(audio_bytes: bytes, mime_type: str) -> str:
    """Transcribe audio bytes to text.

    Tries AWS Transcribe Streaming first, falls back to Groq Whisper.
    """
    # Try AWS Transcribe Streaming first
    if HAS_TRANSCRIBE_SDK:
        try:
            # Run the async AWS Transcribe function synchronously
            loop = asyncio.new_event_loop()
            try:
                transcript = loop.run_until_complete(
                    _transcribe_with_aws(audio_bytes, mime_type)
                )
                return transcript
            finally:
                loop.close()
        except Exception as e:
            print(f"[nova_sonic] AWS Transcribe failed, falling back to Groq: {e}")
    else:
        print("[nova_sonic] amazon-transcribe SDK not available, using Groq Whisper")

    # Fall back to Groq Whisper
    return _transcribe_with_groq(audio_bytes, mime_type)


def transcribe_audio_streaming(audio_chunks: list, mime_type: str) -> str:
    """Transcribe pre-accumulated audio chunks."""
    audio_bytes = b"".join(audio_chunks)
    return transcribe_audio(audio_bytes, mime_type)
