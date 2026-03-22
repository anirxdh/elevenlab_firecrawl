"""Shared pytest fixtures for ScreenSense backend tests."""

import os
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient


@pytest.fixture(autouse=True)
def mock_aws_credentials():
    """Set mock AWS credentials for every test so real credentials are never used."""
    env_vars = {
        "AWS_ACCESS_KEY_ID": "test-access-key-id",
        "AWS_SECRET_ACCESS_KEY": "test-secret-access-key",
        "AWS_REGION": "us-east-1",
        "GROQ_API_KEY": "test-groq-api-key",
    }
    with patch.dict(os.environ, env_vars):
        yield


@pytest.fixture(autouse=True)
def reset_bedrock_client_cache():
    """Reset the cached Bedrock client before each test so mocks take effect."""
    import backend.services.nova_reasoning as nr
    nr._bedrock_client = None
    yield
    nr._bedrock_client = None


@pytest.fixture()
def client():
    """Create a FastAPI TestClient that can be used to make requests."""
    from backend.main import app

    return TestClient(app)


@pytest.fixture()
def sample_audio_bytes() -> bytes:
    """Return a small, non-empty byte string that simulates audio data."""
    # 1024 bytes of zeros — enough to pass the "not empty" check
    return b"\x00" * 1024


@pytest.fixture()
def sample_audio_bytes_oversized() -> bytes:
    """Return audio bytes exceeding the 25 MB limit."""
    return b"\x00" * (25 * 1024 * 1024 + 1)


@pytest.fixture()
def sample_task_payload() -> dict:
    """Return a valid TaskRequest payload."""
    import base64

    # 1x1 transparent PNG (89 bytes)
    tiny_png = (
        b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01"
        b"\x00\x00\x00\x01\x08\x06\x00\x00\x00\x1f\x15\xc4\x89"
        b"\x00\x00\x00\nIDATx\x9cc\x00\x01\x00\x00\x05\x00\x01"
        b"\r\n\xb4\x00\x00\x00\x00IEND\xaeB`\x82"
    )
    return {
        "command": "What is the price?",
        "screenshot": base64.b64encode(tiny_png).decode(),
        "dom_snapshot": {
            "url": "https://example.com",
            "title": "Example Page",
            "buttons": [],
            "links": [],
            "inputs": [],
            "text_content": "Hello world",
        },
    }
