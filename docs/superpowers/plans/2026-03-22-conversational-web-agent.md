# Conversational Web Agent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Evolve ScreenSense Voice from a one-shot voice-to-action Chrome extension into a multi-turn conversational web agent powered by Firecrawl (content reading) and ElevenLabs (voice I/O).

**Architecture:** Firecrawl reads pages (clean markdown), DOM scraper acts on pages (selectors/clicks), ElevenLabs handles all voice I/O (STT + TTS). A new Conversation Manager orchestrates multi-turn dialogue with state tracking, history, and intent classification via Nova.

**Tech Stack:** TypeScript (Chrome MV3 extension), React, Python (FastAPI backend), AWS Bedrock Nova Lite, Firecrawl API, ElevenLabs API, Groq Whisper (STT fallback)

**Spec:** `docs/superpowers/specs/2026-03-21-conversational-web-agent-design.md`

---

## Phase 1: Code Cleanup

### Task 1: Extract Shared MIME Utilities (DRY)

MIME type detection is duplicated in `src/offscreen/offscreen.ts:56-63`, `src/content/audio-recorder.ts:32-37`, `src/background/api/elevenlabs-stt.ts:21-27`, and `src/background/api/groq-stt.ts:19-25`.

**Note:** `offscreen.ts` prefers `ogg` first while `audio-recorder.ts` prefers `webm` first. The shared function unifies on `webm`-first order. This is a minor behavioral change for offscreen recording but has no practical impact since both codecs produce compatible audio.

**Files:**
- Create: `src/shared/mime-utils.ts`
- Create: `src/__tests__/mime-utils.test.ts`
- Modify: `src/offscreen/offscreen.ts:56-62`
- Modify: `src/content/audio-recorder.ts:30-36`
- Modify: `src/background/api/elevenlabs-stt.ts:21-27`
- Modify: `src/background/api/groq-stt.ts:19-25`

- [ ] **Step 1: Write the failing test**

```typescript
// src/__tests__/mime-utils.test.ts
import { getSupportedMimeType, getMimeExtension } from '../shared/mime-utils';

describe('mime-utils', () => {
  test('getMimeExtension returns correct extension for known types', () => {
    expect(getMimeExtension('audio/webm;codecs=opus')).toBe('webm');
    expect(getMimeExtension('audio/webm')).toBe('webm');
    expect(getMimeExtension('audio/ogg;codecs=opus')).toBe('ogg');
    expect(getMimeExtension('audio/mp4')).toBe('mp4');
    expect(getMimeExtension('audio/wav')).toBe('wav');
  });

  test('getMimeExtension returns webm for unknown types', () => {
    expect(getMimeExtension('audio/unknown')).toBe('webm');
  });

  test('getSupportedMimeType returns a string', () => {
    // MediaRecorder.isTypeSupported is not available in test env
    // so this just verifies the function exists and returns string
    const result = getSupportedMimeType();
    expect(typeof result).toBe('string');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/__tests__/mime-utils.test.ts --forceExit`
Expected: FAIL with "Cannot find module '../shared/mime-utils'"

- [ ] **Step 3: Write the implementation**

```typescript
// src/shared/mime-utils.ts

const MIME_PREFERENCE = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/ogg;codecs=opus',
  'audio/mp4',
  'audio/wav',
];

const MIME_TO_EXT: Record<string, string> = {
  'audio/webm;codecs=opus': 'webm',
  'audio/webm': 'webm',
  'audio/ogg;codecs=opus': 'ogg',
  'audio/mp4': 'mp4',
  'audio/wav': 'wav',
};

/**
 * Returns the best supported MIME type for audio recording.
 * Falls back to 'audio/webm' if none are explicitly supported.
 */
export function getSupportedMimeType(): string {
  if (typeof MediaRecorder !== 'undefined') {
    for (const mime of MIME_PREFERENCE) {
      if (MediaRecorder.isTypeSupported(mime)) return mime;
    }
  }
  return 'audio/webm';
}

/**
 * Returns file extension for a given MIME type string.
 */
export function getMimeExtension(mimeType: string): string {
  return MIME_TO_EXT[mimeType] ?? 'webm';
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/__tests__/mime-utils.test.ts --forceExit`
Expected: PASS

- [ ] **Step 5: Replace duplicated MIME logic in all 4 files**

In each file, replace the inline MIME selection with:
```typescript
import { getSupportedMimeType, getMimeExtension } from '../shared/mime-utils';
```

Files to update:
- `src/offscreen/offscreen.ts:56-62` — replace MIME selection block with `const mimeType = getSupportedMimeType();`
- `src/content/audio-recorder.ts:30-36` — same replacement
- `src/background/api/elevenlabs-stt.ts:21-27` — replace extension detection with `getMimeExtension(mimeType)`
- `src/background/api/groq-stt.ts:19-25` — same replacement

- [ ] **Step 6: Run all tests**

Run: `npx jest --forceExit --detectOpenHandles`
Expected: All tests pass

- [ ] **Step 7: Commit**

```bash
git add src/shared/mime-utils.ts src/__tests__/mime-utils.test.ts src/offscreen/offscreen.ts src/content/audio-recorder.ts src/background/api/elevenlabs-stt.ts src/background/api/groq-stt.ts
git commit -m "refactor: extract shared MIME utilities to eliminate duplication"
```

---

### Task 2: Centralize Constants and Remove Dead Code

Hardcoded values are scattered across files. `DEV_API_KEYS` in `storage.ts:32-36` is dead code.

**Files:**
- Modify: `src/shared/constants.ts` (currently 19 LOC)
- Modify: `src/shared/storage.ts:32-48` (remove DEV_API_KEYS)
- Modify: `src/content/tts.ts:7-8` (voice ID + model)
- Modify: `src/background/api/backend-client.ts:1,79` (URLs)
- Modify: `src/content/action-executor.ts:54` (rate limit)

- [ ] **Step 1: Add all hardcoded values to constants.ts**

Add to `src/shared/constants.ts`:
```typescript
// Backend connection
export const BACKEND_URL = 'http://localhost:8000';
export const BACKEND_WS_URL = 'ws://localhost:8000';

// ElevenLabs TTS defaults
export const DEFAULT_VOICE_ID = '21m00Tcm4TlvDq8ikWAM';
export const DEFAULT_TTS_MODEL = 'eleven_flash_v2_5';

// Agent loop limits
/** Max reasoning iterations before forcing completion */
export const MAX_AGENT_ITERATIONS = 25;
/** Max chars of DOM snapshot sent to Nova (prevents token overflow) */
export const DOM_SNAPSHOT_MAX_CHARS = 30000;
/** Timeout for backend API calls in ms */
export const BACKEND_TIMEOUT_MS = 15000;
/** Minimum ms between consecutive browser actions */
export const MIN_ACTION_INTERVAL_MS = 300;
```

- [ ] **Step 2: Update backend-client.ts to use constants**

Replace line 1 `const BACKEND_URL = 'http://localhost:8000'` with import from constants.
Replace line 79 `const WS_URL = 'ws://localhost:8000/transcribe/stream'` with `${BACKEND_WS_URL}/transcribe/stream`.

- [ ] **Step 3: Update tts.ts to use constants**

Replace lines 7-8 hardcoded values with imports from constants.

- [ ] **Step 4: Update action-executor.ts to use constants**

Replace line 54 `const MIN_ACTION_INTERVAL_MS = 300` with import from constants.

- [ ] **Step 5: Remove DEV_API_KEYS from storage.ts**

Delete lines 32-36 (the `DEV_API_KEYS` object). Update `getApiKeys()` at lines 38-48 to remove the fallback chain through `DEV_API_KEYS`:

```typescript
export async function getApiKeys(): Promise<{ groqKey?: string; elevenLabsKey?: string }> {
  const stored = await chrome.storage.local.get(['groqKey', 'elevenLabsKey']);
  return {
    groqKey: stored.groqKey || undefined,
    elevenLabsKey: stored.elevenLabsKey || undefined,
  };
}
```

- [ ] **Step 6: Build to verify no import errors**

Run: `npx webpack --mode development 2>&1 | head -20`
Expected: Builds successfully

- [ ] **Step 7: Commit**

```bash
git add src/shared/constants.ts src/shared/storage.ts src/content/tts.ts src/background/api/backend-client.ts src/content/action-executor.ts
git commit -m "refactor: centralize constants and remove dead DEV_API_KEYS"
```

---

### Task 3: Clean Up Types — Remove `any` Casts

Replace `any` type assertions with proper TypeScript interfaces.

**Files:**
- Modify: `src/shared/types.ts` (add missing interfaces)
- Modify: `src/background/service-worker.ts` (remove `any` casts)

- [ ] **Step 1: Add missing interfaces to types.ts**

```typescript
// Add to src/shared/types.ts

export interface DomSnapshot {
  url: string;
  title: string;
  buttons: ElementInfo[];
  links: ElementInfo[];
  inputs: InputInfo[];
  forms: FormInfo[];
  headings: { level: number; text: string }[];
  images: { alt: string; src: string }[];
  tables: string[][];
  lists: string[];
  products: ProductInfo[];
  selectedText: string;
  metaDescription: string;
}

export interface ElementInfo {
  selector: string;
  text: string;
  role?: string;
  href?: string;
}

export interface InputInfo {
  selector: string;
  label: string;
  type: string;
  value: string;
  placeholder: string;
}

export interface FormInfo {
  selector: string;
  action: string;
  inputs: InputInfo[];
}

export interface ProductInfo {
  name: string;
  price: string;
  selector: string;
}

export interface TaskStep {
  action: string;
  selector?: string;
  value?: string;
  url?: string;
  direction?: string;
  speak?: string;
  reason?: string;
}

export interface TaskResponse {
  answer?: string;
  steps?: TaskStep[];
  done?: boolean;
  speak?: string;
  needs_clarification?: boolean;
  question?: string;
  options?: string[];
  suggestion?: string;
  requires_confirmation?: boolean;
  research?: { urls: string[] };
}
```

**Important:** The existing `ConversationTurn` in `types.ts` uses `role: 'user' | 'assistant'`. Update it to `role: 'user' | 'agent'` to match the spec. Search for all usages of `role === 'assistant'` and update them.

- [ ] **Step 2: Replace `any` casts in service-worker.ts**

Key locations to fix:
- Line 79: `const chrome_ = chrome as any` → remove, use proper Chrome types
- Lines 661-667: `(domSnapshot as any)?.buttons` → type as `DomSnapshot`
- Lines 936, 963, 1001: message casting → use `MessageType` union
- Line 745: `(step as any).speak` → use `TaskStep` interface

- [ ] **Step 3: Build to verify**

Run: `npx webpack --mode development 2>&1 | head -20`
Expected: Builds with no type errors

- [ ] **Step 4: Commit**

```bash
git add src/shared/types.ts src/background/service-worker.ts
git commit -m "refactor: replace any casts with proper TypeScript interfaces"
```

---

### Task 4: Fix Silent Error Handling

Replace `.catch(() => {})` patterns with proper error logging.

**Files:**
- Modify: `src/background/screenshot.ts:8-10,18,24-25`
- Modify: `src/content/content-script.ts:33`
- Modify: `src/offscreen/offscreen.ts:38,90,93`

- [ ] **Step 1: Find and fix all silent catches**

Search for `.catch(() => {})` and `.catch(() => undefined)` patterns. Replace each with:

```typescript
.catch((err) => console.error('[ScreenSense] <context>:', err))
```

Where `<context>` describes the operation (e.g., "screenshot capture", "message send", "recording stop").

- [ ] **Step 2: Build to verify**

Run: `npx webpack --mode development 2>&1 | head -20`
Expected: Builds successfully

- [ ] **Step 3: Commit**

```bash
git add src/background/screenshot.ts src/content/content-script.ts src/offscreen/offscreen.ts
git commit -m "fix: replace silent error swallowing with console.error logging"
```

---

### Task 5: Remove Branding and GitHub References

**Files:**
- Modify: `src/settings/Settings.tsx:157-158`
- Modify: `src/welcome/Welcome.tsx` (hackathon text)
- Modify: `README.md` (GitHub links, clone instructions)
- Modify: `landing/index.html` (2 GitHub link occurrences)

- [ ] **Step 1: Update Settings.tsx**

Line 157-158: Replace `"ScreenSense Voice · Amazon Nova Hackathon 2026"` with `"ScreenSense Voice"`.

- [ ] **Step 2: Update Welcome.tsx**

Remove any "Amazon Nova Hackathon 2026" text. Keep the product name "ScreenSense".

- [ ] **Step 3: Update README.md**

- Remove lines 19-22 (GitHub link to `anirxdh/Nova-AWS`)
- Update lines 90-91 (clone instructions) — remove specific repo URL
- Update the services table at lines 32-39 to remove AWS Transcribe references
- Keep the rest of the documentation intact

- [ ] **Step 4: Update landing/index.html**

Remove all 3 occurrences of `https://github.com/anirxdh/Nova-AWS` (lines 1087, 1260, 1266). Replace with `#` or remove the link elements.

- [ ] **Step 5: Commit**

```bash
git add src/settings/Settings.tsx src/welcome/Welcome.tsx README.md landing/index.html
git commit -m "chore: remove hackathon branding and personal GitHub references"
```

---

### Task 6: Remove AWS Transcribe and Restructure STT

Delete backend STT (nova_sonic.py, transcribe.py). STT becomes frontend-direct via ElevenLabs with Groq fallback.

**Files:**
- Create: `src/background/transcription-service.ts`
- Create: `src/__tests__/transcription-service.test.ts`
- Delete: `backend/services/nova_sonic.py`
- Delete: `backend/routers/transcribe.py`
- Modify: `backend/main.py:11,28` (remove transcribe router import)
- Modify: `backend/.env.example` (remove AWS Transcribe comment)
- Modify: `src/background/api/backend-client.ts:10-159` (remove transcribe functions)

- [ ] **Step 1: Write the failing test for transcription-service**

```typescript
// src/__tests__/transcription-service.test.ts
import { transcribe } from '../background/transcription-service';

// Mock the STT modules
jest.mock('../background/api/elevenlabs-stt', () => ({
  transcribeAudio: jest.fn(),
}));
jest.mock('../background/api/groq-stt', () => ({
  transcribeAudio: jest.fn(),
}));

import { transcribeAudio as elevenLabsSTT } from '../background/api/elevenlabs-stt';
import { transcribeAudio as groqSTT } from '../background/api/groq-stt';

describe('transcription-service', () => {
  const mockAudioBase64 = 'SGVsbG8gV29ybGQ='; // base64 encoded test data

  beforeEach(() => jest.clearAllMocks());

  test('uses ElevenLabs as primary STT', async () => {
    (elevenLabsSTT as jest.Mock).mockResolvedValue('hello world');
    const result = await transcribe(mockAudioBase64, 'test-key', 'audio/webm');
    expect(result).toBe('hello world');
    expect(elevenLabsSTT).toHaveBeenCalledTimes(1);
    expect(groqSTT).not.toHaveBeenCalled();
  });

  test('falls back to Groq when ElevenLabs fails', async () => {
    (elevenLabsSTT as jest.Mock).mockRejectedValue(new Error('ElevenLabs down'));
    (groqSTT as jest.Mock).mockResolvedValue('hello world');
    const result = await transcribe(mockAudioBase64, 'test-key', 'audio/webm');
    expect(result).toBe('hello world');
    expect(groqSTT).toHaveBeenCalledTimes(1);
  });

  test('throws when both STT providers fail', async () => {
    (elevenLabsSTT as jest.Mock).mockRejectedValue(new Error('ElevenLabs down'));
    (groqSTT as jest.Mock).mockRejectedValue(new Error('Groq down'));
    await expect(transcribe(mockAudioBase64, 'test-key', 'audio/webm')).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/__tests__/transcription-service.test.ts --forceExit`
Expected: FAIL — module not found

- [ ] **Step 3: Write the transcription service**

```typescript
// src/background/transcription-service.ts
import { transcribeAudio as elevenLabsSTT } from './api/elevenlabs-stt';
import { transcribeAudio as groqSTT } from './api/groq-stt';

/**
 * Transcribe audio using ElevenLabs (primary) with Groq Whisper fallback.
 * Frontend-direct — no backend involvement.
 * Accepts base64-encoded audio (matching the existing STT function signatures).
 */
export async function transcribe(
  audioBase64: string,
  apiKey: string,
  mimeType: string,
  groqKey?: string,
): Promise<string> {
  try {
    return await elevenLabsSTT(audioBase64, apiKey, mimeType);
  } catch (err) {
    console.warn('[ScreenSense] ElevenLabs STT failed, trying Groq fallback:', err);
    if (!groqKey) throw new Error('ElevenLabs STT failed and no Groq key configured');
    return await groqSTT(audioBase64, groqKey, mimeType);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/__tests__/transcription-service.test.ts --forceExit`
Expected: PASS

- [ ] **Step 5: Delete backend STT files and update requirements.txt**

```bash
rm backend/services/nova_sonic.py
rm backend/routers/transcribe.py
rm -f backend/services/__pycache__/nova_sonic*.pyc
rm -f backend/routers/__pycache__/transcribe*.pyc
```

Also remove `amazon-transcribe>=0.6.0` from `backend/requirements.txt` (if it exists). Search for and remove any line referencing `amazon-transcribe` or `amazon_transcribe`.

- [ ] **Step 6: Update backend/main.py**

Remove line 11: `from backend.routers.transcribe import router`
Remove line 28: `app.include_router(router)`

- [ ] **Step 7: Remove transcribe functions from backend-client.ts**

Delete `transcribeAudio()` (lines 10-61) and `transcribeAudioStreaming()` (lines 73-159) from `src/background/api/backend-client.ts`. Keep `sendTask()`, `sendTaskContinue()`, `connectSSE()`, and `checkBackendHealth()`.

- [ ] **Step 8: Update backend/.env.example**

Remove the AWS Transcribe comment. Add ElevenLabs and Firecrawl keys:

```env
# AWS credentials — required for Nova Lite (Bedrock)
AWS_ACCESS_KEY_ID=your-aws-access-key
AWS_SECRET_ACCESS_KEY=your-aws-secret-key
AWS_REGION=us-east-1

# Groq API key — fallback STT
GROQ_API_KEY=your-groq-api-key

# Firecrawl API key — web content scraping
FIRECRAWL_API_KEY=your-firecrawl-api-key

# ElevenLabs API key — voice (STT + TTS)
ELEVENLABS_API_KEY=your-elevenlabs-api-key

# Server config
BACKEND_PORT=8000
```

- [ ] **Step 9: Run all tests**

Run: `npx jest --forceExit --detectOpenHandles`
Run: `cd backend && python -m pytest -v`
Expected: All pass (backend transcribe tests will fail — delete them too)

- [ ] **Step 10: Update existing frontend tests that will break**

`src/__tests__/backend-client.test.ts` imports `transcribeAudio` and `transcribeAudioStreaming` which were just deleted. Update this test file to remove those test cases. Keep tests for `sendTask`, `sendTaskContinue`, `checkBackendHealth`.

- [ ] **Step 11: Delete backend transcribe tests**

```bash
rm -f backend/tests/test_transcribe.py
rm -f backend/tests/test_transcribe_service.py
rm -f backend/tests/__pycache__/test_transcribe*.pyc
```

- [ ] **Step 12: Run backend tests again**

Run: `cd backend && python -m pytest -v`
Expected: All remaining tests pass

- [ ] **Step 13: Build extension**

Run: `npx webpack --mode development 2>&1 | head -20`
Expected: Builds successfully

- [ ] **Step 14: Commit**

```bash
git add -A
git commit -m "refactor: remove AWS Transcribe, make STT frontend-direct via ElevenLabs + Groq"
```

---

### Task 7: Break Apart service-worker.ts (1,075 LOC → 4 modules)

**Prerequisite:** Task 6 must be completed first. Task 6 removes transcribe functions from `backend-client.ts` and `service-worker.ts`, which shifts line numbers. All line references below assume Task 6 is done. Re-read the file before extracting to get current line numbers.

Split into offscreen-manager, agent-executor, message-router, plus thin orchestrator.

**Files:**
- Create: `src/background/offscreen-manager.ts`
- Create: `src/background/agent-executor.ts`
- Create: `src/background/message-router.ts`
- Modify: `src/background/service-worker.ts` (slim to ~150 LOC)

- [ ] **Step 1: Create offscreen-manager.ts**

Extract from service-worker.ts lines 49-95 (offscreen document lifecycle):

```typescript
// src/background/offscreen-manager.ts

let offscreenCreating: Promise<void> | null = null;

export async function ensureOffscreen(): Promise<void> {
  const existingContexts = await (chrome as any).runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT'],
  });
  if (existingContexts.length > 0) return;

  if (offscreenCreating) {
    await offscreenCreating;
    return;
  }

  offscreenCreating = chrome.offscreen.createDocument({
    url: 'offscreen.html',
    reasons: [chrome.offscreen.Reason.USER_MEDIA],
    justification: 'Microphone recording for voice commands',
  });

  await offscreenCreating;
  offscreenCreating = null;
}

export function sendToOffscreen(message: Record<string, unknown>): void {
  chrome.runtime.sendMessage(message).catch((err) =>
    console.error('[ScreenSense] offscreen message failed:', err)
  );
}
```

- [ ] **Step 2: Create agent-executor.ts**

Extract from service-worker.ts lines 264-550 (agent loop) and 177-262 (pipeline helpers):

```typescript
// src/background/agent-executor.ts
import { MAX_AGENT_ITERATIONS, BACKEND_TIMEOUT_MS } from '../shared/constants';
import { sendTask, sendTaskContinue, TaskResponse } from './api/backend-client';
import type { DomSnapshot, TaskStep } from '../shared/types';

export interface AgentContext {
  tabId: number;
  command: string;
  screenshot: string;
  domSnapshot: DomSnapshot;
  firecrawlMarkdown?: string;
  conversationHistory?: Array<{ role: string; content: string }>;
  onStep: (step: TaskStep) => void;
  onSpeak: (text: string) => void;
  onStageUpdate: (stage: string) => void;
  isCancelled: () => boolean;
}

export async function runAgentLoop(ctx: AgentContext): Promise<void> {
  // ... extracted agent loop logic from service-worker.ts lines 264-550
  // Each iteration: call Nova → get steps → execute actions → re-observe → repeat
}
```

The exact implementation is extracted directly from the existing `runAgentLoop()` function at lines 264-550, refactored to accept a context object instead of relying on closure variables.

- [ ] **Step 3: Create message-router.ts**

Extract from service-worker.ts lines 869-1075 (message handling):

```typescript
// src/background/message-router.ts
import type { MessageType } from '../shared/types';

type MessageHandler = (
  msg: MessageType,
  sender: chrome.runtime.MessageSender,
  sendResponse: (response?: unknown) => void,
) => boolean | void;

const handlers = new Map<string, MessageHandler>();

export function registerHandler(action: string, handler: MessageHandler): void {
  handlers.set(action, handler);
}

export function initMessageRouter(): void {
  chrome.runtime.onMessage.addListener(
    (msg: MessageType, sender, sendResponse) => {
      const handler = handlers.get(msg.action);
      if (handler) {
        return handler(msg, sender, sendResponse);
      }
      return false;
    },
  );
}
```

- [ ] **Step 4: Slim down service-worker.ts to orchestrator**

The remaining service-worker.ts wires modules together:

```typescript
// src/background/service-worker.ts (~150 LOC)
import { ensureOffscreen } from './offscreen-manager';
import { transcribe } from './transcription-service';
import { runAgentLoop } from './agent-executor';
import { registerHandler, initMessageRouter } from './message-router';
import { connectSSE } from './api/backend-client';

// State
let pipelineRunning = false;
let currentTabId: number | null = null;

// Register message handlers
registerHandler('shortcut-hold', handleShortcutHold);
registerHandler('shortcut-release', handleShortcutRelease);
registerHandler('offscreen-recording-complete', handleRecordingComplete);
// ... other handlers delegating to modules

// Initialize
initMessageRouter();
chrome.runtime.onInstalled.addListener(/* ... */);
```

- [ ] **Step 5: Update existing tests**

`src/__tests__/service-worker.test.ts` (if it exists) will break because imports have moved. Update test imports to point at the new modules (`agent-executor.ts`, `offscreen-manager.ts`, etc.). If tests mock the entire service-worker, simplify them to test individual modules instead.

- [ ] **Step 6: Build and test**

Run: `npx webpack --mode development 2>&1 | head -20`
Run: `npx jest --forceExit --detectOpenHandles`
Expected: Both pass

- [ ] **Step 7: Commit**

```bash
git add src/background/offscreen-manager.ts src/background/agent-executor.ts src/background/message-router.ts src/background/service-worker.ts
git commit -m "refactor: split service-worker.ts into focused modules (1075 LOC → 4 files)"
```

---

### Task 8: Break Apart cursor-bubble.ts (1,622 LOC → 3 modules)

Split into bubble-state-machine, waveform-renderer, chat-history, plus container.

**Files:**
- Create: `src/content/bubble-state-machine.ts`
- Create: `src/content/waveform-renderer.ts`
- Create: `src/content/chat-history.ts`
- Modify: `src/content/cursor-bubble.ts` (slim to ~250 LOC)

- [ ] **Step 1: Create bubble-state-machine.ts**

Extract state management logic from cursor-bubble.ts:

```typescript
// src/content/bubble-state-machine.ts

export enum BubbleDisplayState {
  Idle = 'idle',
  Listening = 'listening',
  Transcribing = 'transcribing',
  Understanding = 'understanding',
  Planning = 'planning',
  Executing = 'executing',
  Answering = 'answering',
  Error = 'error',
  Done = 'done',
}

export type StateChangeCallback = (
  newState: BubbleDisplayState,
  oldState: BubbleDisplayState,
) => void;

export class BubbleStateMachine {
  private state: BubbleDisplayState = BubbleDisplayState.Idle;
  private listeners: StateChangeCallback[] = [];

  getState(): BubbleDisplayState {
    return this.state;
  }

  transition(newState: BubbleDisplayState): void {
    const old = this.state;
    this.state = newState;
    for (const cb of this.listeners) cb(newState, old);
  }

  onChange(cb: StateChangeCallback): void {
    this.listeners.push(cb);
  }

  cleanup(): void {
    this.listeners = [];
  }
}
```

- [ ] **Step 2: Create waveform-renderer.ts**

Extract amplitude visualization from cursor-bubble.ts lines 810-836 and related canvas logic:

```typescript
// src/content/waveform-renderer.ts

const BAR_COUNT = 10;

export class WaveformRenderer {
  private container: HTMLElement;
  private bars: HTMLElement[] = [];

  constructor(container: HTMLElement) {
    this.container = container;
    this.createBars();
  }

  private createBars(): void {
    for (let i = 0; i < BAR_COUNT; i++) {
      const bar = document.createElement('div');
      bar.className = 'wave-bar';
      this.container.appendChild(bar);
      this.bars.push(bar);
    }
  }

  updateAmplitude(amplitude: number): void {
    const norm = Math.min(1, Math.max(0, amplitude));
    for (let i = 0; i < this.bars.length; i++) {
      const randomFactor = 0.5 + Math.random() * 0.5;
      const height = 4 + norm * 28 * randomFactor;
      this.bars[i].style.height = `${height}px`;
    }
  }

  reset(): void {
    for (const bar of this.bars) {
      bar.style.height = '4px';
    }
  }

  cleanup(): void {
    this.bars = [];
  }
}
```

- [ ] **Step 3: Create chat-history.ts**

Extract chat history management from cursor-bubble.ts lines 1022-1081 and rendering at 1202-1240:

```typescript
// src/content/chat-history.ts

export interface ChatEntry {
  role: 'user' | 'agent' | 'step' | 'thinking';
  content: string;
  timestamp: number;
}

export class ChatHistoryManager {
  private entries: ChatEntry[] = [];
  private container: HTMLElement | null = null;

  bind(container: HTMLElement): void {
    this.container = container;
  }

  addEntry(entry: ChatEntry): void {
    this.entries.push(entry);
    this.renderEntry(entry);
  }

  getEntries(): ChatEntry[] {
    return [...this.entries];
  }

  clear(): void {
    this.entries = [];
    if (this.container) this.container.innerHTML = '';
  }

  private renderEntry(entry: ChatEntry): void {
    if (!this.container) return;
    const el = document.createElement('div');
    el.className = `chat-entry chat-${entry.role}`;
    el.textContent = entry.content;
    this.container.appendChild(el);
    this.container.scrollTop = this.container.scrollHeight;
  }

  cleanup(): void {
    this.entries = [];
    this.container = null;
  }
}
```

- [ ] **Step 4: Refactor cursor-bubble.ts as container**

The slimmed cursor-bubble.ts composes the three modules:

```typescript
// cursor-bubble.ts (~250 LOC)
import { BubbleStateMachine, BubbleDisplayState } from './bubble-state-machine';
import { WaveformRenderer } from './waveform-renderer';
import { ChatHistoryManager } from './chat-history';

export class CursorBubble {
  private stateMachine: BubbleStateMachine;
  private waveform: WaveformRenderer;
  private chatHistory: ChatHistoryManager;
  // ... DOM elements, shadow root

  constructor() {
    this.stateMachine = new BubbleStateMachine();
    // ... create shadow DOM, compose modules
  }

  setState(state: BubbleDisplayState): void {
    this.stateMachine.transition(state);
    this.renderState(state);
  }

  updateAmplitude(amplitude: number): void {
    this.waveform.updateAmplitude(amplitude);
  }

  // ... remaining public API delegates to submodules
}
```

The inline CSS (~580 lines, lines 27-604) stays in cursor-bubble.ts as it's the container's responsibility. If desired, it can be moved to a separate `.css` file later.

- [ ] **Step 5: Build and test**

Run: `npx webpack --mode development 2>&1 | head -20`
Expected: Builds successfully

- [ ] **Step 6: Commit**

```bash
git add src/content/bubble-state-machine.ts src/content/waveform-renderer.ts src/content/chat-history.ts src/content/cursor-bubble.ts
git commit -m "refactor: split cursor-bubble.ts into focused modules (1622 LOC → 4 files)"
```

---

## Phase 2: Firecrawl Integration

### Task 9: Create Firecrawl Backend Service

**Files:**
- Create: `backend/services/firecrawl_service.py`
- Create: `backend/tests/test_firecrawl_service.py`
- Modify: `backend/requirements.txt` (or equivalent — add `firecrawl-py`)

- [ ] **Step 1: Install firecrawl-py and update requirements.txt**

```bash
cd backend && pip install firecrawl-py
```

Add `firecrawl-py` to `backend/requirements.txt` (confirmed to exist). Also add `pytest-asyncio` if not present (needed for async tests).

- [ ] **Step 2: Write the failing test**

```python
# backend/tests/test_firecrawl_service.py
import pytest
import asyncio
from unittest.mock import AsyncMock, patch, MagicMock
from backend.services.firecrawl_service import FirecrawlService

@pytest.fixture
def service():
    with patch.dict('os.environ', {'FIRECRAWL_API_KEY': 'fc-test-key'}):
        return FirecrawlService()

class TestFirecrawlService:
    @pytest.mark.asyncio
    async def test_scrape_returns_markdown(self, service):
        mock_result = MagicMock()
        mock_result.markdown = "# Test Page\nSome content"
        with patch.object(service.client, 'scrape_url', new_callable=AsyncMock, return_value=mock_result):
            result = await service.scrape("https://example.com")
            assert result == "# Test Page\nSome content"

    @pytest.mark.asyncio
    async def test_scrape_caches_results(self, service):
        mock_result = MagicMock()
        mock_result.markdown = "cached content"
        with patch.object(service.client, 'scrape_url', new_callable=AsyncMock, return_value=mock_result) as mock_scrape:
            await service.scrape("https://example.com")
            await service.scrape("https://example.com")
            assert mock_scrape.call_count == 1  # second call uses cache

    @pytest.mark.asyncio
    async def test_scrape_rejects_private_ips(self, service):
        with pytest.raises(ValueError, match="private"):
            await service.scrape("http://192.168.1.1/admin")

    @pytest.mark.asyncio
    async def test_scrape_rejects_localhost(self, service):
        with pytest.raises(ValueError, match="private"):
            await service.scrape("http://localhost:3000")
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd backend && python -m pytest tests/test_firecrawl_service.py -v`
Expected: FAIL — module not found

- [ ] **Step 4: Write the Firecrawl service**

```python
# backend/services/firecrawl_service.py
import os
import time
import ipaddress
from urllib.parse import urlparse
import asyncio
from firecrawl import FirecrawlApp  # Use sync client + asyncio.to_thread for FastAPI compat

CACHE_TTL_SECONDS = 300  # 5 minutes
BLOCKED_HOSTS = {'localhost', '127.0.0.1', '0.0.0.0', '::1'}


def _is_private_url(url: str) -> bool:
    """Reject private/internal URLs to prevent SSRF."""
    parsed = urlparse(url)
    hostname = parsed.hostname or ''

    if hostname in BLOCKED_HOSTS:
        return True

    try:
        ip = ipaddress.ip_address(hostname)
        return ip.is_private or ip.is_loopback or ip.is_link_local
    except ValueError:
        pass  # Not an IP, it's a domain name — allow

    return False


class FirecrawlService:
    def __init__(self):
        api_key = os.getenv('FIRECRAWL_API_KEY')
        if not api_key:
            raise ValueError("FIRECRAWL_API_KEY not set")
        self.client = FirecrawlApp(api_key=api_key)
        self._cache: dict[str, tuple[float, str]] = {}

    def _validate_url(self, url: str) -> None:
        if _is_private_url(url):
            raise ValueError(f"Rejected private/internal URL: {url}")

    def _get_cached(self, url: str) -> str | None:
        entry = self._cache.get(url)
        if entry and (time.time() - entry[0]) < CACHE_TTL_SECONDS:
            return entry[1]
        if entry:
            del self._cache[url]
        return None

    def _set_cached(self, url: str, content: str) -> None:
        self._cache[url] = (time.time(), content)

    def invalidate_cache(self, url: str) -> None:
        self._cache.pop(url, None)

    async def scrape(self, url: str) -> str:
        """Scrape a single URL and return clean markdown."""
        self._validate_url(url)
        cached = self._get_cached(url)
        if cached is not None:
            return cached

        result = await asyncio.to_thread(
            self.client.scrape_url,
            url,
            params={'formats': ['markdown'], 'onlyMainContent': True}
        )
        markdown = result.get('markdown', '') if isinstance(result, dict) else getattr(result, 'markdown', '')
        self._set_cached(url, markdown)
        return markdown

    async def extract(self, urls: list[str], prompt: str, schema: dict | None = None) -> dict:
        """Extract structured data from URLs."""
        for url in urls:
            self._validate_url(url)

        params = {'prompt': prompt}
        if schema:
            params['schema'] = schema

        result = await asyncio.to_thread(self.client.extract, urls, params=params)
        return result if isinstance(result, dict) else result.__dict__

    async def start_crawl(self, url: str, limit: int = 100) -> str:
        """Start an async crawl job. Returns job ID."""
        self._validate_url(url)
        job = await asyncio.to_thread(
            self.client.async_crawl_url, url, params={'limit': limit}
        )
        return job.get('id', '') if isinstance(job, dict) else getattr(job, 'id', '')

    async def get_crawl_status(self, job_id: str) -> dict:
        """Check crawl job status."""
        result = await asyncio.to_thread(self.client.check_crawl_status, job_id)
        return result if isinstance(result, dict) else result.__dict__


# Singleton
firecrawl_service: FirecrawlService | None = None

def get_firecrawl_service() -> FirecrawlService:
    global firecrawl_service
    if firecrawl_service is None:
        firecrawl_service = FirecrawlService()
    return firecrawl_service
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd backend && python -m pytest tests/test_firecrawl_service.py -v`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add backend/services/firecrawl_service.py backend/tests/test_firecrawl_service.py
git commit -m "feat: add Firecrawl service with scrape/extract/crawl + SSRF protection + caching"
```

---

### Task 10: Create Firecrawl Backend Router

**Files:**
- Create: `backend/routers/firecrawl.py`
- Modify: `backend/main.py` (register router)

- [ ] **Step 1: Write the router**

```python
# backend/routers/firecrawl.py
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from backend.services.firecrawl_service import get_firecrawl_service

router = APIRouter(prefix="/firecrawl", tags=["firecrawl"])


class ScrapeRequest(BaseModel):
    url: str


class ExtractRequest(BaseModel):
    urls: list[str]
    prompt: str
    schema_def: dict | None = None


class CrawlRequest(BaseModel):
    url: str
    limit: int = 100


@router.post("/scrape")
async def scrape_url(req: ScrapeRequest):
    try:
        service = get_firecrawl_service()
        markdown = await service.scrape(req.url)
        return {"success": True, "markdown": markdown}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Scrape failed: {str(e)}")


@router.post("/extract")
async def extract_data(req: ExtractRequest):
    try:
        service = get_firecrawl_service()
        result = await service.extract(req.urls, req.prompt, req.schema_def)
        return {"success": True, "data": result}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Extract failed: {str(e)}")


@router.post("/crawl")
async def start_crawl(req: CrawlRequest):
    try:
        service = get_firecrawl_service()
        job_id = await service.start_crawl(req.url, req.limit)
        return {"success": True, "job_id": job_id}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Crawl failed: {str(e)}")


@router.get("/crawl/{job_id}")
async def get_crawl_status(job_id: str):
    try:
        service = get_firecrawl_service()
        status = await service.get_crawl_status(job_id)
        return {"success": True, **status}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Status check failed: {str(e)}")
```

- [ ] **Step 2: Register router in main.py**

Add to `backend/main.py`:
```python
from backend.routers.firecrawl import router as firecrawl_router
# ...
app.include_router(firecrawl_router)
```

- [ ] **Step 3: Verify backend starts**

Run: `cd backend && python -m uvicorn backend.main:app --port 8000 &`
Then: `curl http://localhost:8000/health`
Expected: `{"status": "ok"}`
Kill the server after verification.

- [ ] **Step 4: Commit**

```bash
git add backend/routers/firecrawl.py backend/main.py
git commit -m "feat: add Firecrawl REST endpoints (scrape/extract/crawl)"
```

---

### Task 11: Add Firecrawl Client to Extension

**Files:**
- Modify: `src/background/api/backend-client.ts` (add Firecrawl methods)

- [ ] **Step 1: Add Firecrawl methods to backend-client.ts**

Add to the existing file:

```typescript
// Add to backend-client.ts

export async function scrapeUrl(url: string): Promise<string> {
  const resp = await fetch(`${BACKEND_URL}/firecrawl/scrape`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url }),
  });
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({ detail: resp.statusText }));
    throw new Error(`Scrape failed: ${err.detail}`);
  }
  const data = await resp.json();
  return data.markdown;
}

export async function extractData(
  urls: string[],
  prompt: string,
  schema?: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const resp = await fetch(`${BACKEND_URL}/firecrawl/extract`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ urls, prompt, schema_def: schema }),
  });
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({ detail: resp.statusText }));
    throw new Error(`Extract failed: ${err.detail}`);
  }
  const data = await resp.json();
  return data.data;
}
```

- [ ] **Step 2: Build to verify**

Run: `npx webpack --mode development 2>&1 | head -20`
Expected: Builds successfully

- [ ] **Step 3: Commit**

```bash
git add src/background/api/backend-client.ts
git commit -m "feat: add Firecrawl client methods to backend-client"
```

---

### Task 12: Wire Firecrawl Into Nova Reasoning

**Files:**
- Modify: `backend/routers/task.py` (accept firecrawl_markdown + conversation_history)
- Modify: `backend/services/nova_reasoning.py` (use Firecrawl markdown in prompts)

- [ ] **Step 1: Update TaskRequest model in task.py**

Add new fields to `TaskRequest` at line 9-20:

```python
class TaskRequest(BaseModel):
    command: str
    screenshot: str = Field(max_length=15_000_000)
    dom_snapshot: dict
    firecrawl_markdown: str | None = None         # NEW
    conversation_history: list[dict] | None = None # NEW
```

Also update `TaskContinueRequest`:

```python
class TaskContinueRequest(BaseModel):
    original_command: str
    action_history: list[dict]
    screenshot: str = Field(max_length=15_000_000)
    dom_snapshot: dict
    firecrawl_markdown: str | None = None         # NEW
    conversation_history: list[dict] | None = None # NEW
```

- [ ] **Step 2: Pass new fields through to Nova reasoning**

In the `/task` endpoint handler, pass `firecrawl_markdown` and `conversation_history` to `reason_about_page()`. In `/task/continue`, pass them to `reason_continue()`.

- [ ] **Step 3: Update nova_reasoning.py to accept and use Firecrawl markdown**

Update `reason_about_page()` signature to accept `firecrawl_markdown: str | None = None` and `conversation_history: list[dict] | None = None`.

Modify the content array sent to Nova. Insert conversation history as a preamble and Firecrawl markdown as a separate content block:

```python
# In reason_about_page(), before the content array:
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
```

Add these to the system prompt or user content sent to Nova.

- [ ] **Step 4: Update the system prompt to support conversational responses**

Add to the `SYSTEM_PROMPT` in nova_reasoning.py:

```python
# Append to existing SYSTEM_PROMPT:
CONVERSATIONAL_ADDENDUM = """
You are in an ongoing conversation with the user.

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
```

- [ ] **Step 5: Run backend tests**

Run: `cd backend && python -m pytest -v`
Expected: All pass

- [ ] **Step 6: Commit**

```bash
git add backend/routers/task.py backend/services/nova_reasoning.py
git commit -m "feat: wire Firecrawl markdown + conversation history into Nova reasoning"
```

---

## Phase 3: Conversation Manager

### Task 13: Create Conversation Manager

**Files:**
- Create: `src/background/conversation-manager.ts`
- Create: `src/__tests__/conversation-manager.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// src/__tests__/conversation-manager.test.ts
import { ConversationManager, ConversationState } from '../background/conversation-manager';

describe('ConversationManager', () => {
  let cm: ConversationManager;

  beforeEach(() => {
    cm = new ConversationManager();
  });

  test('starts in idle state', () => {
    expect(cm.getState()).toBe(ConversationState.Idle);
  });

  test('transitions from idle to listening', () => {
    cm.transition(ConversationState.Listening);
    expect(cm.getState()).toBe(ConversationState.Listening);
  });

  test('records user turn', () => {
    cm.startSession(1);
    cm.addTurn('user', 'hello');
    expect(cm.getHistory(1)).toHaveLength(1);
    expect(cm.getHistory(1)[0].role).toBe('user');
  });

  test('records agent turn', () => {
    cm.startSession(1);
    cm.addTurn('agent', 'how can I help?');
    const history = cm.getHistory(1);
    expect(history).toHaveLength(1);
    expect(history[0].content).toBe('how can I help?');
  });

  test('caps history at 20 turns', () => {
    cm.startSession(1);
    for (let i = 0; i < 25; i++) {
      cm.addTurn('user', `message ${i}`);
    }
    expect(cm.getHistory(1).length).toBeLessThanOrEqual(20);
  });

  test('clears session', () => {
    cm.startSession(1);
    cm.addTurn('user', 'hello');
    cm.clearSession(1);
    expect(cm.getHistory(1)).toHaveLength(0);
  });

  test('idle timeout after inactivity', () => {
    jest.useFakeTimers();
    cm.startSession(1);
    cm.transition(ConversationState.Listening);
    cm.resetIdleTimer();
    jest.advanceTimersByTime(31000);
    expect(cm.getState()).toBe(ConversationState.Idle);
    jest.useRealTimers();
  });

  test('getTextOnlyHistory strips context', () => {
    cm.startSession(1);
    cm.addTurn('user', 'hello');
    cm.addTurn('agent', 'hi there');
    const textOnly = cm.getTextOnlyHistory(1);
    expect(textOnly).toEqual([
      { role: 'user', content: 'hello' },
      { role: 'agent', content: 'hi there' },
    ]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/__tests__/conversation-manager.test.ts --forceExit`
Expected: FAIL — module not found

- [ ] **Step 3: Write the Conversation Manager**

```typescript
// src/background/conversation-manager.ts
import { MAX_CONVERSATION_TURNS } from '../shared/constants';

export enum ConversationState {
  Idle = 'idle',
  Listening = 'listening',
  Processing = 'processing',
  Speaking = 'speaking',
  AwaitingReply = 'awaiting_reply',
  Executing = 'executing',
}

export interface ConversationTurn {
  role: 'user' | 'agent';
  content: string;
  timestamp: number;
}

const IDLE_TIMEOUT_MS = 30_000;

export class ConversationManager {
  private state: ConversationState = ConversationState.Idle;
  private sessions = new Map<number, ConversationTurn[]>();
  private activeTabId: number | null = null;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private onIdleCallback: (() => void) | null = null;

  getState(): ConversationState {
    return this.state;
  }

  transition(newState: ConversationState): void {
    this.state = newState;
    if (newState !== ConversationState.Idle) {
      this.resetIdleTimer();
    }
  }

  onIdle(cb: () => void): void {
    this.onIdleCallback = cb;
  }

  startSession(tabId: number): void {
    this.activeTabId = tabId;
    if (!this.sessions.has(tabId)) {
      this.sessions.set(tabId, []);
    }
  }

  clearSession(tabId: number): void {
    this.sessions.delete(tabId);
    if (this.activeTabId === tabId) {
      this.activeTabId = null;
      this.state = ConversationState.Idle;
    }
  }

  addTurn(role: 'user' | 'agent', content: string): void {
    if (this.activeTabId === null) return;
    const turns = this.sessions.get(this.activeTabId) ?? [];
    turns.push({ role, content, timestamp: Date.now() });

    // Cap at MAX_CONVERSATION_TURNS
    if (turns.length > MAX_CONVERSATION_TURNS) {
      // Keep the most recent turns
      const excess = turns.length - MAX_CONVERSATION_TURNS;
      turns.splice(0, excess);
    }

    this.sessions.set(this.activeTabId, turns);
  }

  getHistory(tabId: number): ConversationTurn[] {
    return this.sessions.get(tabId) ?? [];
  }

  getTextOnlyHistory(tabId: number): Array<{ role: string; content: string }> {
    return this.getHistory(tabId).map(({ role, content }) => ({ role, content }));
  }

  resetIdleTimer(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => {
      this.state = ConversationState.Idle;
      this.onIdleCallback?.();
    }, IDLE_TIMEOUT_MS);
  }

  clearIdleTimer(): void {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
  }

  isInConversation(): boolean {
    return this.state !== ConversationState.Idle;
  }

  getActiveTabId(): number | null {
    return this.activeTabId;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/__tests__/conversation-manager.test.ts --forceExit`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/background/conversation-manager.ts src/__tests__/conversation-manager.test.ts
git commit -m "feat: add ConversationManager with state machine, history, and idle timeout"
```

---

### Task 14: Wire Conversation Manager Into Agent Pipeline

**Files:**
- Modify: `src/background/service-worker.ts` (use ConversationManager)
- Modify: `src/background/agent-executor.ts` (accept + pass conversation history)
- Modify: `src/background/api/backend-client.ts` (send conversation history + Firecrawl in sendTask)

- [ ] **Step 1: Update backend-client.ts sendTask to include conversation fields**

Add `firecrawlMarkdown` and `conversationHistory` to `sendTask()`:

```typescript
export async function sendTask(
  command: string,
  screenshot: string,
  domSnapshot: object,
  firecrawlMarkdown?: string,
  conversationHistory?: Array<{ role: string; content: string }>,
): Promise<TaskResponse> {
  const body: Record<string, unknown> = {
    command,
    screenshot,
    dom_snapshot: domSnapshot,
  };
  if (firecrawlMarkdown) body.firecrawl_markdown = firecrawlMarkdown;
  if (conversationHistory?.length) body.conversation_history = conversationHistory;

  const resp = await fetch(`${BACKEND_URL}/task`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  // ... existing error handling
}
```

Similarly update `sendTaskContinue()`.

- [ ] **Step 2: Integrate ConversationManager in service-worker.ts**

Import and instantiate at the top:
```typescript
import { ConversationManager, ConversationState } from './conversation-manager';
const conversation = new ConversationManager();
```

In the pipeline flow:
1. On shortcut-hold → `conversation.startSession(tabId)`, `conversation.transition(ConversationState.Listening)`
2. After transcription → `conversation.addTurn('user', transcript)`
3. Before calling agent → get `conversation.getTextOnlyHistory(tabId)` and pass to `sendTask()`
4. Before calling agent → call `scrapeUrl(currentUrl)` to get Firecrawl markdown, pass to `sendTask()`
5. After agent responds with speech → `conversation.addTurn('agent', spokenText)`
6. If agent needs clarification → `conversation.transition(ConversationState.AwaitingReply)`

- [ ] **Step 3: Update agent-executor.ts to pass Firecrawl + history**

The `AgentContext` interface (from Task 7) already includes `firecrawlMarkdown` and `conversationHistory`. Wire these through in the agent loop's calls to `sendTask()` and `sendTaskContinue()`.

- [ ] **Step 4: Build and test**

Run: `npx webpack --mode development 2>&1 | head -20`
Run: `npx jest --forceExit --detectOpenHandles`
Expected: Both pass

- [ ] **Step 5: Commit**

```bash
git add src/background/service-worker.ts src/background/agent-executor.ts src/background/api/backend-client.ts
git commit -m "feat: wire ConversationManager + Firecrawl into agent pipeline"
```

---

### Task 15: Handle Agent Response Types for Conversation

Process the new response types (clarification, options, suggestions) from Nova.

**Files:**
- Modify: `src/background/agent-executor.ts` (handle new response types)
- Modify: `src/background/service-worker.ts` (route responses to TTS + state changes)
- Modify: `src/content/content-script.ts` (handle new bubble states)

- [ ] **Step 1: Update agent-executor.ts to detect conversational responses**

After receiving a Nova response, check for conversational actions:

```typescript
// In the agent loop, after receiving response from Nova:
function classifyResponse(response: TaskResponse): 'action' | 'speak' | 'clarify' | 'options' | 'suggest' | 'done' {
  if (response.needs_clarification) return 'clarify';
  if (response.options?.length) return 'options';
  if (response.suggestion && response.requires_confirmation) return 'suggest';
  if (response.speak && !response.steps?.length) return 'speak';
  if (response.done) return 'done';
  return 'action';
}
```

For `clarify`, `options`, `suggest` types:
- Call `ctx.onSpeak(text)` to trigger TTS
- Signal to conversation manager to enter `AwaitingReply` state
- Break the agent loop (wait for user's voice reply)

- [ ] **Step 2: Update service-worker.ts to handle awaiting_reply state**

When the agent returns a clarification/options/suggestion:
1. TTS speaks the question
2. Conversation transitions to `AwaitingReply`
3. After TTS finishes → auto-open mic (handled in Phase 4)
4. When user responds → resume agent loop with the reply as new input

- [ ] **Step 3: Update content-script.ts for new message types**

Add handlers for:
- `bubble-awaiting-reply` → show bubble in "waiting for response" state
- `bubble-options` → display options in bubble UI

- [ ] **Step 4: Build and test**

Run: `npx webpack --mode development 2>&1 | head -20`
Expected: Builds successfully

- [ ] **Step 5: Commit**

```bash
git add src/background/agent-executor.ts src/background/service-worker.ts src/content/content-script.ts
git commit -m "feat: handle conversational response types (clarify/options/suggest/research)"
```

---

### Task 15b: Intent Classification for User Utterances

When the user speaks during an active conversation, classify whether it's a new task, reply, follow-up, correction, or interruption.

**Files:**
- Modify: `src/background/conversation-manager.ts` (add intent routing)
- Modify: `src/background/agent-executor.ts` (handle classified intents)
- Modify: `backend/services/nova_reasoning.py` (add intent classification to prompt)

- [ ] **Step 1: Update Nova prompt to classify intent**

In `nova_reasoning.py`, when conversation history is present, add to the system prompt:

```python
INTENT_CLASSIFICATION = """
When the user has an ongoing conversation, first classify their intent:
- "new_task": Starting a completely new request unrelated to current conversation
- "reply": Directly answering a question you asked
- "follow_up": Asking about something related to the current conversation
- "correction": Correcting a misunderstanding ("no, I meant...")
- "interruption": Asking to stop or cancel ("stop", "cancel", "never mind")

Include your classification in the response as: {"intent": "<type>", ...rest of response}
"""
```

- [ ] **Step 2: Handle intent in conversation-manager.ts**

Add intent routing method:

```typescript
export function routeByIntent(
  intent: string,
  tabId: number,
  cm: ConversationManager,
): 'new_session' | 'continue' | 'cancel' {
  switch (intent) {
    case 'new_task':
      cm.clearSession(tabId);
      cm.startSession(tabId);
      return 'new_session';
    case 'interruption':
      cm.transition(ConversationState.Idle);
      return 'cancel';
    case 'reply':
    case 'follow_up':
    case 'correction':
    default:
      return 'continue';
  }
}
```

- [ ] **Step 3: Wire into agent-executor.ts**

After receiving Nova's response, check for `intent` field. If `new_task`, restart the agent loop. If `interruption`, cancel and speak confirmation.

- [ ] **Step 4: Build and test**

Run: `npx webpack --mode development 2>&1 | head -20`
Expected: Builds successfully

- [ ] **Step 5: Commit**

```bash
git add src/background/conversation-manager.ts src/background/agent-executor.ts backend/services/nova_reasoning.py
git commit -m "feat: add intent classification for multi-turn conversation routing"
```

---

## Phase 4: ElevenLabs Voice Flow

### Task 16: TTS Interruption Support

Allow user to interrupt TTS by pressing the shortcut key.

**Files:**
- Modify: `src/content/tts.ts` (add stop-on-interrupt)
- Modify: `src/content/content-script.ts` (handle interrupt during speaking)
- Modify: `src/background/service-worker.ts` (shortcut during speaking state)

- [ ] **Step 1: Add interrupt support to tts.ts**

The existing `tts.ts` already has `stop()` and `isSpeaking()`. Add an event that fires when TTS is interrupted:

```typescript
// Add to tts.ts
let onInterruptCallback: (() => void) | null = null;

export function onInterrupt(cb: () => void): void {
  onInterruptCallback = cb;
}

export function interrupt(): void {
  if (isSpeaking()) {
    stop();
    onInterruptCallback?.();
  }
}
```

- [ ] **Step 2: Handle shortcut press during speaking state**

In service-worker.ts, when shortcut-hold is received while conversation state is `Speaking`:
1. Send `interrupt-tts` message to content script
2. Content script calls `interrupt()` on tts module
3. Transition conversation to `Listening`
4. Start recording

- [ ] **Step 3: Build and test**

Run: `npx webpack --mode development 2>&1 | head -20`
Expected: Builds successfully

- [ ] **Step 4: Commit**

```bash
git add src/content/tts.ts src/content/content-script.ts src/background/service-worker.ts
git commit -m "feat: add TTS interruption via shortcut key"
```

---

### Task 17: Auto-Reopen Mic for Conversational Replies

When agent asks a question (AwaitingReply state), auto-open mic after TTS finishes.

**Files:**
- Modify: `src/background/service-worker.ts` (auto-open mic logic)
- Modify: `src/background/offscreen-manager.ts` (start recording on signal)
- Modify: `src/content/content-script.ts` (show "listening for reply" UI)

- [ ] **Step 1: Add auto-reopen mic flow**

In service-worker.ts, after TTS finishes speaking a question:

```typescript
// When agent asks a clarification question:
// 1. TTS speaks the question
// 2. Wait for TTS to finish (message from content script)
// 3. Wait 500ms
// 4. Send audio cue to content script (optional beep)
// 5. Start recording (same as shortcut-hold flow)
// 6. Set a 10-second timeout for the recording

async function autoReopenMic(tabId: number): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, 500));
  // Send bubble state update to show "listening for reply"
  sendToTab(tabId, { action: 'bubble-state', state: 'listening' });
  // Start recording via offscreen
  await ensureOffscreen();
  sendToOffscreen({ action: 'start-recording' });
  // Auto-stop after 10 seconds if no shortcut release
  setTimeout(() => {
    sendToOffscreen({ action: 'stop-recording' });
  }, 10_000);
}
```

- [ ] **Step 2: Add silence detection (basic amplitude threshold)**

In offscreen.ts, add a silence detection mechanism:

```typescript
// Track consecutive low-amplitude samples
let silentSamples = 0;
const SILENCE_THRESHOLD = 0.02;
const SILENCE_DURATION_SAMPLES = 30; // ~1.5s at 50ms polling

// In the amplitude polling interval:
if (amplitude < SILENCE_THRESHOLD) {
  silentSamples++;
  if (silentSamples >= SILENCE_DURATION_SAMPLES) {
    // Auto-stop recording due to silence
    stopRecording();
  }
} else {
  silentSamples = 0;
}
```

- [ ] **Step 3: Wire TTS-finished signal**

Content script sends `tts-playback-finished` message when TTS audio ends. Service worker receives this and calls `autoReopenMic()` if conversation state is `AwaitingReply`.

- [ ] **Step 4: Build and test**

Run: `npx webpack --mode development 2>&1 | head -20`
Expected: Builds successfully

- [ ] **Step 5: Commit**

```bash
git add src/background/service-worker.ts src/background/offscreen-manager.ts src/content/content-script.ts src/offscreen/offscreen.ts
git commit -m "feat: auto-reopen mic when agent asks questions + silence detection"
```

---

### Task 18: Make Voice Settings Configurable

Move ElevenLabs voice ID and model out of hardcoded constants into user settings.

**Files:**
- Modify: `src/shared/types.ts` (add voice settings to ExtensionSettings)
- Modify: `src/shared/constants.ts` (defaults)
- Modify: `src/shared/storage.ts` (persist voice settings)
- Modify: `src/content/tts.ts` (read from settings)
- Modify: `src/settings/Settings.tsx` (add voice config UI)

- [ ] **Step 1: Add voice settings to types**

```typescript
// Add to ExtensionSettings in types.ts
export interface ExtensionSettings {
  // ... existing fields
  voiceId: string;
  ttsModel: string;
}
```

- [ ] **Step 2: Update DEFAULT_SETTINGS in constants.ts**

```typescript
export const DEFAULT_SETTINGS: ExtensionSettings = {
  // ... existing
  voiceId: DEFAULT_VOICE_ID,
  ttsModel: DEFAULT_TTS_MODEL,
};
```

- [ ] **Step 3: Update tts.ts to use settings**

Replace hardcoded constants with dynamic settings lookup:

```typescript
import { getSettings } from '../shared/storage';
import { DEFAULT_VOICE_ID, DEFAULT_TTS_MODEL } from '../shared/constants';

async function getVoiceConfig(): Promise<{ voiceId: string; model: string }> {
  const settings = await getSettings();
  return {
    voiceId: settings.voiceId || DEFAULT_VOICE_ID,
    model: settings.ttsModel || DEFAULT_TTS_MODEL,
  };
}
```

- [ ] **Step 4: Add voice settings inputs to Settings.tsx**

Add two text inputs:
- Voice ID (with label explaining where to find it on ElevenLabs)
- TTS Model (dropdown with `eleven_flash_v2_5` and `eleven_multilingual_v2`)

- [ ] **Step 5: Build and test**

Run: `npx webpack --mode development 2>&1 | head -20`
Expected: Builds successfully

- [ ] **Step 6: Commit**

```bash
git add src/shared/types.ts src/shared/constants.ts src/shared/storage.ts src/content/tts.ts src/settings/Settings.tsx
git commit -m "feat: make ElevenLabs voice ID and model configurable in settings"
```

---

## Final Verification

### Task 19: End-to-End Verification

- [ ] **Step 1: Run all frontend tests**

Run: `npx jest --forceExit --detectOpenHandles`
Expected: All pass

- [ ] **Step 2: Run all backend tests**

Run: `cd backend && python -m pytest -v`
Expected: All pass

- [ ] **Step 3: Build extension**

Run: `npx webpack --mode production`
Expected: Builds with no errors

- [ ] **Step 4: Verify no file exceeds ~300 LOC**

```bash
find src -name '*.ts' -o -name '*.tsx' | xargs wc -l | sort -rn | head -20
```
Expected: No file over ~300 LOC (except cursor-bubble.ts with inline CSS, which is acceptable)

- [ ] **Step 5: Verify no `any` casts remain**

```bash
grep -rn 'as any' src/ --include='*.ts' --include='*.tsx' | grep -v node_modules | grep -v __tests__
```
Expected: Zero or near-zero results

- [ ] **Step 6: Verify no silent catches remain**

```bash
grep -rn 'catch.*().*{}' src/ --include='*.ts' --include='*.tsx' | grep -v node_modules | grep -v __tests__
```
Expected: Zero results

- [ ] **Step 7: Final commit**

```bash
git add -A
git commit -m "chore: final cleanup and verification"
```
