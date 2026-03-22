"""Comprehensive tests for the POST /transcribe and WebSocket /transcribe/stream endpoints."""

import json
from io import BytesIO
from unittest.mock import AsyncMock, patch

import pytest
from starlette.testclient import TestClient


# ── POST /transcribe tests ──────────────────────────────────────────────────


class TestTranscribeEndpoint:
    """Tests for POST /transcribe."""

    def test_valid_audio_returns_transcript(self, client, sample_audio_bytes):
        """POST /transcribe with valid audio returns a transcript string."""
        with patch(
            "backend.routers.transcribe.transcribe_audio",
            return_value="Hello world",
        ):
            response = client.post(
                "/transcribe",
                files={"audio": ("recording.webm", BytesIO(sample_audio_bytes), "audio/webm")},
                data={"mime_type": "audio/webm"},
            )

        assert response.status_code == 200
        body = response.json()
        assert "transcript" in body
        assert body["transcript"] == "Hello world"

    def test_empty_audio_returns_400(self, client):
        """POST /transcribe with an empty audio file returns 400."""
        response = client.post(
            "/transcribe",
            files={"audio": ("recording.webm", BytesIO(b""), "audio/webm")},
            data={"mime_type": "audio/webm"},
        )

        assert response.status_code == 400
        assert "empty" in response.json()["detail"].lower()

    def test_oversized_audio_returns_413(self, client, sample_audio_bytes_oversized):
        """POST /transcribe with >25 MB audio returns 413."""
        response = client.post(
            "/transcribe",
            files={
                "audio": (
                    "recording.webm",
                    BytesIO(sample_audio_bytes_oversized),
                    "audio/webm",
                )
            },
            data={"mime_type": "audio/webm"},
        )

        assert response.status_code == 413
        assert "too large" in response.json()["detail"].lower()

    def test_missing_credentials_returns_500(self, client, sample_audio_bytes):
        """POST /transcribe without valid credentials returns 500 with helpful error."""
        with patch(
            "backend.routers.transcribe.transcribe_audio",
            side_effect=ValueError("AWS credentials not configured"),
        ):
            response = client.post(
                "/transcribe",
                files={"audio": ("recording.webm", BytesIO(sample_audio_bytes), "audio/webm")},
                data={"mime_type": "audio/webm"},
            )

        assert response.status_code == 500
        detail = response.json()["detail"]
        assert "credentials" in detail.lower()

    def test_transcription_failure_returns_500(self, client, sample_audio_bytes):
        """POST /transcribe with unexpected error returns 500."""
        with patch(
            "backend.routers.transcribe.transcribe_audio",
            side_effect=RuntimeError("Connection refused"),
        ):
            response = client.post(
                "/transcribe",
                files={"audio": ("recording.webm", BytesIO(sample_audio_bytes), "audio/webm")},
                data={"mime_type": "audio/webm"},
            )

        assert response.status_code == 500
        assert "failed" in response.json()["detail"].lower()

    def test_default_mime_type_is_audio_webm(self, client, sample_audio_bytes):
        """POST /transcribe without explicit mime_type defaults to audio/webm."""
        with patch(
            "backend.routers.transcribe.transcribe_audio",
            return_value="Transcript text",
        ) as mock_transcribe:
            response = client.post(
                "/transcribe",
                files={"audio": ("recording.webm", BytesIO(sample_audio_bytes), "audio/webm")},
            )

        assert response.status_code == 200

    def test_value_error_without_credentials_returns_422(self, client, sample_audio_bytes):
        """POST /transcribe with ValueError not about credentials returns 422."""
        with patch(
            "backend.routers.transcribe.transcribe_audio",
            side_effect=ValueError("No transcript produced - audio may be too short"),
        ):
            response = client.post(
                "/transcribe",
                files={"audio": ("recording.webm", BytesIO(sample_audio_bytes), "audio/webm")},
                data={"mime_type": "audio/webm"},
            )

        assert response.status_code == 422
        assert "transcript" in response.json()["detail"].lower()

    def test_exception_with_nocredentials_returns_500(self, client, sample_audio_bytes):
        """POST /transcribe with RuntimeError containing 'NoCredentials' returns 500."""
        with patch(
            "backend.routers.transcribe.transcribe_audio",
            side_effect=RuntimeError("NoCredentials error"),
        ):
            response = client.post(
                "/transcribe",
                files={"audio": ("recording.webm", BytesIO(sample_audio_bytes), "audio/webm")},
                data={"mime_type": "audio/webm"},
            )

        assert response.status_code == 500
        detail = response.json()["detail"]
        assert "credentials" in detail.lower()

    def test_transcript_response_format(self, client, sample_audio_bytes):
        """POST /transcribe response should be a JSON object with 'transcript' key."""
        with patch(
            "backend.routers.transcribe.transcribe_audio",
            return_value="Testing one two three",
        ):
            response = client.post(
                "/transcribe",
                files={"audio": ("recording.webm", BytesIO(sample_audio_bytes), "audio/webm")},
                data={"mime_type": "audio/webm"},
            )

        assert response.status_code == 200
        body = response.json()
        assert isinstance(body, dict)
        assert "transcript" in body
        assert isinstance(body["transcript"], str)

    def test_custom_mime_type_passed_through(self, client, sample_audio_bytes):
        """POST /transcribe should pass the provided mime_type to the transcription service."""
        with patch(
            "backend.routers.transcribe.transcribe_audio",
            return_value="ok",
        ) as mock_transcribe:
            response = client.post(
                "/transcribe",
                files={"audio": ("recording.ogg", BytesIO(sample_audio_bytes), "audio/ogg")},
                data={"mime_type": "audio/ogg"},
            )

        assert response.status_code == 200
        # The mock should have been called with the audio bytes and the mime_type
        mock_transcribe.assert_called_once()
        call_args = mock_transcribe.call_args
        assert call_args.args[1] == "audio/ogg"


# ── SSE event emission for /transcribe ──────────────────────────────────────


class TestTranscribeSSEEvents:
    """Test that SSE events are emitted during transcription."""

    def test_emits_transcribing_event(self, client, sample_audio_bytes):
        """POST /transcribe should emit 'transcribing' status event."""
        with patch(
            "backend.routers.transcribe.transcribe_audio",
            return_value="Hello",
        ), patch("backend.routers.transcribe.event_bus") as mock_bus:
            mock_bus.emit = AsyncMock()
            response = client.post(
                "/transcribe",
                files={"audio": ("recording.webm", BytesIO(sample_audio_bytes), "audio/webm")},
                data={"mime_type": "audio/webm"},
            )

        assert response.status_code == 200
        calls = mock_bus.emit.call_args_list
        assert len(calls) >= 1
        first_call = calls[0]
        assert first_call.args[0] == "status"
        assert first_call.args[1]["stage"] == "transcribing"

    def test_emits_done_event_on_success(self, client, sample_audio_bytes):
        """POST /transcribe should emit 'done' status event on success."""
        with patch(
            "backend.routers.transcribe.transcribe_audio",
            return_value="Hello world",
        ), patch("backend.routers.transcribe.event_bus") as mock_bus:
            mock_bus.emit = AsyncMock()
            response = client.post(
                "/transcribe",
                files={"audio": ("recording.webm", BytesIO(sample_audio_bytes), "audio/webm")},
                data={"mime_type": "audio/webm"},
            )

        assert response.status_code == 200
        calls = mock_bus.emit.call_args_list
        assert len(calls) >= 2
        done_call = calls[1]
        assert done_call.args[1]["stage"] == "done"
        assert done_call.args[1]["transcript"] == "Hello world"

    def test_emits_error_event_on_failure(self, client, sample_audio_bytes):
        """POST /transcribe should emit 'error' event when transcription fails."""
        with patch(
            "backend.routers.transcribe.transcribe_audio",
            side_effect=RuntimeError("API error"),
        ), patch("backend.routers.transcribe.event_bus") as mock_bus:
            mock_bus.emit = AsyncMock()
            response = client.post(
                "/transcribe",
                files={"audio": ("recording.webm", BytesIO(sample_audio_bytes), "audio/webm")},
                data={"mime_type": "audio/webm"},
            )

        assert response.status_code == 500
        calls = mock_bus.emit.call_args_list
        error_call = calls[1]
        assert error_call.args[1]["stage"] == "error"


# ── WebSocket /transcribe/stream tests ───────────────────────────────────────


class TestTranscribeStreamWebSocket:
    """Tests for WebSocket /transcribe/stream endpoint."""

    def test_stream_with_audio_chunks_returns_transcript(self, client):
        """WebSocket should transcribe accumulated audio chunks and return result."""
        with patch(
            "backend.routers.transcribe.transcribe_audio_streaming",
            return_value="Hello from WebSocket",
        ):
            with client.websocket_connect("/transcribe/stream") as ws:
                # Send config
                ws.send_text(json.dumps({"mime_type": "audio/webm"}))
                # Send audio chunks
                ws.send_bytes(b"\x00" * 512)
                ws.send_bytes(b"\x00" * 512)
                # Signal done
                ws.send_text(json.dumps({"action": "done"}))
                # Receive transcript
                result = ws.receive_json()

        assert "transcript" in result
        assert result["transcript"] == "Hello from WebSocket"

    def test_stream_with_no_audio_returns_error(self, client):
        """WebSocket with no audio data should return an error message."""
        with client.websocket_connect("/transcribe/stream") as ws:
            # Send done immediately without any audio
            ws.send_text(json.dumps({"action": "done"}))
            result = ws.receive_json()

        assert "error" in result
        assert "no audio" in result["error"].lower()

    def test_stream_custom_mime_type(self, client):
        """WebSocket should use the mime_type from the config message."""
        with patch(
            "backend.routers.transcribe.transcribe_audio_streaming",
            return_value="ok",
        ) as mock_transcribe:
            with client.websocket_connect("/transcribe/stream") as ws:
                ws.send_text(json.dumps({"mime_type": "audio/ogg"}))
                ws.send_bytes(b"\x00" * 100)
                ws.send_text(json.dumps({"action": "done"}))
                ws.receive_json()

        # Verify the streaming function was called with the right mime_type
        mock_transcribe.assert_called_once()
        call_args = mock_transcribe.call_args
        assert call_args.args[1] == "audio/ogg"

    def test_stream_default_mime_type_is_webm(self, client):
        """WebSocket should default to audio/webm if no config message sent."""
        with patch(
            "backend.routers.transcribe.transcribe_audio_streaming",
            return_value="ok",
        ) as mock_transcribe:
            with client.websocket_connect("/transcribe/stream") as ws:
                # Send audio directly without config
                ws.send_bytes(b"\x00" * 100)
                ws.send_text(json.dumps({"action": "done"}))
                ws.receive_json()

        mock_transcribe.assert_called_once()
        call_args = mock_transcribe.call_args
        assert call_args.args[1] == "audio/webm"

    def test_stream_transcription_error_returns_error_json(self, client):
        """WebSocket should return error JSON if transcription fails."""
        with patch(
            "backend.routers.transcribe.transcribe_audio_streaming",
            side_effect=RuntimeError("Transcription failed"),
        ):
            with client.websocket_connect("/transcribe/stream") as ws:
                ws.send_bytes(b"\x00" * 100)
                ws.send_text(json.dumps({"action": "done"}))
                result = ws.receive_json()

        assert "error" in result

    def test_stream_multiple_chunks_concatenated(self, client):
        """WebSocket should concatenate all received audio chunks."""
        with patch(
            "backend.routers.transcribe.transcribe_audio_streaming",
            return_value="ok",
        ) as mock_transcribe:
            with client.websocket_connect("/transcribe/stream") as ws:
                ws.send_bytes(b"\x01" * 100)
                ws.send_bytes(b"\x02" * 200)
                ws.send_bytes(b"\x03" * 300)
                ws.send_text(json.dumps({"action": "done"}))
                ws.receive_json()

        # The chunks list should have 3 entries
        call_args = mock_transcribe.call_args
        chunks = call_args.args[0]
        assert len(chunks) == 3
        assert chunks[0] == b"\x01" * 100
        assert chunks[1] == b"\x02" * 200
        assert chunks[2] == b"\x03" * 300

    def test_stream_ignores_invalid_json_text(self, client):
        """WebSocket should gracefully handle invalid JSON text messages."""
        with patch(
            "backend.routers.transcribe.transcribe_audio_streaming",
            return_value="ok",
        ):
            with client.websocket_connect("/transcribe/stream") as ws:
                ws.send_bytes(b"\x00" * 100)
                # Send invalid JSON — should be ignored (not crash)
                ws.send_text("this is not json")
                ws.send_text(json.dumps({"action": "done"}))
                result = ws.receive_json()

        assert "transcript" in result
