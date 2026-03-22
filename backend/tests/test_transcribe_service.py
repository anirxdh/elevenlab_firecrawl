"""Unit tests for the nova_sonic (Groq Whisper) transcription service."""

import os
from unittest.mock import MagicMock, patch

import pytest

from backend.services.nova_sonic import transcribe_audio


class TestCredentialValidation:
    """Verify that missing or placeholder API keys raise ValueError."""

    def test_raises_when_groq_key_missing(self):
        """transcribe_audio() raises ValueError when GROQ_API_KEY is empty."""
        with patch.dict(os.environ, {"GROQ_API_KEY": ""}):
            with pytest.raises(ValueError, match="(?i)groq.*key"):
                transcribe_audio(b"\x00" * 100, "audio/webm")

    def test_raises_when_groq_key_is_placeholder(self):
        """transcribe_audio() raises ValueError when key is 'your-key-here'."""
        with patch.dict(os.environ, {"GROQ_API_KEY": "your-key-here"}):
            with pytest.raises(ValueError, match="(?i)groq.*key"):
                transcribe_audio(b"\x00" * 100, "audio/webm")


class TestTranscribeAudio:
    """Test transcribe_audio() with mocked HTTP requests."""

    @patch("backend.services.nova_sonic.requests.post")
    def test_successful_transcription_returns_text(self, mock_post):
        """A successful Groq API response should return the transcript text."""
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = {"text": "Hello, this is a test."}
        mock_post.return_value = mock_response

        result = transcribe_audio(b"\x00" * 100, "audio/webm")

        assert result == "Hello, this is a test."

    @patch("backend.services.nova_sonic.requests.post")
    def test_correct_groq_api_url_called(self, mock_post):
        """Verify the correct Groq API URL is called."""
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = {"text": "transcript"}
        mock_post.return_value = mock_response

        transcribe_audio(b"\x00" * 100, "audio/webm")

        call_args = mock_post.call_args
        assert call_args.args[0] == "https://api.groq.com/openai/v1/audio/transcriptions"

    @patch("backend.services.nova_sonic.requests.post")
    def test_correct_authorization_header_sent(self, mock_post):
        """Verify the Authorization header contains the Groq API key."""
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = {"text": "transcript"}
        mock_post.return_value = mock_response

        with patch.dict(os.environ, {"GROQ_API_KEY": "test-key-123"}):
            transcribe_audio(b"\x00" * 100, "audio/webm")

        call_kwargs = mock_post.call_args
        assert call_kwargs.kwargs["headers"]["Authorization"] == "Bearer test-key-123"

    @patch("backend.services.nova_sonic.requests.post")
    def test_empty_transcript_raises_value_error(self, mock_post):
        """When the API returns an empty transcript, ValueError should be raised."""
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = {"text": ""}
        mock_post.return_value = mock_response

        with pytest.raises(ValueError, match="(?i)no transcript"):
            transcribe_audio(b"\x00" * 100, "audio/webm")

    @patch("backend.services.nova_sonic.requests.post")
    def test_whitespace_only_transcript_raises_value_error(self, mock_post):
        """When the API returns whitespace-only transcript, ValueError should be raised."""
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = {"text": "   \n\t  "}
        mock_post.return_value = mock_response

        with pytest.raises(ValueError, match="(?i)no transcript"):
            transcribe_audio(b"\x00" * 100, "audio/webm")

    @patch("backend.services.nova_sonic.requests.post")
    def test_non_200_status_raises_value_error(self, mock_post):
        """Non-200 HTTP status from Groq should raise ValueError."""
        mock_response = MagicMock()
        mock_response.status_code = 401
        mock_response.text = "Unauthorized"
        mock_post.return_value = mock_response

        with pytest.raises(ValueError, match="401"):
            transcribe_audio(b"\x00" * 100, "audio/webm")

    @patch("backend.services.nova_sonic.requests.post")
    def test_mime_type_determines_file_extension(self, mock_post):
        """The file extension in the upload should match the mime type."""
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = {"text": "ok"}
        mock_post.return_value = mock_response

        for mime, expected_ext in [
            ("audio/webm", "webm"),
            ("audio/ogg", "ogg"),
            ("audio/mp4", "mp4"),
            ("audio/wav", "wav"),
            ("audio/unknown", "webm"),  # fallback
        ]:
            transcribe_audio(b"\x00" * 100, mime)
            call_kwargs = mock_post.call_args
            files_arg = call_kwargs.kwargs["files"]["file"]
            filename = files_arg[0]
            assert filename == f"recording.{expected_ext}", (
                f"For mime={mime}, expected recording.{expected_ext} but got {filename}"
            )

    @patch("backend.services.nova_sonic.requests.post")
    def test_timeout_raises_value_error(self, mock_post):
        """A timeout from requests should raise ValueError."""
        import requests

        mock_post.side_effect = requests.exceptions.Timeout("Connection timed out")

        with pytest.raises(ValueError, match="(?i)timed out"):
            transcribe_audio(b"\x00" * 100, "audio/webm")

    @patch("backend.services.nova_sonic.requests.post")
    def test_connection_error_raises_value_error(self, mock_post):
        """A connection error from requests should raise ValueError."""
        import requests

        mock_post.side_effect = requests.exceptions.ConnectionError("Refused")

        with pytest.raises(ValueError, match="(?i)reach"):
            transcribe_audio(b"\x00" * 100, "audio/webm")
