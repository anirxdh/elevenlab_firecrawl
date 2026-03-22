# Testing Guide

This document covers how to run all tests, what each test suite covers, and how to verify the full project end-to-end.

---

## Quick Start

```bash
# Run all backend tests
cd backend && python -m pytest -v

# Run all frontend tests
npm test

# Build the extension
npm run build
```

---

## Backend Tests (Python / pytest)

### Setup

```bash
cd backend
pip install -r requirements.txt
```

### Run

```bash
# All tests with verbose output
python -m pytest -v

# Specific test file
python -m pytest tests/test_nova_reasoning.py -v

# Run with coverage (install pytest-cov first)
python -m pytest --cov=backend --cov-report=term-missing
```

### Test Files

| File | Tests | What it covers |
|------|-------|----------------|
| `test_nova_reasoning.py` | 68 | Core AI reasoning: system prompts, JSON extraction, screenshot compression, DOM truncation, credential validation, Bedrock error handling, response parsing |
| `test_task.py` | 30+ | `/task` and `/task/continue` endpoints: request validation, response format, error propagation, conversation history |
| `test_transcribe.py` | 25+ | `/transcribe` endpoint: audio upload, file size limits, MIME type handling, WebSocket streaming protocol |
| `test_transcribe_service.py` | 15+ | `nova_sonic` service: AWS Transcribe + Groq Whisper fallback, audio format detection, error handling |
| `test_firecrawl_service.py` | 16 | Firecrawl service: scraping, caching (5-min TTL), SSRF protection (blocks private IPs), structured extraction, crawl jobs |
| `test_event_bus.py` | 18 | EventBus pub/sub: subscribe/unsubscribe, multi-client broadcast, event ordering, data serialization |
| `test_health.py` | 3 | Health check endpoint, route registration verification |

### What's tested

- **Credential validation**: Empty, missing, and placeholder AWS keys are caught before hitting the SDK
- **Screenshot validation**: Invalid base64 data raises clear errors
- **Error wrapping**: AWS errors (NoCredentials, AccessDenied, Throttling, Validation) produce helpful messages
- **JSON extraction**: 4 strategies for parsing LLM responses (direct, markdown code blocks, embedded objects, arrays)
- **DOM truncation**: Large snapshots are progressively trimmed to stay under token limits
- **SSRF protection**: Firecrawl blocks localhost, 127.0.0.1, and private IP ranges
- **Cache behavior**: Scrape results are cached for 5 minutes, different URLs don't share cache

---

## Frontend Tests (TypeScript / Jest)

### Setup

```bash
npm install
```

### Run

```bash
# All tests
npm test

# Watch mode (re-runs on file changes)
npx jest --watch

# Specific test file
npx jest src/__tests__/dom-scraper.test.ts

# With coverage
npx jest --coverage
```

### Test Files

| File | Tests | What it covers |
|------|-------|----------------|
| `dom-scraper.test.ts` | 40+ | DOM element extraction: buttons, links, inputs, forms, products, headings, tables; CSS selector generation; visibility detection |
| `action-executor.test.ts` | 35+ | Action execution: click, type, navigate, scroll, extract; selector sanitization; allowlist validation; highlight effects |
| `service-worker.test.ts` | 30+ | Service worker message routing: pipeline orchestration, conversation management, screenshot capture |
| `conversation-manager.test.ts` | 25+ | State machine transitions (Idle -> Listening -> Processing -> Speaking -> etc.); per-tab session isolation; idle timeout; intent classification |
| `backend-client.test.ts` | 20+ | HTTP client: POST /task, POST /task/continue, POST /firecrawl/scrape; error handling; timeout behavior |
| `classify-response.test.ts` | 15+ | Response type classification: new_task, reply, follow_up, correction, interruption |
| `transcription-service.test.ts` | 15+ | Audio transcription flow: ElevenLabs primary, Groq fallback, error propagation |
| `backend-client.test.ts` | 15+ | SSE connection, request formatting, response parsing |

### What's tested

- **DOM scraping**: Element extraction with correct CSS selectors, visibility filtering, product detection
- **Action safety**: Selector sanitization against injection, allowlist enforcement, rate limiting
- **State machine**: All valid transitions, invalid transition rejection, per-tab isolation
- **API client**: Request/response format, timeout handling, error propagation
- **Transcription**: Primary/fallback flow, API key handling, error cases

---

## Integration Verification

After all unit tests pass, verify the full system works end-to-end:

### 1. Backend starts correctly

```bash
cd backend
python -m backend.main
```

Visit `http://localhost:8000/health` - should return `{"status": "ok"}`.

Visit `http://localhost:8000/docs` - should show Swagger UI with all endpoints:
- `GET /health`
- `POST /task`
- `POST /task/continue`
- `GET /events`
- `POST /transcribe`
- `WS /transcribe/stream`
- `POST /firecrawl/scrape`
- `POST /firecrawl/extract`
- `POST /firecrawl/crawl`
- `GET /firecrawl/crawl/{job_id}`

### 2. Extension builds and loads

```bash
npm run build
```

Load `dist/` in Chrome (`chrome://extensions` > Developer mode > Load unpacked). Verify:
- Extension icon appears in toolbar
- Popup opens when clicked
- Welcome page shows on first install
- Settings page opens from popup

### 3. Voice pipeline works

1. Navigate to any website
2. Hold backtick key (`) and speak a command
3. Verify: recording indicator -> transcription -> AI reasoning -> action execution
4. Check Chrome DevTools console for any errors

### 4. Multi-step agent loop works

Try: *"Search for headphones on Amazon and add the first result to cart"*

Verify the agent:
- Navigates to Amazon (if not already there)
- Types search query
- Clicks a product
- Adds to cart
- Signals completion

---

## Troubleshooting Test Failures

### Backend: `ModuleNotFoundError`

Run tests from the project root, not from `backend/`:
```bash
cd /path/to/project/backend
python -m pytest -v
```

### Backend: AWS credential errors in tests

Tests mock AWS calls - you do NOT need real AWS credentials to run tests. If you see credential errors, a test may be missing its `@patch` decorator.

### Frontend: `Cannot find module` errors

```bash
rm -rf node_modules && npm install
```

### Frontend: Timeout warnings

The `ConversationManager` tests may show timeout-related console output - this is normal (idle timer firing during tests). All tests should still pass.

---

## Test Coverage Summary

| Component | Test Count | Status |
|-----------|-----------|--------|
| Backend (pytest) | 170 | All passing |
| Frontend (jest) | 244 | All passing |
| **Total** | **414** | **All passing** |
