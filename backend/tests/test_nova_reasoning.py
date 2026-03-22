"""Comprehensive unit tests for the nova_reasoning service."""

import base64
import json
import os
from unittest.mock import MagicMock, patch

import pytest
from botocore.exceptions import ClientError, NoCredentialsError, PartialCredentialsError

from backend.services.nova_reasoning import (
    CONTINUE_SYSTEM_PROMPT,
    CONVERSATIONAL_ADDENDUM,
    SYSTEM_PROMPT,
    _extract_json,
    reason_about_page,
    reason_continue,
)


# ── Shared helpers ──────────────────────────────────────────────────────────


def _tiny_png_b64() -> str:
    """Return base64-encoded 1x1 transparent PNG."""
    tiny_png = (
        b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01"
        b"\x00\x00\x00\x01\x08\x06\x00\x00\x00\x1f\x15\xc4\x89"
        b"\x00\x00\x00\nIDATx\x9cc\x00\x01\x00\x00\x05\x00\x01"
        b"\r\n\xb4\x00\x00\x00\x00IEND\xaeB`\x82"
    )
    return base64.b64encode(tiny_png).decode()


_SAMPLE_DOM = {
    "url": "https://example.com",
    "title": "Example",
    "buttons": [{"selector": "#btn", "text": "Buy Now", "visible": True}],
    "links": [],
    "inputs": [],
    "text_content": "Sample page text",
}


def _mock_converse_response(text: str) -> dict:
    """Build a mock Bedrock converse API response."""
    return {
        "output": {
            "message": {
                "content": [{"text": text}]
            }
        }
    }


# ── SYSTEM_PROMPT tests ─────────────────────────────────────────────────────


class TestSystemPrompt:
    """Verify the SYSTEM_PROMPT constant is well-formed."""

    def test_system_prompt_is_defined(self):
        """SYSTEM_PROMPT should be a non-empty string."""
        assert isinstance(SYSTEM_PROMPT, str)
        assert len(SYSTEM_PROMPT) > 100

    def test_system_prompt_contains_key_instructions(self):
        """SYSTEM_PROMPT must mention action types and response format."""
        prompt_lower = SYSTEM_PROMPT.lower()
        assert "click" in prompt_lower
        assert "type" in prompt_lower
        assert "navigate" in prompt_lower
        assert "scroll" in prompt_lower
        assert "extract" in prompt_lower
        assert "json" in prompt_lower
        assert "selector" in prompt_lower

    def test_system_prompt_mentions_answer_and_steps(self):
        """SYSTEM_PROMPT must describe both response types."""
        assert '"type": "answer"' in SYSTEM_PROMPT
        assert '"type": "steps"' in SYSTEM_PROMPT

    def test_system_prompt_contains_reasoning_field(self):
        """SYSTEM_PROMPT must instruct the model to include a 'reasoning' field."""
        prompt_lower = SYSTEM_PROMPT.lower()
        assert "reasoning" in prompt_lower


class TestContinueSystemPrompt:
    """Verify the CONTINUE_SYSTEM_PROMPT constant is well-formed."""

    def test_continue_prompt_is_defined(self):
        """CONTINUE_SYSTEM_PROMPT should be a non-empty string."""
        assert isinstance(CONTINUE_SYSTEM_PROMPT, str)
        assert len(CONTINUE_SYSTEM_PROMPT) > 100

    def test_continue_prompt_mentions_done_and_steps_types(self):
        """CONTINUE_SYSTEM_PROMPT must describe done, steps, and answer types."""
        assert '"type": "done"' in CONTINUE_SYSTEM_PROMPT
        assert '"type": "steps"' in CONTINUE_SYSTEM_PROMPT
        assert '"type": "answer"' in CONTINUE_SYSTEM_PROMPT

    def test_continue_prompt_contains_reasoning_field(self):
        """CONTINUE_SYSTEM_PROMPT must instruct the model to include a 'reasoning' field."""
        prompt_lower = CONTINUE_SYSTEM_PROMPT.lower()
        assert "reasoning" in prompt_lower

    def test_continue_prompt_mentions_action_types(self):
        """CONTINUE_SYSTEM_PROMPT must mention supported action types."""
        prompt_lower = CONTINUE_SYSTEM_PROMPT.lower()
        assert "click" in prompt_lower
        assert "navigate" in prompt_lower
        assert "scroll" in prompt_lower


# ── Credential validation ────────────────────────────────────────────────────


class TestCredentialValidation:
    """Verify that missing or placeholder credentials raise ValueError."""

    def test_raises_when_aws_key_missing(self):
        """reason_about_page() raises ValueError when AWS_ACCESS_KEY_ID is missing."""
        with patch.dict(os.environ, {"AWS_ACCESS_KEY_ID": "", "AWS_SECRET_ACCESS_KEY": "secret"}):
            with pytest.raises(ValueError, match="(?i)credentials"):
                reason_about_page("hello", _tiny_png_b64(), _SAMPLE_DOM)

    def test_raises_when_aws_secret_missing(self):
        """reason_about_page() raises ValueError when AWS_SECRET_ACCESS_KEY is missing."""
        with patch.dict(os.environ, {"AWS_ACCESS_KEY_ID": "key", "AWS_SECRET_ACCESS_KEY": ""}):
            with pytest.raises(ValueError, match="(?i)credentials"):
                reason_about_page("hello", _tiny_png_b64(), _SAMPLE_DOM)

    def test_raises_when_placeholder_key(self):
        """reason_about_page() raises ValueError when key is 'your-key-here'."""
        with patch.dict(
            os.environ,
            {"AWS_ACCESS_KEY_ID": "your-key-here", "AWS_SECRET_ACCESS_KEY": "secret"},
        ):
            with pytest.raises(ValueError, match="(?i)credentials"):
                reason_about_page("hello", _tiny_png_b64(), _SAMPLE_DOM)

    def test_reason_continue_raises_when_aws_key_missing(self):
        """reason_continue() raises ValueError when AWS_ACCESS_KEY_ID is missing."""
        with patch.dict(os.environ, {"AWS_ACCESS_KEY_ID": "", "AWS_SECRET_ACCESS_KEY": "secret"}):
            with pytest.raises(ValueError, match="(?i)credentials"):
                reason_continue("hello", [], _tiny_png_b64(), _SAMPLE_DOM)

    def test_reason_continue_raises_when_aws_secret_missing(self):
        """reason_continue() raises ValueError when AWS_SECRET_ACCESS_KEY is missing."""
        with patch.dict(os.environ, {"AWS_ACCESS_KEY_ID": "key", "AWS_SECRET_ACCESS_KEY": ""}):
            with pytest.raises(ValueError, match="(?i)credentials"):
                reason_continue("hello", [], _tiny_png_b64(), _SAMPLE_DOM)

    def test_reason_continue_raises_when_placeholder_key(self):
        """reason_continue() raises ValueError when key is 'your-key-here'."""
        with patch.dict(
            os.environ,
            {"AWS_ACCESS_KEY_ID": "your-key-here", "AWS_SECRET_ACCESS_KEY": "secret"},
        ):
            with pytest.raises(ValueError, match="(?i)credentials"):
                reason_continue("hello", [], _tiny_png_b64(), _SAMPLE_DOM)


# ── reason_about_page tests ─────────────────────────────────────────────────


class TestReasonAboutPage:
    """Test reason_about_page() with mocked boto3."""

    @patch("backend.services.nova_reasoning.boto3")
    def test_answer_response_parsing(self, mock_boto3):
        """When Nova returns an answer JSON, it should parse correctly."""
        answer_json = json.dumps({"type": "answer", "text": "The price is $9.99"})
        mock_client = MagicMock()
        mock_client.converse.return_value = _mock_converse_response(answer_json)
        mock_boto3.client.return_value = mock_client

        result = reason_about_page("what is the price?", _tiny_png_b64(), _SAMPLE_DOM)

        assert result["type"] == "answer"
        assert result["text"] == "The price is $9.99"

    @patch("backend.services.nova_reasoning.boto3")
    def test_steps_response_parsing(self, mock_boto3):
        """When Nova returns a steps JSON, it should parse correctly."""
        steps_json = json.dumps({
            "type": "steps",
            "actions": [
                {"action": "click", "selector": "#btn", "description": "Click Buy Now"}
            ],
        })
        mock_client = MagicMock()
        mock_client.converse.return_value = _mock_converse_response(steps_json)
        mock_boto3.client.return_value = mock_client

        result = reason_about_page("click buy now", _tiny_png_b64(), _SAMPLE_DOM)

        assert result["type"] == "steps"
        assert isinstance(result["actions"], list)
        assert result["actions"][0]["action"] == "click"

    @patch("backend.services.nova_reasoning.boto3")
    def test_fallback_when_nova_returns_non_json(self, mock_boto3):
        """When Nova returns plain text, it should be wrapped as type=answer."""
        mock_client = MagicMock()
        mock_client.converse.return_value = _mock_converse_response(
            "I cannot determine the price from this page."
        )
        mock_boto3.client.return_value = mock_client

        result = reason_about_page("what is the price?", _tiny_png_b64(), _SAMPLE_DOM)

        assert result["type"] == "answer"
        assert "cannot determine" in result["text"].lower()

    @patch("backend.services.nova_reasoning.boto3")
    def test_fallback_when_json_missing_type_field(self, mock_boto3):
        """When Nova returns valid JSON without 'type', wrap as answer."""
        mock_client = MagicMock()
        mock_client.converse.return_value = _mock_converse_response(
            json.dumps({"message": "some response"})
        )
        mock_boto3.client.return_value = mock_client

        result = reason_about_page("hello", _tiny_png_b64(), _SAMPLE_DOM)

        assert result["type"] == "answer"
        # The text should be the raw JSON string
        assert "message" in result["text"]

    @patch("backend.services.nova_reasoning.boto3")
    def test_converse_call_uses_correct_model(self, mock_boto3):
        """Verify that the converse call targets the correct Nova model."""
        answer_json = json.dumps({"type": "answer", "text": "ok"})
        mock_client = MagicMock()
        mock_client.converse.return_value = _mock_converse_response(answer_json)
        mock_boto3.client.return_value = mock_client

        reason_about_page("test", _tiny_png_b64(), _SAMPLE_DOM)

        call_kwargs = mock_client.converse.call_args
        assert call_kwargs.kwargs["modelId"] == "us.amazon.nova-lite-v1:0"

    @patch("backend.services.nova_reasoning.boto3")
    def test_converse_call_uses_system_prompt(self, mock_boto3):
        """Verify that the converse call sends SYSTEM_PROMPT in the system parameter."""
        answer_json = json.dumps({"type": "answer", "text": "ok"})
        mock_client = MagicMock()
        mock_client.converse.return_value = _mock_converse_response(answer_json)
        mock_boto3.client.return_value = mock_client

        reason_about_page("test", _tiny_png_b64(), _SAMPLE_DOM)

        call_kwargs = mock_client.converse.call_args
        system_arg = call_kwargs.kwargs["system"]
        assert len(system_arg) == 1
        assert system_arg[0]["text"].startswith(SYSTEM_PROMPT)
        assert CONVERSATIONAL_ADDENDUM in system_arg[0]["text"]

    @patch("backend.services.nova_reasoning.boto3")
    def test_converse_call_sends_three_content_blocks(self, mock_boto3):
        """Verify that the user message has image, DOM snapshot, and command blocks."""
        answer_json = json.dumps({"type": "answer", "text": "ok"})
        mock_client = MagicMock()
        mock_client.converse.return_value = _mock_converse_response(answer_json)
        mock_boto3.client.return_value = mock_client

        reason_about_page("what is this?", _tiny_png_b64(), _SAMPLE_DOM)

        call_kwargs = mock_client.converse.call_args
        messages = call_kwargs.kwargs["messages"]
        assert len(messages) == 1
        content = messages[0]["content"]
        assert len(content) == 3
        # First block is the image
        assert "image" in content[0]
        # Second block is the DOM snapshot text
        assert "DOM Snapshot" in content[1]["text"]
        # Third block is the user command
        assert "what is this?" in content[2]["text"]

    @patch("backend.services.nova_reasoning.boto3")
    def test_invalid_screenshot_base64_raises(self, mock_boto3):
        """Invalid base64 for the screenshot should raise ValueError."""
        mock_boto3.client.return_value = MagicMock()

        with pytest.raises(ValueError, match="(?i)screenshot"):
            reason_about_page("hello", "not-valid-base64!!!", _SAMPLE_DOM)

    @patch("backend.services.nova_reasoning.boto3")
    def test_response_with_reasoning_field_preserved(self, mock_boto3):
        """When Nova includes a 'reasoning' field, it should be preserved in the output."""
        response_json = json.dumps({
            "type": "answer",
            "reasoning": "I can see the price in the header area",
            "text": "$19.99",
        })
        mock_client = MagicMock()
        mock_client.converse.return_value = _mock_converse_response(response_json)
        mock_boto3.client.return_value = mock_client

        result = reason_about_page("price?", _tiny_png_b64(), _SAMPLE_DOM)

        assert result["type"] == "answer"
        assert result["reasoning"] == "I can see the price in the header area"
        assert result["text"] == "$19.99"

    @patch("backend.services.nova_reasoning.boto3")
    def test_max_tokens_set_in_inference_config(self, mock_boto3):
        """Verify maxTokens is set in the inferenceConfig."""
        answer_json = json.dumps({"type": "answer", "text": "ok"})
        mock_client = MagicMock()
        mock_client.converse.return_value = _mock_converse_response(answer_json)
        mock_boto3.client.return_value = mock_client

        reason_about_page("test", _tiny_png_b64(), _SAMPLE_DOM)

        call_kwargs = mock_client.converse.call_args
        assert call_kwargs.kwargs["inferenceConfig"]["maxTokens"] == 2048


# ── ClientError handling ─────────────────────────────────────────────────────


class TestReasonAboutPageClientErrors:
    """Test ClientError and credential error handling in reason_about_page."""

    @patch("backend.services.nova_reasoning.boto3")
    def test_no_credentials_error_raises_value_error(self, mock_boto3):
        """NoCredentialsError should be raised as ValueError with helpful message."""
        mock_client = MagicMock()
        mock_client.converse.side_effect = NoCredentialsError()
        mock_boto3.client.return_value = mock_client

        with pytest.raises(ValueError, match="(?i)invalid or incomplete"):
            reason_about_page("test", _tiny_png_b64(), _SAMPLE_DOM)

    @patch("backend.services.nova_reasoning.boto3")
    def test_partial_credentials_error_raises_value_error(self, mock_boto3):
        """PartialCredentialsError should be raised as ValueError with helpful message."""
        mock_client = MagicMock()
        mock_client.converse.side_effect = PartialCredentialsError(provider="env", cred_var="AWS_SECRET_ACCESS_KEY")
        mock_boto3.client.return_value = mock_client

        with pytest.raises(ValueError, match="(?i)invalid or incomplete"):
            reason_about_page("test", _tiny_png_b64(), _SAMPLE_DOM)

    @patch("backend.services.nova_reasoning.boto3")
    def test_access_denied_client_error(self, mock_boto3):
        """AccessDeniedException ClientError should raise ValueError about permissions."""
        mock_client = MagicMock()
        error_response = {
            "Error": {
                "Code": "AccessDeniedException",
                "Message": "Access denied for Bedrock",
            }
        }
        mock_client.converse.side_effect = ClientError(error_response, "Converse")
        mock_boto3.client.return_value = mock_client

        with pytest.raises(ValueError, match="(?i)access denied"):
            reason_about_page("test", _tiny_png_b64(), _SAMPLE_DOM)

    @patch("backend.services.nova_reasoning.boto3")
    def test_validation_exception_client_error(self, mock_boto3):
        """ValidationException ClientError should raise ValueError about request format."""
        mock_client = MagicMock()
        error_response = {
            "Error": {
                "Code": "ValidationException",
                "Message": "Invalid image format",
            }
        }
        mock_client.converse.side_effect = ClientError(error_response, "Converse")
        mock_boto3.client.return_value = mock_client

        with pytest.raises(ValueError, match="(?i)validation"):
            reason_about_page("test", _tiny_png_b64(), _SAMPLE_DOM)

    @patch("backend.services.nova_reasoning.boto3")
    def test_generic_client_error(self, mock_boto3):
        """A generic ClientError should raise ValueError with the error code."""
        mock_client = MagicMock()
        error_response = {
            "Error": {
                "Code": "ThrottlingException",
                "Message": "Rate limit exceeded",
            }
        }
        mock_client.converse.side_effect = ClientError(error_response, "Converse")
        mock_boto3.client.return_value = mock_client

        with pytest.raises(ValueError, match="ThrottlingException"):
            reason_about_page("test", _tiny_png_b64(), _SAMPLE_DOM)

    @patch("backend.services.nova_reasoning.boto3")
    def test_unexpected_exception_raises_value_error(self, mock_boto3):
        """Any unexpected exception should be wrapped as ValueError."""
        mock_client = MagicMock()
        mock_client.converse.side_effect = RuntimeError("Something unexpected")
        mock_boto3.client.return_value = mock_client

        with pytest.raises(ValueError, match="(?i)reasoning failed"):
            reason_about_page("test", _tiny_png_b64(), _SAMPLE_DOM)

    def test_boto3_client_creation_failure(self):
        """If boto3.client() itself fails, it should raise ValueError."""
        with patch("backend.services.nova_reasoning.boto3") as mock_boto3:
            mock_boto3.client.side_effect = Exception("Connection refused")

            with pytest.raises(ValueError, match="(?i)failed to create"):
                reason_about_page("test", _tiny_png_b64(), _SAMPLE_DOM)


# ── reason_continue tests ───────────────────────────────────────────────────


class TestReasonContinue:
    """Test reason_continue() with mocked boto3."""

    @patch("backend.services.nova_reasoning.boto3")
    def test_done_response_parsing(self, mock_boto3):
        """When Nova returns done JSON, it should parse correctly."""
        done_json = json.dumps({
            "type": "done",
            "reasoning": "Task is complete",
            "summary": "Successfully clicked the button",
        })
        mock_client = MagicMock()
        mock_client.converse.return_value = _mock_converse_response(done_json)
        mock_boto3.client.return_value = mock_client

        result = reason_continue(
            "click buy",
            [{"description": "Clicked Buy Now", "result": "Success"}],
            _tiny_png_b64(),
            _SAMPLE_DOM,
        )

        assert result["type"] == "done"
        assert result["summary"] == "Successfully clicked the button"

    @patch("backend.services.nova_reasoning.boto3")
    def test_steps_response_parsing(self, mock_boto3):
        """When Nova returns more steps, it should parse correctly."""
        steps_json = json.dumps({
            "type": "steps",
            "reasoning": "Need to fill in the form",
            "actions": [
                {"action": "type", "selector": "#email", "value": "test@test.com", "description": "Type email"}
            ],
        })
        mock_client = MagicMock()
        mock_client.converse.return_value = _mock_converse_response(steps_json)
        mock_boto3.client.return_value = mock_client

        result = reason_continue(
            "fill in the form",
            [{"description": "Clicked the form", "result": "Success"}],
            _tiny_png_b64(),
            _SAMPLE_DOM,
        )

        assert result["type"] == "steps"
        assert isinstance(result["actions"], list)

    @patch("backend.services.nova_reasoning.boto3")
    def test_answer_response_parsing(self, mock_boto3):
        """When Nova returns an answer in continue mode, it should parse correctly."""
        answer_json = json.dumps({
            "type": "answer",
            "reasoning": "Detected search results",
            "text": "I found 3 matching results",
        })
        mock_client = MagicMock()
        mock_client.converse.return_value = _mock_converse_response(answer_json)
        mock_boto3.client.return_value = mock_client

        result = reason_continue(
            "search for something",
            [{"description": "Typed query", "result": "Success"}],
            _tiny_png_b64(),
            _SAMPLE_DOM,
        )

        assert result["type"] == "answer"
        assert "3 matching results" in result["text"]

    @patch("backend.services.nova_reasoning.boto3")
    def test_fallback_plain_text_wrapped_as_done(self, mock_boto3):
        """When Nova returns plain text in continue mode, it wraps as done."""
        mock_client = MagicMock()
        mock_client.converse.return_value = _mock_converse_response(
            "The task seems to be complete."
        )
        mock_boto3.client.return_value = mock_client

        result = reason_continue(
            "click buy",
            [{"description": "Clicked Buy", "result": "Success"}],
            _tiny_png_b64(),
            _SAMPLE_DOM,
        )

        assert result["type"] == "done"
        assert "task seems to be complete" in result["summary"].lower()

    @patch("backend.services.nova_reasoning.boto3")
    def test_fallback_json_missing_type_field_wrapped_as_done(self, mock_boto3):
        """When Nova returns JSON without 'type' in continue mode, it wraps as done."""
        mock_client = MagicMock()
        mock_client.converse.return_value = _mock_converse_response(
            json.dumps({"status": "completed"})
        )
        mock_boto3.client.return_value = mock_client

        result = reason_continue(
            "click buy",
            [{"description": "Clicked Buy", "result": "Success"}],
            _tiny_png_b64(),
            _SAMPLE_DOM,
        )

        assert result["type"] == "done"

    @patch("backend.services.nova_reasoning.boto3")
    def test_uses_continue_system_prompt(self, mock_boto3):
        """Verify that reason_continue uses CONTINUE_SYSTEM_PROMPT."""
        done_json = json.dumps({"type": "done", "summary": "ok"})
        mock_client = MagicMock()
        mock_client.converse.return_value = _mock_converse_response(done_json)
        mock_boto3.client.return_value = mock_client

        reason_continue("test", [], _tiny_png_b64(), _SAMPLE_DOM)

        call_kwargs = mock_client.converse.call_args
        system_arg = call_kwargs.kwargs["system"]
        assert system_arg[0]["text"].startswith(CONTINUE_SYSTEM_PROMPT)
        assert CONVERSATIONAL_ADDENDUM in system_arg[0]["text"]

    @patch("backend.services.nova_reasoning.boto3")
    def test_empty_action_history_formats_correctly(self, mock_boto3):
        """When action_history is empty, it should say 'no actions taken yet'."""
        done_json = json.dumps({"type": "done", "summary": "ok"})
        mock_client = MagicMock()
        mock_client.converse.return_value = _mock_converse_response(done_json)
        mock_boto3.client.return_value = mock_client

        reason_continue("test", [], _tiny_png_b64(), _SAMPLE_DOM)

        call_kwargs = mock_client.converse.call_args
        messages = call_kwargs.kwargs["messages"]
        # Check that the text block includes the "no actions" message
        text_content = messages[0]["content"][2]["text"]
        assert "no actions taken yet" in text_content

    @patch("backend.services.nova_reasoning.boto3")
    def test_invalid_screenshot_base64_raises(self, mock_boto3):
        """Invalid base64 for the screenshot should raise ValueError."""
        mock_boto3.client.return_value = MagicMock()

        with pytest.raises(ValueError, match="(?i)screenshot"):
            reason_continue("test", [], "not-valid-base64!!!", _SAMPLE_DOM)


# ── Action history compression tests ────────────────────────────────────────


class TestActionHistoryCompression:
    """Test that action history is compressed when there are more than 5 entries."""

    @patch("backend.services.nova_reasoning.boto3")
    def test_short_history_not_compressed(self, mock_boto3):
        """With 5 or fewer actions, all should appear in detail."""
        done_json = json.dumps({"type": "done", "summary": "ok"})
        mock_client = MagicMock()
        mock_client.converse.return_value = _mock_converse_response(done_json)
        mock_boto3.client.return_value = mock_client

        history = [
            {"description": f"Action {i}", "result": f"Result {i}"}
            for i in range(5)
        ]

        reason_continue("test", history, _tiny_png_b64(), _SAMPLE_DOM)

        call_kwargs = mock_client.converse.call_args
        text_content = messages_text = call_kwargs.kwargs["messages"][0]["content"][2]["text"]
        # All 5 actions should appear with their numbering
        assert "1. Action 0" in text_content
        assert "5. Action 4" in text_content
        # Should NOT contain compression summary
        assert "Previously completed" not in text_content

    @patch("backend.services.nova_reasoning.boto3")
    def test_long_history_compresses_older_entries(self, mock_boto3):
        """With more than 5 actions, older actions should be compressed."""
        done_json = json.dumps({"type": "done", "summary": "ok"})
        mock_client = MagicMock()
        mock_client.converse.return_value = _mock_converse_response(done_json)
        mock_boto3.client.return_value = mock_client

        history = [
            {"description": f"Action {i}", "result": f"Result {i}"}
            for i in range(8)
        ]

        reason_continue("test", history, _tiny_png_b64(), _SAMPLE_DOM)

        call_kwargs = mock_client.converse.call_args
        text_content = call_kwargs.kwargs["messages"][0]["content"][2]["text"]
        # Should contain summary of older actions (first 5)
        assert "Previously completed 5 actions" in text_content
        # Last 3 actions should be in detail
        assert "Action 5" in text_content
        assert "Action 6" in text_content
        assert "Action 7" in text_content

    @patch("backend.services.nova_reasoning.boto3")
    def test_compression_truncates_long_descriptions(self, mock_boto3):
        """Compressed older actions should truncate descriptions to 40 chars."""
        done_json = json.dumps({"type": "done", "summary": "ok"})
        mock_client = MagicMock()
        mock_client.converse.return_value = _mock_converse_response(done_json)
        mock_boto3.client.return_value = mock_client

        long_desc = "A" * 100  # 100-character description
        history = [
            {"description": long_desc, "result": "ok"}
            for _ in range(7)
        ]

        reason_continue("test", history, _tiny_png_b64(), _SAMPLE_DOM)

        call_kwargs = mock_client.converse.call_args
        text_content = call_kwargs.kwargs["messages"][0]["content"][2]["text"]
        # The compressed summary should have truncated the description to 40 chars
        assert "Previously completed 4 actions" in text_content
        # Full 100 char description should NOT appear in the summary line
        assert long_desc not in text_content.split("\n\n")[0]

    @patch("backend.services.nova_reasoning.boto3")
    def test_compression_handles_missing_description_key(self, mock_boto3):
        """Entries missing 'description' should use 'Unknown' in compressed form."""
        done_json = json.dumps({"type": "done", "summary": "ok"})
        mock_client = MagicMock()
        mock_client.converse.return_value = _mock_converse_response(done_json)
        mock_boto3.client.return_value = mock_client

        history = [
            {"result": "ok"} for _ in range(7)
        ]

        reason_continue("test", history, _tiny_png_b64(), _SAMPLE_DOM)

        call_kwargs = mock_client.converse.call_args
        text_content = call_kwargs.kwargs["messages"][0]["content"][2]["text"]
        assert "Unknown" in text_content


# ── reason_continue ClientError handling ─────────────────────────────────────


class TestReasonContinueClientErrors:
    """Test ClientError and credential error handling in reason_continue."""

    @patch("backend.services.nova_reasoning.boto3")
    def test_no_credentials_error_raises_value_error(self, mock_boto3):
        """NoCredentialsError should be raised as ValueError."""
        mock_client = MagicMock()
        mock_client.converse.side_effect = NoCredentialsError()
        mock_boto3.client.return_value = mock_client

        with pytest.raises(ValueError, match="(?i)invalid or incomplete"):
            reason_continue("test", [], _tiny_png_b64(), _SAMPLE_DOM)

    @patch("backend.services.nova_reasoning.boto3")
    def test_partial_credentials_error_raises_value_error(self, mock_boto3):
        """PartialCredentialsError should be raised as ValueError."""
        mock_client = MagicMock()
        mock_client.converse.side_effect = PartialCredentialsError(
            provider="env", cred_var="AWS_SECRET_ACCESS_KEY"
        )
        mock_boto3.client.return_value = mock_client

        with pytest.raises(ValueError, match="(?i)invalid or incomplete"):
            reason_continue("test", [], _tiny_png_b64(), _SAMPLE_DOM)

    @patch("backend.services.nova_reasoning.boto3")
    def test_access_denied_client_error(self, mock_boto3):
        """AccessDeniedException should raise ValueError about permissions."""
        mock_client = MagicMock()
        error_response = {
            "Error": {
                "Code": "AccessDeniedException",
                "Message": "Access denied",
            }
        }
        mock_client.converse.side_effect = ClientError(error_response, "Converse")
        mock_boto3.client.return_value = mock_client

        with pytest.raises(ValueError, match="(?i)access denied"):
            reason_continue("test", [], _tiny_png_b64(), _SAMPLE_DOM)

    @patch("backend.services.nova_reasoning.boto3")
    def test_validation_exception_client_error(self, mock_boto3):
        """ValidationException should raise ValueError about request format."""
        mock_client = MagicMock()
        error_response = {
            "Error": {
                "Code": "ValidationException",
                "Message": "Invalid format",
            }
        }
        mock_client.converse.side_effect = ClientError(error_response, "Converse")
        mock_boto3.client.return_value = mock_client

        with pytest.raises(ValueError, match="(?i)validation"):
            reason_continue("test", [], _tiny_png_b64(), _SAMPLE_DOM)

    @patch("backend.services.nova_reasoning.boto3")
    def test_generic_client_error(self, mock_boto3):
        """A generic ClientError should raise ValueError with the error code."""
        mock_client = MagicMock()
        error_response = {
            "Error": {
                "Code": "ServiceUnavailableException",
                "Message": "Service unavailable",
            }
        }
        mock_client.converse.side_effect = ClientError(error_response, "Converse")
        mock_boto3.client.return_value = mock_client

        with pytest.raises(ValueError, match="ServiceUnavailableException"):
            reason_continue("test", [], _tiny_png_b64(), _SAMPLE_DOM)

    @patch("backend.services.nova_reasoning.boto3")
    def test_unexpected_exception_raises_value_error(self, mock_boto3):
        """Unexpected exceptions should be wrapped as ValueError."""
        mock_client = MagicMock()
        mock_client.converse.side_effect = RuntimeError("Something unexpected")
        mock_boto3.client.return_value = mock_client

        with pytest.raises(ValueError, match="(?i)continue reasoning failed"):
            reason_continue("test", [], _tiny_png_b64(), _SAMPLE_DOM)

    def test_boto3_client_creation_failure(self):
        """If boto3.client() itself fails for continue, it should raise ValueError."""
        with patch("backend.services.nova_reasoning.boto3") as mock_boto3:
            mock_boto3.client.side_effect = Exception("Connection refused")

            with pytest.raises(ValueError, match="(?i)failed to create"):
                reason_continue("test", [], _tiny_png_b64(), _SAMPLE_DOM)


# ── _extract_json tests ──────────────────────────────────────────────────────


class TestExtractJson:
    """Test the _extract_json helper function for various input formats."""

    def test_direct_json_object(self):
        """Direct JSON object parses correctly."""
        text = '{"type": "answer", "text": "Hello"}'
        result = _extract_json(text)
        assert result is not None
        assert result["type"] == "answer"
        assert result["text"] == "Hello"

    def test_direct_json_with_whitespace(self):
        """JSON with leading/trailing whitespace parses correctly."""
        text = '  \n  {"type": "done", "summary": "Complete"}  \n  '
        result = _extract_json(text)
        assert result is not None
        assert result["type"] == "done"

    def test_markdown_code_block_json(self):
        """JSON wrapped in markdown ```json ... ``` code block."""
        text = 'Here is the response:\n```json\n{"type": "steps", "actions": [{"action": "click"}]}\n```'
        result = _extract_json(text)
        assert result is not None
        assert result["type"] == "steps"
        assert isinstance(result["actions"], list)

    def test_markdown_code_block_no_language(self):
        """JSON wrapped in markdown ``` ... ``` code block (no language hint)."""
        text = '```\n{"type": "answer", "text": "Result"}\n```'
        result = _extract_json(text)
        assert result is not None
        assert result["type"] == "answer"

    def test_json_embedded_in_text(self):
        """JSON object embedded in surrounding text."""
        text = 'I think the answer is: {"type": "answer", "text": "The price is $10"} as you can see.'
        result = _extract_json(text)
        assert result is not None
        assert result["type"] == "answer"
        assert "$10" in result["text"]

    def test_json_array(self):
        """JSON array (not object) is extracted."""
        text = '[{"action": "click", "selector": "#btn"}, {"action": "type", "value": "test"}]'
        result = _extract_json(text)
        assert result is not None
        assert isinstance(result, list)
        assert len(result) == 2
        assert result[0]["action"] == "click"

    def test_json_array_in_text(self):
        """JSON array embedded in text — Strategy 3 (find {) triggers before Strategy 4 (find [)."""
        # When a JSON array contains objects, _extract_json finds the first { first,
        # so it returns the inner object, not the array.
        # For a pure array without preceding {, Strategy 4 works.
        text = 'The steps are: ["step1", "step2", "step3"] end.'
        result = _extract_json(text)
        assert result is not None
        assert isinstance(result, list)
        assert len(result) == 3
        assert result[0] == "step1"

    def test_no_json_returns_none(self):
        """Plain text without JSON returns None."""
        text = "I cannot determine the price from this page."
        result = _extract_json(text)
        assert result is None

    def test_empty_string_returns_none(self):
        """Empty string returns None."""
        result = _extract_json("")
        assert result is None

    def test_invalid_json_returns_none(self):
        """Malformed JSON returns None."""
        text = "{ invalid json !!!"
        result = _extract_json(text)
        assert result is None

    def test_nested_json_object(self):
        """Deeply nested JSON is extracted correctly."""
        obj = {
            "type": "steps",
            "reasoning": "Need to fill form",
            "actions": [
                {"action": "type", "selector": "#email", "value": "a@b.com", "description": "Type email"}
            ],
        }
        text = json.dumps(obj)
        result = _extract_json(text)
        assert result is not None
        assert result["type"] == "steps"
        assert result["actions"][0]["value"] == "a@b.com"


# ── System prompt content tests ──────────────────────────────────────────────


class TestSystemPromptSpeakField:
    """Verify that SYSTEM_PROMPT requires the 'speak' field in action definitions."""

    def test_system_prompt_contains_speak_field_requirement(self):
        """SYSTEM_PROMPT must mention the 'speak' field for actions."""
        assert '"speak"' in SYSTEM_PROMPT or "'speak'" in SYSTEM_PROMPT
        assert "speak" in SYSTEM_PROMPT.lower()

    def test_system_prompt_has_speak_examples(self):
        """SYSTEM_PROMPT should contain example speak phrases."""
        # Check for at least one example speak phrase
        assert "Opening" in SYSTEM_PROMPT or "Clicking" in SYSTEM_PROMPT or "Searching" in SYSTEM_PROMPT


class TestContinuePromptSelectorRules:
    """Verify that CONTINUE_SYSTEM_PROMPT contains selector rules."""

    def test_continue_prompt_contains_selector_rules(self):
        """CONTINUE_SYSTEM_PROMPT must contain important selector rules."""
        prompt = CONTINUE_SYSTEM_PROMPT
        # Rule about auto-generated IDs
        assert "autoid" in prompt.lower() or "auto-generated" in prompt.lower() or "a-autoid" in prompt

    def test_continue_prompt_mentions_href_selectors(self):
        """CONTINUE_SYSTEM_PROMPT should mention href-based selectors."""
        assert "href" in CONTINUE_SYSTEM_PROMPT

    def test_continue_prompt_mentions_add_to_cart(self):
        """CONTINUE_SYSTEM_PROMPT should mention add-to-cart selector guidance."""
        prompt_lower = CONTINUE_SYSTEM_PROMPT.lower()
        assert "add to cart" in prompt_lower or "add-to-cart" in prompt_lower

    def test_continue_prompt_mentions_speak_field(self):
        """CONTINUE_SYSTEM_PROMPT must mention the 'speak' field for actions."""
        assert '"speak"' in CONTINUE_SYSTEM_PROMPT or "'speak'" in CONTINUE_SYSTEM_PROMPT

    def test_continue_prompt_single_action_rule(self):
        """CONTINUE_SYSTEM_PROMPT should instruct returning exactly one action at a time."""
        prompt_lower = CONTINUE_SYSTEM_PROMPT.lower()
        assert "one action" in prompt_lower or "exactly one" in prompt_lower
