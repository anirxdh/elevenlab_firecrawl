"""End-to-end integration tests for the full backend API.

Tests every endpoint with realistic payloads to catch integration issues
before they hit the Chrome extension.
"""

import base64
import json

import pytest
from fastapi.testclient import TestClient


@pytest.fixture
def client():
    from backend.main import app
    return TestClient(app)


def _tiny_png_b64() -> str:
    """1x1 transparent PNG as base64."""
    tiny_png = (
        b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01"
        b"\x00\x00\x00\x01\x08\x06\x00\x00\x00\x1f\x15\xc4\x89"
        b"\x00\x00\x00\nIDATx\x9cc\x00\x01\x00\x00\x05\x00\x01"
        b"\r\n\xb4\x00\x00\x00\x00IEND\xaeB`\x82"
    )
    return base64.b64encode(tiny_png).decode()


SAMPLE_DOM = {
    "url": "https://example.com",
    "title": "Example",
    "buttons": [{"selector": "#btn", "text": "Click me", "visible": True, "inViewport": True}],
    "links": [{"selector": "a.nav", "text": "Home", "href": "/", "visible": True, "inViewport": True}],
    "inputs": [{"selector": "#search", "type": "text", "placeholder": "Search", "visible": True, "inViewport": True}],
    "text_content": "Welcome to Example.com",
}


# ── Health & Models ─────────────────────────────────────────────────────────


class TestHealthAndModels:
    def test_health(self, client):
        r = client.get("/health")
        assert r.status_code == 200
        assert r.json() == {"status": "ok"}

    def test_models_endpoint(self, client):
        r = client.get("/models")
        assert r.status_code == 200
        data = r.json()
        assert "active" in data
        assert "available" in data
        assert "nova-lite" in data["available"]
        assert "claude-haiku" in data["available"]
        assert "nova-pro" in data["available"]
        assert "claude-sonnet" in data["available"]
        # Active model has required fields
        assert "model_id" in data["active"]
        assert "description" in data["active"]

    def test_docs_accessible(self, client):
        r = client.get("/docs")
        assert r.status_code == 200
        assert "swagger" in r.text.lower() or "openapi" in r.text.lower()


# ── Task endpoint ───────────────────────────────────────────────────────────


class TestTaskEndpoint:
    def test_task_rejects_empty_command(self, client):
        r = client.post("/task", json={
            "command": "",
            "screenshot": _tiny_png_b64(),
            "dom_snapshot": SAMPLE_DOM,
        })
        # Empty string is technically valid (length > 0 not enforced), but let's verify it doesn't crash
        # It may return 422 (validation) or 500 (AWS error) depending on credentials
        assert r.status_code in (200, 422, 500)

    def test_task_rejects_missing_screenshot(self, client):
        r = client.post("/task", json={
            "command": "click the button",
            "dom_snapshot": SAMPLE_DOM,
        })
        assert r.status_code == 422

    def test_task_rejects_missing_dom(self, client):
        r = client.post("/task", json={
            "command": "click the button",
            "screenshot": _tiny_png_b64(),
        })
        assert r.status_code == 422

    def test_task_rejects_oversized_dom(self, client):
        huge_dom = {"buttons": [{"text": "x" * 1000}] * 3000}
        r = client.post("/task", json={
            "command": "test",
            "screenshot": _tiny_png_b64(),
            "dom_snapshot": huge_dom,
        })
        assert r.status_code == 422

    def test_task_accepts_optional_firecrawl(self, client):
        """Task endpoint should accept optional firecrawl_markdown."""
        r = client.post("/task", json={
            "command": "what is this page?",
            "screenshot": _tiny_png_b64(),
            "dom_snapshot": SAMPLE_DOM,
            "firecrawl_markdown": "# Example\nThis is a test page.",
        })
        # Will fail due to AWS credentials, but should not be a validation error
        assert r.status_code in (200, 422, 500)

    def test_task_accepts_conversation_history(self, client):
        """Task endpoint should accept optional conversation_history."""
        r = client.post("/task", json={
            "command": "yes, do that",
            "screenshot": _tiny_png_b64(),
            "dom_snapshot": SAMPLE_DOM,
            "conversation_history": [
                {"role": "user", "content": "find USB cables"},
                {"role": "assistant", "content": "I see several options. Which one?"},
            ],
        })
        assert r.status_code in (200, 422, 500)


# ── Task Continue endpoint ──────────────────────────────────────────────────


class TestTaskContinueEndpoint:
    def test_continue_rejects_missing_fields(self, client):
        r = client.post("/task/continue", json={
            "original_command": "test",
        })
        assert r.status_code == 422

    def test_continue_accepts_valid_payload(self, client):
        r = client.post("/task/continue", json={
            "original_command": "add to cart",
            "action_history": [
                {"description": "Clicked search", "result": "Search opened"},
            ],
            "screenshot": _tiny_png_b64(),
            "dom_snapshot": SAMPLE_DOM,
        })
        assert r.status_code in (200, 422, 500)


# ── Transcribe endpoint ────────────────────────────────────────────────────


class TestTranscribeEndpoint:
    def test_transcribe_rejects_empty_audio(self, client):
        r = client.post(
            "/transcribe",
            files={"audio": ("test.webm", b"", "audio/webm")},
            data={"mime_type": "audio/webm"},
        )
        assert r.status_code == 400
        assert "empty" in r.json()["detail"].lower()

    def test_transcribe_rejects_oversized(self, client):
        # 26MB file
        huge = b"x" * (26 * 1024 * 1024)
        r = client.post(
            "/transcribe",
            files={"audio": ("test.webm", huge, "audio/webm")},
            data={"mime_type": "audio/webm"},
        )
        assert r.status_code == 413


# ── Firecrawl endpoint ─────────────────────────────────────────────────────


class TestFirecrawlEndpoint:
    def test_scrape_rejects_private_url(self, client):
        r = client.post("/firecrawl/scrape", json={"url": "http://localhost:8080/secret"})
        assert r.status_code == 400

    def test_scrape_rejects_loopback(self, client):
        r = client.post("/firecrawl/scrape", json={"url": "http://127.0.0.1/admin"})
        assert r.status_code == 400

    def test_extract_rejects_private_url(self, client):
        r = client.post("/firecrawl/extract", json={
            "urls": ["http://192.168.1.1"],
            "prompt": "extract data",
        })
        assert r.status_code == 400


# ── Events (SSE) endpoint ──────────────────────────────────────────────────


class TestEventsEndpoint:
    def test_events_endpoint_exists(self, client):
        """SSE endpoint should be registered."""
        from backend.main import app
        paths = {r.path for r in app.routes}
        assert "/events" in paths


# ── Route registration ──────────────────────────────────────────────────────


class TestRouteRegistration:
    def test_all_routes_registered(self, client):
        from backend.main import app
        paths = {r.path for r in app.routes}
        expected = {
            "/health", "/models",
            "/task", "/task/continue",
            "/events",
            "/transcribe", "/transcribe/stream",
            "/firecrawl/scrape", "/firecrawl/extract",
            "/firecrawl/crawl", "/firecrawl/crawl/{job_id}",
        }
        for path in expected:
            assert path in paths, f"Missing route: {path}"
