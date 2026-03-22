# ScreenSense Voice — Conversational Web Agent Design Spec

**Date:** 2026-03-21
**Status:** Draft
**Approach:** Firecrawl as Content Layer (Approach 1)

---

## Overview

Evolve ScreenSense Voice from a one-shot voice-to-action Chrome extension into a conversational web agent with three capabilities built in order:

1. **Conversational Web Agent** (this spec) — multi-turn voice dialogue while the agent navigates, researches, and acts
2. **Accessibility / Hands-Free Browsing** (future) — make any website fully navigable and listenable by voice
3. **Voice-Powered Monitoring / Alerts** (future) — watch pages and deliver voice notifications on changes

**Core principle:** Firecrawl reads pages, DOM scraper acts on pages, ElevenLabs handles all voice I/O.

---

## Phase 1: Code Cleanup

Before adding features, the codebase must be cleaned up. All changes follow DRY principles and best practices.

### 1.1 Break Apart Monoliths

#### service-worker.ts (1,075 LOC) → 4 modules + thin orchestrator

| New Module | Responsibility |
|------------|---------------|
| `src/background/offscreen-manager.ts` | Offscreen document lifecycle, recording start/stop, amplitude forwarding |
| `src/background/transcription-service.ts` | Audio → text (ElevenLabs STT primary, Groq Whisper fallback). Streaming support. AWS Transcribe removed. |
| `src/background/agent-executor.ts` | The reasoning loop — calls Nova, processes actions, manages iterations, conversation limit |
| `src/background/message-router.ts` | Central pub/sub for all Chrome message passing. Replaces the giant switch statement. |

`service-worker.ts` becomes a thin orchestrator wiring these modules together (~100-150 LOC).

#### cursor-bubble.ts (1,622 LOC) → 3 modules + container

| New Module | Responsibility |
|------------|---------------|
| `src/content/bubble-state-machine.ts` | State enum + transition logic (idle → listening → transcribing → understanding → planning → executing → answering → error → done) |
| `src/content/waveform-renderer.ts` | Amplitude visualization, canvas drawing |
| `src/content/chat-history.ts` | Conversation display, step tracking, streaming text |

`cursor-bubble.ts` becomes the DOM container that composes these (~200-300 LOC).

### 1.2 DRY Cleanup

| Issue | Fix |
|-------|-----|
| MIME type detection duplicated in 4 files | Extract `src/shared/mime-utils.ts` with `getMimeType()` and `getMimeExtension()` |
| Hardcoded backend URL `localhost:8000` | Move to `src/shared/constants.ts`, make configurable via settings |
| Hardcoded ElevenLabs voice ID and model in `tts.ts` | Move to `src/shared/constants.ts`, make configurable via settings |
| Magic numbers (25 iterations, 30000 chars, 15s timeout, etc.) | Move to `src/shared/constants.ts` with documenting comments |
| Dead `DEV_API_KEYS` in `storage.ts` | Remove entirely |
| `any` type casts in service-worker, cursor-bubble | Replace with proper TypeScript interfaces in `src/shared/types.ts` |
| Silent `.catch(() => {})` in 10+ places | Add `console.error` logging at minimum, proper error events where appropriate |
| Hackathon branding ("Amazon Nova Hackathon 2026") | Remove from `Settings.tsx` and `Welcome.tsx` |
| GitHub references (`github.com/anirxdh/Nova-AWS`) | Remove from `README.md` and `landing/index.html` |

### 1.3 Restructure STT — Remove AWS Transcribe

**Keep:**
- `src/background/api/elevenlabs-stt.ts` — becomes the **primary** STT provider
- `src/background/api/groq-stt.ts` — becomes the **fallback** STT provider

**Remove:**
- `backend/services/nova_sonic.py` — AWS Transcribe Streaming SDK. Delete entirely.
- All `amazon-transcribe` references from `backend/requirements.txt`
- AWS Transcribe references from service worker, types, and backend routers

**STT architecture decision: Frontend-direct.**
STT moves out of the backend entirely. The extension calls ElevenLabs STT directly from the service worker (via `elevenlabs-stt.ts`), falling back to Groq Whisper (via `groq-stt.ts`). This eliminates a network hop and simplifies the backend.

`transcription-service.ts` (new module from Section 1.1) orchestrates this:
```typescript
// transcription-service.ts
export async function transcribe(audioBlob: Blob): Promise<string> {
  try {
    return await elevenLabsSTT(audioBlob);  // primary
  } catch (err) {
    console.warn('ElevenLabs STT failed, falling back to Groq:', err);
    return await groqSTT(audioBlob);         // fallback
  }
}
```

`backend/routers/transcribe.py` and `backend/services/nova_sonic.py` are **deleted**. STT is fully frontend-direct — the backend has no STT responsibility.

**STT chain:** ElevenLabs (primary) → Groq Whisper (fallback). No AWS dependency.

---

## Phase 2: Firecrawl Integration

### 2.1 Backend Service

New file: `backend/services/firecrawl_service.py`

Uses `AsyncFirecrawl` (async-native, compatible with FastAPI).

**Three modes:**

| Mode | Method | When Used |
|------|--------|-----------|
| **Scrape** | `firecrawl.scrape(url, formats=["markdown"])` | User asks about current page content |
| **Crawl** | `firecrawl.start_crawl(url, limit=N)` + polling | User asks about a whole site |
| **Extract** | `firecrawl.extract(urls, prompt, schema)` | Agent needs structured data (prices, ratings, etc.) |

**Caching:** Results cached per URL with 5-minute TTL (conversations about a page can last several minutes; re-scraping on every turn wastes latency and credits). Cache is invalidated when the user navigates to a new URL.

**Error handling:** Retry with exponential backoff on 429 (rate limit). Surface errors to agent so it can inform the user via voice.

### 2.2 Backend Router

New file: `backend/routers/firecrawl.py`

Endpoints:
- `POST /firecrawl/scrape` — scrape single URL, return markdown
- `POST /firecrawl/extract` — structured extraction with prompt + optional schema
- `POST /firecrawl/crawl` — start async crawl job
- `GET /firecrawl/crawl/{job_id}` — check crawl status

### 2.3 Frontend Integration

New file: `src/background/api/firecrawl-client.ts`

The extension sends the current tab's URL to the backend. Backend calls Firecrawl and returns clean markdown. This markdown is included in the Nova reasoning context alongside the DOM snapshot and screenshot.

**Data flow:**
```
Content script gets URL → sends to service worker
  → service worker calls backend /firecrawl/scrape
  → backend calls Firecrawl API
  → returns clean markdown
  → included in Nova's reasoning context
```

### 2.4 How Firecrawl + DOM Scraper Work Together

| Need | Tool | Why |
|------|------|-----|
| "What does this page say?" | Firecrawl | Clean markdown, understands content semantics |
| "Click the checkout button" | DOM Scraper | Knows element selectors, in-browser instant execution |
| "Compare prices across 3 sites" | Firecrawl crawl/scrape | Can read pages the user isn't currently on |
| "Fill in this form" | DOM Scraper | Needs to interact with input elements |
| "Summarize this article" | Firecrawl | Strips nav/footer noise, returns only main content |

---

## Phase 3: Conversation Manager

### 3.1 Module

New file: `src/background/conversation-manager.ts`

Central orchestrator for multi-turn voice dialogue. Sits between transcription and the agent executor.

### 3.2 Conversation States

```
idle → listening → processing → speaking → awaiting_reply → processing → ...
                                         → idle (timeout)
```

| State | Meaning |
|-------|---------|
| `idle` | No active conversation. Waiting for shortcut press. |
| `listening` | User is speaking. Recording audio. |
| `processing` | Agent is thinking — calling Nova, Firecrawl, executing actions. |
| `speaking` | ElevenLabs TTS playing agent's response. |
| `awaiting_reply` | Agent asked a question. Mic auto-opens after TTS finishes. |
| `executing` | Agent is performing browser actions (clicking, typing, navigating). |

### 3.3 Voice Activation UX — Hybrid Push-to-Talk + Auto-Listen

| Moment | Behavior | Rationale |
|--------|----------|-----------|
| Start conversation | Hold shortcut to speak | Prevents false activation |
| Agent asks a question | Audio cue (beep) → mic auto-opens for 10s | Natural conversation flow |
| User done replying | 1.5s silence → mic closes | Proven turn-taking pattern (Alexa, Google, Siri) |
| User interrupts agent speaking | Press shortcut → TTS stops, mic opens | User stays in control |
| Conversation idle for 30s | Session closes, back to hold-to-talk | Prevents forgotten open mics |

### 3.4 Conversation History

```typescript
interface ConversationTurn {
  role: 'user' | 'agent';
  content: string;
  timestamp: number;
  context?: {
    url: string;
    firecrawlMarkdown?: string;
    domSnapshot?: string;
    screenshotBase64?: string;
  };
}
```

- Stored per tab (existing pattern)
- Capped at 20 turns to keep Nova's context manageable
- When cap is hit, oldest 10 turns are summarized into a single "context summary" turn via a lightweight Nova call with a fixed prompt ("Summarize this conversation so far in 3-4 sentences"). This runs synchronously before the next agent invocation. The summary replaces the oldest turns, freeing ~10 slots.
- Conversation state is ephemeral — lost when the service worker is terminated or browser restarts. This is intentional; conversations are short-lived by nature.

### 3.5 Agent Response Types

The agent (Nova) returns structured responses that the conversation manager routes:

| Response Type | Behavior |
|---------------|----------|
| `{ action: "click", selector: "..." }` | Execute action, continue loop |
| `{ speak: "Here's what I found..." }` | TTS speaks, state → idle |
| `{ needs_clarification: true, question: "Did you mean X or Y?" }` | TTS speaks question, state → awaiting_reply, mic auto-opens |
| `{ options: [...], question: "Which one?" }` | TTS speaks options, state → awaiting_reply |
| `{ suggestion: "...", requires_confirmation: true }` | TTS speaks suggestion, waits for yes/no |
| `{ research: { urls: [...] } }` | Firecrawl scrapes in background, agent continues |

### 3.6 Intent Classification

When a user speaks during an active conversation, the conversation manager classifies intent:

| Intent | Example | Routing |
|--------|---------|---------|
| New task | "Go to Amazon and find laptops" | Start new agent loop |
| Reply to question | "The second one" | Feed into existing agent loop context |
| Follow-up | "What about the price?" | Continue conversation with history |
| Correction | "No, I meant the blue one" | Update context, re-reason |
| Interruption | "Stop" / "Cancel" | Cancel current action, speak confirmation |

Intent classification is handled by Nova using the conversation history as context.

### 3.7 Conversation History → Backend Flow

The conversation history must be sent to the backend so Nova can reason with full context.

**How it flows:**

1. Conversation Manager maintains `ConversationTurn[]` per tab (frontend)
2. On each agent invocation, the frontend sends history to `POST /task`:

```typescript
// Added to the /task request body:
{
  question: string;              // current user utterance
  screenshot: string;            // base64
  dom_snapshot: object;          // existing DOM scraper output
  firecrawl_markdown?: string;   // page content from Firecrawl cache
  conversation_history: Array<{  // NEW — text-only prior turns
    role: 'user' | 'agent';      // Per-turn context (screenshots, DOM, Firecrawl)
    content: string;              // is intentionally omitted — only the CURRENT
  }>;                             // turn's context is sent fresh. History is
}                                 // text-only for token efficiency.
```

3. Backend passes history to Nova's content array as a conversation preamble
4. Turn summarization happens on the **frontend** — when the 20-turn cap is hit, older turns are summarized into a single "context summary" turn before sending

**Nova prompt changes in `nova_reasoning.py`:**

The system prompt is extended with:
```
You are in an ongoing conversation with the user. Here is the conversation so far:
{conversation_history formatted as User:/Agent: turns}

The user's latest message is: {current question}

You may:
- Act on the page (click, type, scroll, etc.)
- Speak a response to the user
- Ask a clarifying question if the request is ambiguous
- Suggest an action and wait for confirmation
- Research by requesting URLs to be scraped

Respond with a JSON object containing your chosen action type.
```

The Firecrawl markdown is included as a separate content block:
```
Page content (via Firecrawl):
{firecrawl_markdown}

Interactive elements (via DOM scraper):
{dom_snapshot}
```

This separates "what the page says" from "what you can click on."

### 3.8 Two State Machines — Conversation vs. Bubble Display

The spec defines two distinct state machines that must not be confused:

| State Machine | Purpose | States |
|--------------|---------|--------|
| **Conversation State** (in `conversation-manager.ts`) | Controls dialogue flow, mic behavior, agent routing | `idle`, `listening`, `processing`, `speaking`, `awaiting_reply`, `executing` |
| **Bubble Display State** (in `bubble-state-machine.ts`) | Controls UI rendering in the cursor bubble | `idle`, `listening`, `transcribing`, `understanding`, `planning`, `executing`, `answering`, `error`, `done` |

The Conversation Manager maps its state to bubble display states:
- `listening` → bubble `listening`
- `processing` → bubble `understanding` → `planning`
- `speaking` → bubble `answering`
- `awaiting_reply` → bubble `listening` (with visual indicator that agent is waiting)
- `executing` → bubble `executing`

---

## Phase Dependencies

```
Phase 1 (Code Cleanup)
  ├── 1.1 Break monoliths ──┐
  ├── 1.2 DRY cleanup ──────┤── All independent, can be parallelized
  └── 1.3 Restructure STT ──┘
            │
            ▼
Phase 2 (Firecrawl Integration)
  ├── 2.1 Backend service ──── can start after Phase 1
  ├── 2.2 Backend router ───── depends on 2.1
  └── 2.3 Frontend client ──── depends on 2.2
            │
            ▼
Phase 3 (Conversation Manager) ── depends on Phase 1 (refactored service-worker)
  │                                 and Phase 2 (Firecrawl context available)
  │
  ▼
Phase 4 (ElevenLabs Voice Flow) ── depends on Phase 3 (conversation states drive mic behavior)
```

Phase 1 tasks can be parallelized. Phases 2-4 are sequential.

---

## Phase 4: ElevenLabs Voice Flow

### 4.1 STT (Speech-to-Text)

- **Primary:** ElevenLabs STT (already in `elevenlabs-stt.ts`)
- **Fallback:** Groq Whisper (already in `groq-stt.ts`)
- **Removed:** AWS Transcribe

### 4.2 TTS (Text-to-Speech)

- **Provider:** ElevenLabs (existing `tts.ts`)
- **Streaming:** Keep existing streaming implementation for low-latency responses
- **Configuration:** Voice ID and model moved to settings (currently hardcoded)
- **Interruption:** Pressing shortcut during TTS playback stops audio and opens mic

### 4.3 Auto-Reopen Mic Flow

```
Agent speaks question via TTS
  → TTS playback finishes
  → 500ms pause
  → Audio cue (short beep)
  → Mic auto-opens
  → User speaks
  → 1.5s silence detected → mic closes
  → Transcription → back to agent
```

---

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                    Chrome Extension                          │
│                                                              │
│  ┌──────────────┐   ┌─────────────────────────────────────┐ │
│  │Content Script │   │        Service Worker               │ │
│  │              │   │                                     │ │
│  │ DOM Scraper  │   │  ┌──────────────────────┐          │ │
│  │ Action Exec  │   │  │ Conversation Manager │          │ │
│  │ Cursor Bubble│   │  │  (state, history,    │          │ │
│  │  - State Mach│   │  │   intent routing)    │          │ │
│  │  - Waveform  │   │  └──────────┬───────────┘          │ │
│  │  - Chat Hist │   │             │                       │ │
│  │ TTS Player   │   │  ┌──────────┴───────────┐          │ │
│  │              │   │  │   Message Router     │          │ │
│  └──────┬───────┘   │  └──┬──────┬──────┬─────┘          │ │
│         │           │     │      │      │                 │ │
│         │           │  ┌──┴──┐┌──┴───┐┌─┴──────────┐     │ │
│         │           │  │Offsc││Trans ││Agent       │     │ │
│         │           │  │Mgr  ││Svc   ││Executor    │     │ │
│         │           │  └─────┘└──────┘└────────────┘     │ │
│         │           └─────────────────────────────────────┘ │
└─────────┼───────────────────────────────────────────────────┘
          │
          ▼
┌─────────────────────────────────────────────────────────────┐
│                    FastAPI Backend                            │
│                                                              │
│  ┌────────────────┐  ┌──────────────┐                        │
│  │ /task           │  │ /firecrawl   │  STT is frontend-     │
│  │  Nova reasoning │  │  /scrape     │  direct (extension    │
│  │  with Firecrawl │  │  /extract    │  calls ElevenLabs/    │
│  │  markdown ctx   │  │  /crawl      │  Groq directly)       │
│  └────────┬───────┘  └──────┬───────┘                        │
│           │                 │                                │
│  ┌────────┴───────┐  ┌─────┴────────┐                       │
│  │ Nova Reasoning │  │ Firecrawl    │                       │
│  │ Service        │  │ Service      │                       │
│  │                │  │ (AsyncFirecrawl)                     │
│  │                │  │ + URL cache  │                       │
│  └────────────────┘  └──────────────┘                       │
└─────────────────────────────────────────────────────────────┘
          │                    │
          ▼                    ▼
   AWS Bedrock (Nova)    Firecrawl API
                         ElevenLabs API
                         Groq API
```

---

## File Structure (New/Changed)

```
src/
  background/
    service-worker.ts          # Thin orchestrator (~150 LOC, down from 1075)
    offscreen-manager.ts       # NEW — offscreen document lifecycle
    transcription-service.ts   # NEW — STT orchestration
    agent-executor.ts          # NEW — reasoning loop
    message-router.ts          # NEW — Chrome message pub/sub
    conversation-manager.ts    # NEW — multi-turn dialogue state
    api/
      backend-client.ts        # UPDATED — add Firecrawl endpoints
      elevenlabs-stt.ts        # KEPT — primary STT
      groq-stt.ts              # KEPT — fallback STT
  content/
    cursor-bubble.ts           # SLIMMED — container only (~250 LOC, down from 1622)
    bubble-state-machine.ts    # NEW — state enum + transitions
    waveform-renderer.ts       # NEW — amplitude canvas
    chat-history.ts            # NEW — conversation display
    dom-scraper.ts             # KEPT — action target identification
    action-executor.ts         # KEPT — browser action execution
    tts.ts                     # UPDATED — configurable voice, interruption support
    audio-recorder.ts          # KEPT
    content-script.ts          # UPDATED — cleaner message handling
  shared/
    constants.ts               # UPDATED — all hardcoded values centralized
    types.ts                   # UPDATED — proper interfaces, no more `any`
    mime-utils.ts              # NEW — shared MIME detection (DRY)
    storage.ts                 # UPDATED — remove dead DEV_API_KEYS

backend/
  services/
    firecrawl_service.py       # NEW — AsyncFirecrawl wrapper with caching
    nova_reasoning.py          # UPDATED — accept Firecrawl markdown in context
  routers/
    firecrawl.py               # NEW — scrape/extract/crawl endpoints
    task.py                    # UPDATED — accept conversation history + Firecrawl context
    transcribe.py              # DELETED — STT is now frontend-direct
  services/
    nova_sonic.py              # DELETED — AWS Transcribe removed entirely
```

---

## Security

- **Firecrawl API key is backend-only.** Never exposed to the extension. Stored in `backend/.env`, loaded via `os.getenv()`.
- **SSRF protection:** Backend validates URLs before passing to Firecrawl — reject private/internal IPs (`10.x`, `192.168.x`, `localhost`, `127.0.0.1`).
- **Firecrawl rate limiting:** Backend implements a request queue — max 5 Firecrawl calls per minute (well within free tier of 10/min). Agent loop debounces repeated scrapes of the same URL.
- **ElevenLabs/Groq keys** remain in `chrome.storage.local` (existing pattern) since STT is frontend-direct.

---

## Error Handling Strategy

| Failure | Handling |
|---------|----------|
| Firecrawl API down | Fall back to DOM scraper for content. Inform user via voice: "I can't read the page content right now, but I can still interact with it." |
| ElevenLabs STT fails | Fall back to Groq Whisper. Transparent to user. |
| ElevenLabs TTS fails | Fall back to browser's built-in `speechSynthesis` API. Lower quality but functional. |
| Nova reasoning fails | Speak error to user. Don't silently fail. |
| Network timeout | Retry once with backoff. If still fails, inform user via voice. |
| Mic permission revoked | Detect and prompt user to re-grant. |

---

## Testing Strategy

| Layer | Approach |
|-------|----------|
| Shared utilities (`mime-utils`, `constants`) | Unit tests (Jest) |
| Conversation Manager state machine | Unit tests — test all state transitions |
| Firecrawl Service | Integration tests with mocked Firecrawl API |
| Agent Executor | Unit tests — mock Nova responses, verify action routing |
| Message Router | Unit tests — verify message dispatch |
| Backend endpoints | Pytest with FastAPI TestClient |
| End-to-end | Manual testing in Chrome with extension loaded |

---

## Success Criteria

1. User can hold shortcut, speak, and have a multi-turn conversation with the agent
2. Agent can read page content via Firecrawl and discuss it intelligently
3. Agent can ask clarifying questions and wait for voice responses
4. Agent can present options and act on user's spoken choice
5. Agent can research across multiple pages using Firecrawl crawl
6. Agent can proactively suggest actions and wait for confirmation
7. TTS can be interrupted by pressing the shortcut
8. All hardcoded values are configurable
9. No file exceeds ~300 LOC
10. All `any` types replaced with proper interfaces
