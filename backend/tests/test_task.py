"""Comprehensive tests for the POST /task and POST /task/continue endpoints."""

import base64
from unittest.mock import AsyncMock, patch

import pytest


# ── Shared helpers ──────────────────────────────────────────────────────────


def _make_continue_payload() -> dict:
    """Return a valid TaskContinueRequest payload."""
    tiny_png = (
        b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01"
        b"\x00\x00\x00\x01\x08\x06\x00\x00\x00\x1f\x15\xc4\x89"
        b"\x00\x00\x00\nIDATx\x9cc\x00\x01\x00\x00\x05\x00\x01"
        b"\r\n\xb4\x00\x00\x00\x00IEND\xaeB`\x82"
    )
    return {
        "original_command": "Click the buy button",
        "action_history": [
            {"description": "Clicked Buy Now", "result": "Success"}
        ],
        "screenshot": base64.b64encode(tiny_png).decode(),
        "dom_snapshot": {
            "url": "https://example.com",
            "title": "Example Page",
            "buttons": [],
            "links": [],
            "inputs": [],
            "text_content": "Purchase confirmed",
        },
    }


# ── POST /task tests ────────────────────────────────────────────────────────


class TestTaskEndpoint:
    """Tests for POST /task."""

    def test_question_returns_answer_type(self, client, sample_task_payload):
        """POST /task with a question command returns type=answer."""
        with patch(
            "backend.routers.task.reason_about_page",
            return_value={"type": "answer", "text": "The price is $29.99"},
        ):
            response = client.post("/task", json=sample_task_payload)

        assert response.status_code == 200
        body = response.json()
        assert body["type"] == "answer"
        assert "text" in body

    def test_action_command_returns_steps_type(self, client, sample_task_payload):
        """POST /task with an action command returns type=steps."""
        sample_task_payload["command"] = "Click the add to cart button"

        with patch(
            "backend.routers.task.reason_about_page",
            return_value={
                "type": "steps",
                "actions": [
                    {
                        "action": "click",
                        "selector": "#add-to-cart",
                        "description": "Click Add to Cart",
                    }
                ],
            },
        ):
            response = client.post("/task", json=sample_task_payload)

        assert response.status_code == 200
        body = response.json()
        assert body["type"] == "steps"
        assert isinstance(body["actions"], list)
        assert len(body["actions"]) > 0

    def test_missing_fields_returns_422(self, client):
        """POST /task with missing required fields returns 422."""
        # Missing 'screenshot' and 'dom_snapshot'
        response = client.post("/task", json={"command": "Hello"})
        assert response.status_code == 422

    def test_empty_body_returns_422(self, client):
        """POST /task with empty body returns 422."""
        response = client.post("/task", json={})
        assert response.status_code == 422

    def test_missing_credentials_returns_error(self, client, sample_task_payload):
        """POST /task without AWS credentials returns 500 with credential error."""
        with patch(
            "backend.routers.task.reason_about_page",
            side_effect=ValueError("AWS credentials not configured"),
        ):
            response = client.post("/task", json=sample_task_payload)

        assert response.status_code == 500
        detail = response.json()["detail"]
        assert "credentials" in detail.lower()

    def test_unexpected_error_returns_500(self, client, sample_task_payload):
        """POST /task with unexpected error returns 500."""
        with patch(
            "backend.routers.task.reason_about_page",
            side_effect=RuntimeError("Bedrock unavailable"),
        ):
            response = client.post("/task", json=sample_task_payload)

        assert response.status_code == 500
        assert "failed" in response.json()["detail"].lower()

    def test_invalid_json_returns_422(self, client):
        """POST /task with invalid JSON returns 422."""
        response = client.post(
            "/task",
            content=b"not json",
            headers={"Content-Type": "application/json"},
        )
        assert response.status_code == 422

    def test_value_error_without_credentials_returns_422(self, client, sample_task_payload):
        """POST /task with ValueError not about credentials returns 422."""
        with patch(
            "backend.routers.task.reason_about_page",
            side_effect=ValueError("Invalid screenshot_base64 - failed to decode"),
        ):
            response = client.post("/task", json=sample_task_payload)

        assert response.status_code == 422
        detail = response.json()["detail"]
        assert "screenshot" in detail.lower()

    def test_exception_with_credentials_keyword_returns_500(self, client, sample_task_payload):
        """POST /task with RuntimeError containing 'credentials' returns 500 with credential message."""
        with patch(
            "backend.routers.task.reason_about_page",
            side_effect=RuntimeError("NoCredentials found in environment"),
        ):
            response = client.post("/task", json=sample_task_payload)

        assert response.status_code == 500
        detail = response.json()["detail"]
        assert "credentials" in detail.lower()

    def test_response_preserves_full_result(self, client, sample_task_payload):
        """POST /task should return the full result dict from reason_about_page."""
        full_result = {
            "type": "answer",
            "reasoning": "I can see the price in the header",
            "text": "$19.99",
        }
        with patch(
            "backend.routers.task.reason_about_page",
            return_value=full_result,
        ):
            response = client.post("/task", json=sample_task_payload)

        assert response.status_code == 200
        body = response.json()
        assert body == full_result

    def test_missing_command_field_returns_422(self, client):
        """POST /task missing only 'command' returns 422."""
        import base64

        tiny_png = b"\x89PNG\r\n\x1a\n"
        payload = {
            "screenshot": base64.b64encode(tiny_png).decode(),
            "dom_snapshot": {"url": "https://example.com"},
        }
        response = client.post("/task", json=payload)
        assert response.status_code == 422

    def test_missing_screenshot_field_returns_422(self, client):
        """POST /task missing only 'screenshot' returns 422."""
        payload = {
            "command": "hello",
            "dom_snapshot": {"url": "https://example.com"},
        }
        response = client.post("/task", json=payload)
        assert response.status_code == 422

    def test_missing_dom_snapshot_field_returns_422(self, client):
        """POST /task missing only 'dom_snapshot' returns 422."""
        import base64

        tiny_png = b"\x89PNG\r\n\x1a\n"
        payload = {
            "command": "hello",
            "screenshot": base64.b64encode(tiny_png).decode(),
        }
        response = client.post("/task", json=payload)
        assert response.status_code == 422


# ── POST /task/continue tests ───────────────────────────────────────────────


class TestTaskContinueEndpoint:
    """Tests for POST /task/continue."""

    def test_done_response(self, client):
        """POST /task/continue when task is done returns type=done."""
        with patch(
            "backend.routers.task.reason_continue",
            return_value={"type": "done", "summary": "Purchase confirmed"},
        ):
            response = client.post("/task/continue", json=_make_continue_payload())

        assert response.status_code == 200
        body = response.json()
        assert body["type"] == "done"
        assert body["summary"] == "Purchase confirmed"

    def test_steps_response(self, client):
        """POST /task/continue when more steps needed returns type=steps."""
        with patch(
            "backend.routers.task.reason_continue",
            return_value={
                "type": "steps",
                "actions": [
                    {"action": "click", "selector": "#confirm", "description": "Click confirm"}
                ],
            },
        ):
            response = client.post("/task/continue", json=_make_continue_payload())

        assert response.status_code == 200
        body = response.json()
        assert body["type"] == "steps"
        assert len(body["actions"]) == 1

    def test_answer_response(self, client):
        """POST /task/continue can return type=answer."""
        with patch(
            "backend.routers.task.reason_continue",
            return_value={"type": "answer", "text": "I found 3 results"},
        ):
            response = client.post("/task/continue", json=_make_continue_payload())

        assert response.status_code == 200
        body = response.json()
        assert body["type"] == "answer"

    def test_missing_fields_returns_422(self, client):
        """POST /task/continue with missing fields returns 422."""
        response = client.post("/task/continue", json={"original_command": "test"})
        assert response.status_code == 422

    def test_empty_body_returns_422(self, client):
        """POST /task/continue with empty body returns 422."""
        response = client.post("/task/continue", json={})
        assert response.status_code == 422

    def test_invalid_json_returns_422(self, client):
        """POST /task/continue with invalid JSON returns 422."""
        response = client.post(
            "/task/continue",
            content=b"not json",
            headers={"Content-Type": "application/json"},
        )
        assert response.status_code == 422

    def test_missing_credentials_returns_500(self, client):
        """POST /task/continue without AWS credentials returns 500."""
        with patch(
            "backend.routers.task.reason_continue",
            side_effect=ValueError("AWS credentials not configured"),
        ):
            response = client.post("/task/continue", json=_make_continue_payload())

        assert response.status_code == 500
        detail = response.json()["detail"]
        assert "credentials" in detail.lower()

    def test_unexpected_error_returns_500(self, client):
        """POST /task/continue with unexpected error returns 500."""
        with patch(
            "backend.routers.task.reason_continue",
            side_effect=RuntimeError("Bedrock unavailable"),
        ):
            response = client.post("/task/continue", json=_make_continue_payload())

        assert response.status_code == 500
        assert "failed" in response.json()["detail"].lower()

    def test_value_error_without_credentials_returns_422(self, client):
        """POST /task/continue with ValueError not about credentials returns 422."""
        with patch(
            "backend.routers.task.reason_continue",
            side_effect=ValueError("Invalid screenshot_base64 - failed to decode"),
        ):
            response = client.post("/task/continue", json=_make_continue_payload())

        assert response.status_code == 422

    def test_exception_with_nocredentials_returns_500(self, client):
        """POST /task/continue with RuntimeError containing 'NoCredentials' returns 500."""
        with patch(
            "backend.routers.task.reason_continue",
            side_effect=RuntimeError("NoCredentials error"),
        ):
            response = client.post("/task/continue", json=_make_continue_payload())

        assert response.status_code == 500
        detail = response.json()["detail"]
        assert "credentials" in detail.lower()

    def test_response_preserves_full_result(self, client):
        """POST /task/continue should return the full result dict."""
        full_result = {
            "type": "done",
            "reasoning": "Task looks complete",
            "summary": "All done",
        }
        with patch(
            "backend.routers.task.reason_continue",
            return_value=full_result,
        ):
            response = client.post("/task/continue", json=_make_continue_payload())

        assert response.status_code == 200
        assert response.json() == full_result

    def test_empty_action_history_accepted(self, client):
        """POST /task/continue with empty action_history is valid."""
        payload = _make_continue_payload()
        payload["action_history"] = []

        with patch(
            "backend.routers.task.reason_continue",
            return_value={"type": "done", "summary": "Nothing was done"},
        ):
            response = client.post("/task/continue", json=payload)

        assert response.status_code == 200


# ── TaskRequest / TaskContinueRequest validation ─────────────────────────────


class TestRequestModelValidation:
    """Test Pydantic model validation for TaskRequest and TaskContinueRequest."""

    def test_task_request_rejects_non_string_command(self, client):
        """TaskRequest.command must be a string; an integer should be rejected."""
        import base64

        tiny_png = b"\x89PNG\r\n\x1a\n"
        payload = {
            "command": 12345,  # Not a string
            "screenshot": base64.b64encode(tiny_png).decode(),
            "dom_snapshot": {"url": "https://example.com"},
        }
        response = client.post("/task", json=payload)
        assert response.status_code == 422

    def test_task_request_dom_snapshot_must_be_dict(self, client):
        """TaskRequest.dom_snapshot must be a dict/object."""
        import base64

        tiny_png = b"\x89PNG\r\n\x1a\n"
        payload = {
            "command": "hello",
            "screenshot": base64.b64encode(tiny_png).decode(),
            "dom_snapshot": "not a dict",
        }
        response = client.post("/task", json=payload)
        assert response.status_code == 422

    def test_continue_request_action_history_must_be_list(self, client):
        """TaskContinueRequest.action_history must be a list."""
        payload = _make_continue_payload()
        payload["action_history"] = "not a list"
        response = client.post("/task/continue", json=payload)
        assert response.status_code == 422


# ── SSE event emission tests ─────────────────────────────────────────────────


class TestSSEEventEmission:
    """Test that SSE events are emitted during task processing."""

    def test_task_emits_understanding_event(self, client, sample_task_payload):
        """POST /task should emit a 'status' event with stage 'understanding'."""
        with patch(
            "backend.routers.task.reason_about_page",
            return_value={"type": "answer", "text": "ok"},
        ), patch("backend.routers.task.event_bus") as mock_bus:
            mock_bus.emit = AsyncMock()
            response = client.post("/task", json=sample_task_payload)

        assert response.status_code == 200
        # First emit call should be the "understanding" stage
        calls = mock_bus.emit.call_args_list
        assert len(calls) >= 1
        first_call = calls[0]
        assert first_call.args[0] == "status"
        assert first_call.args[1]["stage"] == "understanding"

    def test_task_emits_task_complete_event(self, client, sample_task_payload):
        """POST /task should emit 'task_complete' event on success."""
        with patch(
            "backend.routers.task.reason_about_page",
            return_value={"type": "answer", "text": "ok"},
        ), patch("backend.routers.task.event_bus") as mock_bus:
            mock_bus.emit = AsyncMock()
            response = client.post("/task", json=sample_task_payload)

        assert response.status_code == 200
        calls = mock_bus.emit.call_args_list
        assert len(calls) >= 2
        second_call = calls[1]
        assert second_call.args[0] == "status"
        assert second_call.args[1]["stage"] == "task_complete"
        assert second_call.args[1]["type"] == "answer"

    def test_task_emits_error_event_on_failure(self, client, sample_task_payload):
        """POST /task should emit 'error' event when processing fails."""
        with patch(
            "backend.routers.task.reason_about_page",
            side_effect=RuntimeError("Something broke"),
        ), patch("backend.routers.task.event_bus") as mock_bus:
            mock_bus.emit = AsyncMock()
            response = client.post("/task", json=sample_task_payload)

        assert response.status_code == 500
        calls = mock_bus.emit.call_args_list
        # Should have understanding + error events
        assert len(calls) >= 2
        error_call = calls[1]
        assert error_call.args[0] == "status"
        assert error_call.args[1]["stage"] == "error"

    def test_continue_emits_understanding_event(self, client):
        """POST /task/continue should emit a 'status' event with stage 'understanding'."""
        with patch(
            "backend.routers.task.reason_continue",
            return_value={"type": "done", "summary": "ok"},
        ), patch("backend.routers.task.event_bus") as mock_bus:
            mock_bus.emit = AsyncMock()
            response = client.post("/task/continue", json=_make_continue_payload())

        assert response.status_code == 200
        calls = mock_bus.emit.call_args_list
        assert len(calls) >= 1
        first_call = calls[0]
        assert first_call.args[0] == "status"
        assert first_call.args[1]["stage"] == "understanding"

    def test_continue_emits_task_complete_event(self, client):
        """POST /task/continue should emit 'task_complete' event on success."""
        with patch(
            "backend.routers.task.reason_continue",
            return_value={"type": "done", "summary": "ok"},
        ), patch("backend.routers.task.event_bus") as mock_bus:
            mock_bus.emit = AsyncMock()
            response = client.post("/task/continue", json=_make_continue_payload())

        assert response.status_code == 200
        calls = mock_bus.emit.call_args_list
        assert len(calls) >= 2
        second_call = calls[1]
        assert second_call.args[1]["stage"] == "task_complete"
        assert second_call.args[1]["type"] == "done"

    def test_continue_emits_error_event_on_failure(self, client):
        """POST /task/continue should emit 'error' event when processing fails."""
        with patch(
            "backend.routers.task.reason_continue",
            side_effect=RuntimeError("Something broke"),
        ), patch("backend.routers.task.event_bus") as mock_bus:
            mock_bus.emit = AsyncMock()
            response = client.post("/task/continue", json=_make_continue_payload())

        assert response.status_code == 500
        calls = mock_bus.emit.call_args_list
        assert len(calls) >= 2
        error_call = calls[1]
        assert error_call.args[1]["stage"] == "error"
