import base64
import io
import json
import os
import re
import threading
import time

import boto3
from botocore.config import Config as BotoConfig
from botocore.exceptions import ClientError, NoCredentialsError, PartialCredentialsError
from PIL import Image

# Max chars for DOM snapshot JSON to stay under token limits
DOM_SNAPSHOT_MAX_CHARS = 30000

# ── Supported models ────────────────────────────────────────────────────────

SUPPORTED_MODELS = {
    "nova-lite": {
        "model_id": "us.amazon.nova-lite-v1:0",
        "max_tokens": 2048,
        "description": "Amazon Nova Lite — fastest, cheapest, good for simple tasks",
    },
    "nova-pro": {
        "model_id": "us.amazon.nova-pro-v1:0",
        "max_tokens": 4096,
        "description": "Amazon Nova Pro — better reasoning, still fast",
    },
    "claude-haiku": {
        "model_id": "us.anthropic.claude-haiku-4-5-20251001-v1:0",
        "max_tokens": 4096,
        "description": "Claude Haiku 4.5 — best quality for browser agents, excellent vision",
    },
    "claude-sonnet": {
        "model_id": "us.anthropic.claude-sonnet-4-20250514-v1:0",
        "max_tokens": 4096,
        "description": "Claude Sonnet 4 — highest quality reasoning, slower",
    },
}

DEFAULT_MODEL = "nova-lite"


def get_active_model() -> dict:
    """Get the active model configuration from environment or default."""
    model_key = os.getenv("SCREENSENSE_MODEL", DEFAULT_MODEL).lower().strip()
    if model_key not in SUPPORTED_MODELS:
        print(f"[nova_reasoning] Unknown model '{model_key}', falling back to {DEFAULT_MODEL}")
        model_key = DEFAULT_MODEL
    return SUPPORTED_MODELS[model_key]


def get_model_id() -> str:
    """Get the active Bedrock model ID."""
    return get_active_model()["model_id"]


# ── JSON extraction ─────────────────────────────────────────────────────────


def _extract_json(text: str) -> dict | list | None:
    """Extract JSON from LLM response, handling markdown code blocks and extra text."""
    # Strategy 1: Direct parse
    try:
        parsed = json.loads(text.strip())
        return parsed
    except json.JSONDecodeError:
        pass

    # Strategy 2: Extract from markdown code block
    code_block = re.search(r'```(?:json)?\s*\n?(.*?)\n?\s*```', text, re.DOTALL)
    if code_block:
        try:
            parsed = json.loads(code_block.group(1).strip())
            return parsed
        except json.JSONDecodeError:
            pass

    # Strategy 3: Find the first complete JSON object { ... }
    brace_start = text.find('{')
    if brace_start != -1:
        depth = 0
        for i in range(brace_start, len(text)):
            if text[i] == '{':
                depth += 1
            elif text[i] == '}':
                depth -= 1
                if depth == 0:
                    try:
                        parsed = json.loads(text[brace_start:i + 1])
                        return parsed
                    except json.JSONDecodeError:
                        break

    # Strategy 4: Find JSON array [ ... ]
    bracket_start = text.find('[')
    if bracket_start != -1:
        depth = 0
        for i in range(bracket_start, len(text)):
            if text[i] == '[':
                depth += 1
            elif text[i] == ']':
                depth -= 1
                if depth == 0:
                    try:
                        parsed = json.loads(text[bracket_start:i + 1])
                        return parsed
                    except json.JSONDecodeError:
                        break

    return None


# ── Screenshot compression ──────────────────────────────────────────────────


def _compress_screenshot(screenshot_base64: str, max_width: int = 1024) -> str:
    """Downscale and compress screenshot to JPEG to reduce payload size."""
    try:
        img_bytes = base64.b64decode(screenshot_base64)
        img = Image.open(io.BytesIO(img_bytes))
        # Downscale if wider than max_width
        if img.width > max_width:
            ratio = max_width / img.width
            new_size = (max_width, int(img.height * ratio))
            img = img.resize(new_size, Image.LANCZOS)
        # Convert to JPEG with quality 80 for better vision model accuracy
        img = img.convert("RGB")
        buf = io.BytesIO()
        img.save(buf, format="JPEG", quality=80)
        return base64.b64encode(buf.getvalue()).decode()
    except Exception:
        # If compression fails, return original
        return screenshot_base64


# ── DOM truncation ──────────────────────────────────────────────────────────


def _truncate_dom(dom_snapshot: dict, has_firecrawl: bool = False) -> dict:
    """Truncate DOM snapshot to stay under token limits.

    When Firecrawl markdown is present, drops text_content entirely
    since Firecrawl provides richer page text.
    """
    trimmed = dict(dom_snapshot)

    # Drop text_content when Firecrawl provides richer page text
    if has_firecrawl and "text_content" in trimmed:
        trimmed["text_content"] = "(see Firecrawl markdown below)"

    # Drop images array — the model can see them in the screenshot
    if "images" in trimmed:
        trimmed["images"] = trimmed["images"][:5]

    dom_json = json.dumps(trimmed)
    if len(dom_json) <= DOM_SNAPSHOT_MAX_CHARS:
        return trimmed

    # Progressively trim: text_content first, then lists/tables, then trim arrays
    if "text_content" in trimmed:
        trimmed["text_content"] = trimmed["text_content"][:2000]

    for field in ["tables", "lists", "headings"]:
        if field in trimmed and len(json.dumps(trimmed)) > DOM_SNAPSHOT_MAX_CHARS:
            trimmed[field] = trimmed[field][:3] if isinstance(trimmed[field], list) else trimmed[field]

    for field in ["buttons", "links", "inputs", "products"]:
        if field in trimmed and isinstance(trimmed[field], list) and len(trimmed[field]) > 15:
            trimmed[field] = trimmed[field][:15]

    return trimmed


# ── Bedrock client (singleton) ──────────────────────────────────────────────

_bedrock_client = None
_bedrock_lock = threading.Lock()


def _get_bedrock_client():
    """Get or create a singleton Bedrock Runtime client."""
    global _bedrock_client
    if _bedrock_client is not None:
        return _bedrock_client

    with _bedrock_lock:
        if _bedrock_client is not None:
            return _bedrock_client

        key = os.getenv("AWS_ACCESS_KEY_ID", "")
        secret = os.getenv("AWS_SECRET_ACCESS_KEY", "")
        placeholders = {"your-key-here", "your-aws-access-key", "your-aws-secret-key", ""}

        if not key or key in placeholders or not secret or secret in placeholders:
            raise ValueError(
                "AWS credentials not configured — set AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY in backend/.env"
            )

        try:
            bedrock_config = BotoConfig(
                max_pool_connections=10,
                retries={"max_attempts": 3, "mode": "adaptive"},
                connect_timeout=5,
                read_timeout=30,
            )
            _bedrock_client = boto3.client(
                "bedrock-runtime",
                region_name=os.getenv("AWS_REGION", "us-east-1"),
                aws_access_key_id=key,
                aws_secret_access_key=secret,
                config=bedrock_config,
            )
            return _bedrock_client
        except (NoCredentialsError, PartialCredentialsError) as e:
            raise ValueError(
                "AWS credentials not configured — set AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY in backend/.env"
            ) from e
        except Exception as e:
            raise ValueError(f"Failed to create Bedrock client: {e}") from e


def _reset_bedrock_client():
    """Reset the singleton client (used in tests)."""
    global _bedrock_client
    with _bedrock_lock:
        _bedrock_client = None


# ── System prompts ──────────────────────────────────────────────────────────

CONTINUE_SYSTEM_PROMPT = """You are ScreenSense, a screen-aware AI execution agent in a Chrome extension.
You are CONTINUING a multi-step task that is already in progress.

CRITICAL: You MUST respond with a JSON action (type "steps" or "done"). NEVER respond with type "answer" to describe what you plan to do — instead, actually DO IT by returning the action. Do NOT explain your plan in text — execute it as a step.

You receive FOUR or FIVE inputs:
1. A screenshot of the user's current browser tab (AFTER the last action was taken)
2. A DOM snapshot — a JSON object with REAL CSS selectors for every interactive element on the page
3. The user's original command
4. A numbered list of actions already completed
5. (Optional) Full page content from Firecrawl — clean markdown of the ENTIRE page

UNDERSTAND THE FULL PAGE:
- Use the Firecrawl markdown to understand the COMPLETE page content, including below the fold.
- The DOM snapshot includes ALL interactive elements — those with "inViewport": false need scrolling to reach.
- For form filling: analyze all input fields, understand what data each needs, and fill them systematically.
- If you need to reach an element below the fold, use a scroll action first.

CRITICAL RULES:
- You MUST use the EXACT CSS selectors from the DOM snapshot. NEVER guess or make up selectors.
- The DOM snapshot contains: buttons[], links[], inputs[], forms[], text_content, url, title
- Each element has a "selector" field — USE IT EXACTLY as provided.
- Look at the NEW screenshot and DOM snapshot to determine what happened after the last action.
- If the task appears complete, signal done. Do NOT continue unnecessarily.

RESPONSE FORMAT — respond with ONE JSON object only, no markdown, no explanation:

IMPORTANT: Always include a "reasoning" field explaining your assessment of the current page state and your decision.

For TASK COMPLETE (the task appears to be done):
{"type": "done", "reasoning": "The search results are now showing USB-C cables. The task is complete.", "summary": "Brief description of what was accomplished"}

For MORE ACTIONS NEEDED (the task requires more steps):
{"type": "steps", "reasoning": "Search results are loaded. I can see the cheapest option. I'll click on it.", "actions": [...]}

For COMMUNICATING SOMETHING (you need to tell the user something about what happened):
{"type": "answer", "reasoning": "I can see the relevant information in the page content.", "text": "your message"}

SUPPORTED ACTIONS (use exact selectors from DOM snapshot):
Every action MUST include a "speak" field — a 3-5 word phrase spoken aloud to the user (e.g., "Opening Amazon", "Searching protein bars", "Adding to cart").

- click: {"action": "click", "selector": "<from DOM>", "description": "Click the X button", "speak": "Clicking X"}
- type: {"action": "type", "selector": "<from DOM>", "value": "text", "description": "Type X into Y", "speak": "Searching for X"}
- navigate: {"action": "navigate", "url": "https://...", "description": "Navigate to X", "speak": "Opening X"}
- scroll: {"action": "scroll", "direction": "up|down|top|bottom", "description": "Scroll", "speak": "Scrolling down"}
- extract: {"action": "extract", "selector": "<from DOM>", "description": "Get text from X", "speak": "Reading text"}

DECISION GUIDELINES:
- Return EXACTLY ONE action at a time. You'll get fresh DOM and screenshot after each action.
- Think about the user's FULL goal. Only signal "done" when ALL items/tasks in the request are complete.
- NEVER signal "done" if there are still unfinished items. If the user asked for 3 products, you must add ALL 3 before signaling "done".
- If search results are showing but the user wanted to click/select/add something → respond with "steps"
- If an action FAILED (you'll see "FAILED:" in the history), try a DIFFERENT selector or approach.
- Do NOT get stuck in loops — if the EXACT same action has been tried 3+ times, skip that item and move to the next one.
- NEVER treat remaining items as "separate tasks." Complete EVERYTHING the user asked for in one session.

IMPORTANT SELECTOR RULES:
- NEVER use auto-generated IDs like #a-autoid-0, #a-autoid-1, etc. — these are random and often point to wrong elements.
- For "Add to Cart" buttons, use #add-to-cart-button or button text containing "Add to Cart".
- For product links on search results, use href-based selectors (a[href*="/dp/"]) or product title links.
- After adding an item to cart, use the search bar to find the NEXT item. Don't scroll on the cart page.

MULTI-STEP TASK EXAMPLES:
- "Add cheapest USB-C cable to cart" → search → find cheapest → click product → click Add to Cart → done
- "Write an email to john about meeting" → click compose → type to field → type subject → type body → click send → done
- "Find and open the first search result" → type query → click search → click first result → done

NAVIGATION CONTEXT:
- If a previous action was "Page navigated", you are now on a NEW page. Look at the current URL and DOM to understand where you are.
- After navigation, continue with the next step of the user's goal (e.g., search for the product).
- The DOM snapshot and screenshot now show the NEW page, not the old one."""

SYSTEM_PROMPT = """You are ScreenSense, a screen-aware AI execution agent in a Chrome extension.

CRITICAL: When the user wants you to DO something (click, type, search, navigate, add to cart, etc.), you MUST respond with type "steps" containing an action. NEVER respond with type "answer" to describe what you plan to do — actually DO IT. Only use type "answer" when the user asks a QUESTION about the page content (e.g., "what is the price?").

You receive THREE or FOUR inputs:
1. A screenshot of the user's current browser tab
2. A DOM snapshot — a JSON object with REAL CSS selectors for every interactive element on the page
3. A voice command from the user
4. (Optional) Full page content from Firecrawl — clean markdown of the ENTIRE page including content below the fold

CRITICAL — UNDERSTAND THE FULL PAGE FIRST:
- You receive the FULL page content (via Firecrawl markdown), not just what's visible in the screenshot.
- ALWAYS read and analyze the Firecrawl content to understand the ENTIRE page structure — forms, sections, content below the fold, etc.
- The DOM snapshot shows ALL interactive elements on the page, including ones NOT visible in the screenshot (check the "inViewport" field).
- Elements with "inViewport": false exist on the page but need scrolling to reach. You can still interact with them — scroll to them first, or use their selectors directly.

FORM FILLING INTELLIGENCE:
- When the user wants to fill a form, FIRST analyze ALL form fields from the DOM snapshot (inputs[], forms[]).
- Identify what information is needed for each field (name, email, phone, address, etc.).
- If the user hasn't provided all required information, ASK for the missing details using the "needs_clarification" response:
  {"type": "answer", "reasoning": "The form has fields for name, email, and phone. The user only said to fill the form but didn't provide these details.", "needs_clarification": true, "question": "I can see the form needs your name, email, and phone number. Could you tell me these details?", "speak": "I need some info first"}
- If the form is below the fold, scroll to it first, then analyze and fill it.
- Fill forms field by field — one "type" action per field, using exact selectors.

CRITICAL RULES:
- You MUST use the EXACT CSS selectors from the DOM snapshot. NEVER guess or make up selectors.
- The DOM snapshot contains: buttons[], links[], inputs[], forms[], text_content, url, title
- Each element has a "selector" field — USE IT EXACTLY as provided.
- If the user asks about content visible on the page or in the DOM or Firecrawl content, ALWAYS answer based on what you know. You have FULL knowledge of the page.
- If the user wants to do something on a DIFFERENT website, use the navigate action to go there first.
- You CAN navigate to any website. Use navigate action with the full URL.

RESPONSE FORMAT — respond with ONE JSON object only, no markdown, no explanation:

IMPORTANT: Always include a "reasoning" field in your JSON response with a 1-2 sentence explanation of your decision.

For QUESTIONS (user asks about the page):
{"type": "answer", "reasoning": "I can see the price displayed in the product details section", "text": "your answer"}

For TASKS (user wants you to do something on the page):
{"type": "steps", "reasoning": "I see a search box at the top of the page. I'll type the query and click search.", "actions": [...]}

SUPPORTED ACTIONS (use exact selectors from DOM snapshot):
Every action MUST include a "speak" field — a 3-5 word phrase spoken aloud to the user (e.g., "Opening Amazon", "Searching protein bars", "Adding to cart").

- click: {"action": "click", "selector": "<from DOM>", "description": "Click the X button", "speak": "Clicking X"}
- type: {"action": "type", "selector": "<from DOM>", "value": "text", "description": "Type X into Y", "speak": "Searching for X"}
- navigate: {"action": "navigate", "url": "https://...", "description": "Navigate to X", "speak": "Opening X"}
- scroll: {"action": "scroll", "direction": "up|down|top|bottom", "description": "Scroll", "speak": "Scrolling down"}
- extract: {"action": "extract", "selector": "<from DOM>", "description": "Get text from X", "speak": "Reading text"}

CRITICAL RULES:
- Return EXACTLY ONE action at a time. After each action, you'll get a fresh screenshot and DOM with updated selectors.
- Always scroll commands MUST return type "steps" with a scroll action — NEVER return "done" or "answer" for scroll requests.
- NEVER return "done" on the first call unless the task is literally already complete on the current page.
- If a target element is below the fold (inViewport: false), scroll down to reach it first.
- Be FAST and DECISIVE. One action, move forward.

IMPORTANT: Always look at the DOM snapshot FIRST to find the right selector. The screenshot helps you understand what the user sees, but the DOM snapshot has the actual selectors you must use. The Firecrawl content gives you the full page context including text you can't see in the screenshot."""

CONVERSATIONAL_ADDENDUM = """
You may respond with JSON containing any of these action types:
- {"action": "click", "selector": "..."} — click an element
- {"action": "type", "selector": "...", "value": "..."} — type text
- {"action": "navigate", "url": "..."} — go to URL
- {"action": "scroll", "direction": "..."} — scroll the page
- {"speak": "..."} — speak a response to the user
- {"needs_clarification": true, "question": "..."} — ask the user a question
- {"options": [...], "question": "..."} — present choices
- {"suggestion": "...", "requires_confirmation": true} — suggest an action
"""

INTENT_CLASSIFICATION = """
When the user has an ongoing conversation, classify their intent:
- "new_task": Starting a completely new request
- "reply": Answering a question you asked
- "follow_up": Asking about something related to current conversation
- "correction": Correcting a misunderstanding
- "interruption": Asking to stop or cancel

Include your classification: {"intent": "<type>", ...rest of response}
"""


# ── Core LLM call ───────────────────────────────────────────────────────────


def _call_nova(system_prompt: str, user_content: list[dict]) -> str:
    """Call an AI model via AWS Bedrock converse API with vision support.

    Supports Nova Lite, Nova Pro, Claude Haiku 4.5, and Claude Sonnet 4.
    Model is selected via the SCREENSENSE_MODEL environment variable.
    """
    client = _get_bedrock_client()
    model = get_active_model()
    model_id = model["model_id"]

    # Build Bedrock-format message content
    bedrock_content = []
    for block in user_content:
        if block.get("type") == "image":
            bedrock_content.append({
                "image": {
                    "format": "jpeg",
                    "source": {"bytes": block["bytes"]},
                }
            })
        elif block.get("type") == "text":
            bedrock_content.append({
                "text": block["text"],
            })

    try:
        response = client.converse(
            modelId=model_id,
            system=[{"text": system_prompt}],
            messages=[{"role": "user", "content": bedrock_content}],
            inferenceConfig={"maxTokens": model["max_tokens"]},
        )
        response_text = response["output"]["message"]["content"][0]["text"]
        return response_text
    except ClientError as e:
        error_code = e.response["Error"]["Code"]
        error_msg = e.response["Error"]["Message"]
        if "AccessDenied" in error_code:
            raise ValueError(f"Access denied — {error_msg} (check IAM permissions for Bedrock)") from e
        raise ValueError(f"Bedrock API error ({error_code}): {error_msg}") from e
    except (NoCredentialsError, PartialCredentialsError) as e:
        raise ValueError(
            "AWS credentials are invalid or incomplete — set AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY in backend/.env"
        ) from e


# ── Public reasoning functions ──────────────────────────────────────────────


def reason_about_page(
    command: str,
    screenshot_base64: str,
    dom_snapshot: dict,
    firecrawl_markdown: str | None = None,
    conversation_history: list[dict] | None = None,
) -> dict:
    """Reason about the current page using an AI model via Bedrock.

    Args:
        command: The user's voice command text.
        screenshot_base64: Base64-encoded PNG screenshot (raw base64, no data URI prefix).
        dom_snapshot: Structured DOM data with interactive elements and their CSS selectors.
        firecrawl_markdown: Clean page text extracted by Firecrawl (optional).
        conversation_history: Prior conversation turns as list of {"role": ..., "content": ...} dicts (optional).

    Returns:
        A dict with either:
        - {"type": "answer", "text": "..."} for questions
        - {"type": "steps", "actions": [...]} for task commands
    """
    # Validate screenshot before processing
    try:
        base64.b64decode(screenshot_base64)
    except Exception:
        raise ValueError("Invalid screenshot: could not decode base64 data")

    compressed = _compress_screenshot(screenshot_base64)
    screenshot_bytes = base64.b64decode(compressed)

    conversation_preamble = ""
    if conversation_history:
        turns = "\n".join(
            f"{'User' if t['role'] == 'user' else 'Agent'}: {t['content']}"
            for t in conversation_history
        )
        conversation_preamble = f"\nConversation so far:\n{turns}\n"

    firecrawl_block = ""
    if firecrawl_markdown:
        firecrawl_block = f"\nPage content (via Firecrawl):\n{firecrawl_markdown[:15000]}\n"

    user_content = [
        {"type": "image", "bytes": screenshot_bytes},
        {"type": "text", "text": f"DOM Snapshot:\n{json.dumps(_truncate_dom(dom_snapshot, has_firecrawl=bool(firecrawl_markdown)))}"},
    ]

    if firecrawl_block:
        user_content.append({"type": "text", "text": firecrawl_block})

    if conversation_preamble:
        user_content.append({"type": "text", "text": conversation_preamble})

    user_content.append({"type": "text", "text": f"User command: {command}"})

    system_prompt = SYSTEM_PROMPT + CONVERSATIONAL_ADDENDUM
    if conversation_history:
        system_prompt += INTENT_CLASSIFICATION

    try:
        response_text = _call_nova(system_prompt, user_content)

        parsed = _extract_json(response_text)
        if parsed is not None:
            if isinstance(parsed, list):
                return {"type": "steps", "actions": parsed}
            if isinstance(parsed, dict) and "type" in parsed:
                return parsed
            return {"type": "answer", "text": response_text}
        return {"type": "answer", "text": response_text}

    except ValueError:
        raise
    except Exception as e:
        raise ValueError(f"Reasoning failed: {e}") from e


def reason_continue(
    original_command: str,
    action_history: list[dict],
    screenshot_base64: str,
    dom_snapshot: dict,
    firecrawl_markdown: str | None = None,
    conversation_history: list[dict] | None = None,
) -> dict:
    """Continue reasoning about a multi-step task after actions have been taken."""
    # Validate screenshot before processing
    try:
        base64.b64decode(screenshot_base64)
    except Exception:
        raise ValueError("Invalid screenshot: could not decode base64 data")

    # Compress action history for long chains
    if len(action_history) > 5:
        older = action_history[:-3]
        recent = action_history[-3:]
        older_summary = f"Previously completed {len(older)} actions: " + ", ".join(
            entry.get('description', 'Unknown')[:40] for entry in older
        )
        formatted_history = older_summary + "\n\nRecent actions:\n" + "\n".join(
            f"{len(older) + i + 1}. {entry.get('description', 'Unknown action')} -> {entry.get('result', 'Unknown result')}"
            for i, entry in enumerate(recent)
        )
    elif action_history:
        formatted_history = "\n".join(
            f"{i + 1}. {entry.get('description', 'Unknown action')} -> {entry.get('result', 'Unknown result')}"
            for i, entry in enumerate(action_history)
        )
    else:
        formatted_history = "(no actions taken yet)"

    conversation_preamble = ""
    if conversation_history:
        turns = "\n".join(
            f"{'User' if t['role'] == 'user' else 'Agent'}: {t['content']}"
            for t in conversation_history
        )
        conversation_preamble = f"\nConversation so far:\n{turns}\n"

    firecrawl_block = ""
    if firecrawl_markdown:
        firecrawl_block = f"\nPage content (via Firecrawl):\n{firecrawl_markdown[:15000]}\n"

    compressed = _compress_screenshot(screenshot_base64)
    screenshot_bytes = base64.b64decode(compressed)

    user_content = [
        {"type": "image", "bytes": screenshot_bytes},
        {"type": "text", "text": f"DOM Snapshot:\n{json.dumps(_truncate_dom(dom_snapshot, has_firecrawl=bool(firecrawl_markdown)))}"},
    ]

    if firecrawl_block:
        user_content.append({"type": "text", "text": firecrawl_block})

    if conversation_preamble:
        user_content.append({"type": "text", "text": conversation_preamble})

    user_content.append({
        "type": "text",
        "text": (
            f"Original command: {original_command}\n\n"
            f"Actions completed so far:\n{formatted_history}\n\n"
            f"What should I do next? If the task is complete, respond with type 'done'."
        ),
    })

    system_prompt = CONTINUE_SYSTEM_PROMPT + CONVERSATIONAL_ADDENDUM
    if conversation_history:
        system_prompt += INTENT_CLASSIFICATION

    try:
        response_text = _call_nova(system_prompt, user_content)

        parsed = _extract_json(response_text)
        if parsed is not None:
            if isinstance(parsed, list):
                return {"type": "steps", "actions": parsed}
            if isinstance(parsed, dict) and "type" in parsed:
                return parsed
            return {"type": "done", "summary": response_text}
        return {"type": "done", "summary": response_text}

    except ValueError:
        raise
    except Exception as e:
        raise ValueError(f"Continue reasoning failed: {e}") from e
