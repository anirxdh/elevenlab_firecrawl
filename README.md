<p align="center">
  <img src="public/icons/icon-128.png" alt="ScreenSense Voice" width="80" />
</p>

<h1 align="center">ScreenSense Voice</h1>

<p align="center">
  <strong>Your voice controls the browser. Nova AI executes.</strong><br/>
  An autonomous AI browser agent powered by Amazon Nova that sees your screen, understands context, and takes action — all by voice.
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Amazon%20Nova-Lite%20v1-FF9900?style=flat-square&logo=amazon-aws" alt="Nova" />
  <img src="https://img.shields.io/badge/ElevenLabs-TTS%20%2B%20STT-5B21B6?style=flat-square" alt="ElevenLabs" />
  <img src="https://img.shields.io/badge/Firecrawl-Web%20Scraping-FF6B35?style=flat-square" alt="Firecrawl" />
  <img src="https://img.shields.io/badge/Chrome-MV3-4285F4?style=flat-square&logo=google-chrome" alt="Chrome" />
  <img src="https://img.shields.io/badge/License-MIT-green?style=flat-square" alt="MIT" />
</p>

<p align="center">
  <a href="https://youtu.be/szfykWVgEYM"><strong>Demo Video</strong></a> &middot;
  <a href="https://screen-sense-nova-anirxdh.netlify.app/"><strong>Landing Page</strong></a> &middot;
  <a href="TESTING.md"><strong>Testing Guide</strong></a>
</p>

---

## What is ScreenSense Voice?

ScreenSense Voice is a Chrome extension that turns your voice into browser actions. Hold a key, speak a command, and an AI agent powered by **Amazon Nova 2 Lite** sees your screen, reasons about what to do, and executes actions autonomously — clicking buttons, filling forms, navigating sites, and completing multi-step tasks.

**Example:** *"Add the cheapest USB-C cable to my cart on Amazon"* — ScreenSense will navigate to Amazon, search, find the cheapest option, click it, and add it to your cart. All hands-free.

### Key Integrations

| Service | Purpose |
|---------|---------|
| **Amazon Nova 2 Lite** (Bedrock) | Multimodal reasoning — analyzes screenshots + DOM to decide actions |
| **ElevenLabs** | Speech-to-text (primary) and natural voice readback (TTS) |
| **Firecrawl** | Web content extraction — converts pages to clean markdown for richer AI context |
| **Groq Whisper** | Fallback speech-to-text when ElevenLabs is unavailable |
| **AWS Transcribe** | Optional streaming speech-to-text via WebSocket |

---

## Architecture

```
User holds ` key + speaks
        |
        v
[ Content Scripts ]  ──  Shortcut Handler, Cursor Bubble (Shadow DOM),
        |                  DOM Scraper, Action Executor, TTS Engine
        |
        v  (chrome.runtime messages)
[ Service Worker ]   ──  Pipeline Manager, Agent Loop (max 25 iterations),
        |                  Conversation Manager (per-tab), Screenshot Capture
        |
        v  (HTTP / WebSocket)
[ FastAPI Backend ]  ──  POST /task, POST /task/continue, POST /transcribe,
        |                  GET /events (SSE), Firecrawl scrape/extract/crawl
        |
        v  (AWS SDK / REST APIs)
[ Cloud APIs ]       ──  AWS Bedrock (Nova Lite), AWS Transcribe,
                          Groq Whisper, ElevenLabs, Firecrawl
```

### How the Agent Loop Works

1. User holds backtick key and speaks a command
2. Audio is recorded via an offscreen document (MV3 sandbox)
3. Transcription happens via ElevenLabs STT (frontend-direct for low latency)
4. Service worker captures a screenshot + scrapes the DOM structure
5. Firecrawl extracts clean markdown from the page (augments DOM context)
6. Backend sends command + screenshot + DOM + markdown to Nova for reasoning
7. Nova returns an action (click, type, navigate, scroll, extract) with a TTS phrase
8. Content script executes the action and speaks the phrase via ElevenLabs TTS
9. Service worker re-captures screenshot + re-scrapes DOM
10. Backend re-evaluates with Nova — loops until task is complete (max 25 iterations)

### Conversation Flow

The system supports multi-turn conversations with intent classification:

- **New task**: Fresh command unrelated to prior conversation
- **Follow-up**: Related question about current context
- **Reply**: Answering a clarification question from the AI
- **Correction**: Fixing a misunderstanding
- **Interruption**: Canceling current action

Each tab maintains its own conversation history with a 30-second idle timeout.

---

## Features

- **Voice-to-Action**: Hold a key, speak, release — AI handles the rest
- **Multimodal Reasoning**: Nova sees screenshots AND reads DOM structure for precise actions
- **Autonomous Agent Loop**: Re-captures screen after each action, reasons about next step (up to 25 iterations)
- **Smart DOM Scraping**: Extracts structured selectors for buttons, links, inputs, forms, products
- **Firecrawl Integration**: Enriches AI context with clean page markdown beyond raw DOM
- **Cross-Site Navigation**: Can navigate between websites to complete tasks
- **Natural TTS**: ElevenLabs voice readback with browser speech fallback
- **Multi-Turn Conversations**: Context-aware follow-ups and corrections
- **Explanation Levels**: Kid, Student, College, PhD, Executive — adjusts AI response depth
- **Dark/Light Theme**: Full theme support across all pages
- **414 Tests**: Comprehensive test coverage across frontend and backend

---

## Getting Started

### Prerequisites

- **Node.js** 18+ and npm
- **Python** 3.10+
- **Google Chrome** (latest)
- **AWS Account** with Bedrock access (Nova Lite model enabled in us-east-1)

### 1. Clone & Install

```bash
git clone https://github.com/anirxdh/elevenlab_firecrawl.git
cd elevenlab_firecrawl

# Frontend
npm install

# Backend
cd backend
pip install -r requirements.txt
```

### 2. Configure API Keys

Create `backend/.env` from the example:

```bash
cp backend/.env.example backend/.env
```

Edit `backend/.env` with your keys:

```env
# Required — AWS credentials for Nova Lite (Bedrock)
AWS_ACCESS_KEY_ID=your-aws-access-key
AWS_SECRET_ACCESS_KEY=your-aws-secret-key
AWS_REGION=us-east-1

# Required — Groq API key (fallback STT)
GROQ_API_KEY=your-groq-api-key

# Optional — Firecrawl for enhanced page context
FIRECRAWL_API_KEY=your-firecrawl-api-key

# Optional — ElevenLabs for natural voice
ELEVENLABS_API_KEY=your-elevenlabs-api-key

# Server config
BACKEND_PORT=8000
```

**Where to get keys:**

| Key | Source | Required |
|-----|--------|----------|
| AWS Access Key / Secret | [IAM Console](https://console.aws.amazon.com/iam/) — create user with `AmazonBedrockFullAccess` | Yes |
| Groq API Key | [console.groq.com/keys](https://console.groq.com/keys) — free tier available | Yes |
| Firecrawl API Key | [firecrawl.dev](https://firecrawl.dev) — free tier available | Optional |
| ElevenLabs API Key | [elevenlabs.io](https://elevenlabs.io) — free tier available | Optional |

> **Important:** Enable Amazon Nova Lite model access in your [AWS Bedrock console](https://console.aws.amazon.com/bedrock/) (us-east-1 region).

### 3. Start the Backend

```bash
cd backend
python -m backend.main
```

Verify at `http://localhost:8000/health` — should return `{"status": "ok"}`.

### 4. Build & Load the Extension

```bash
# From project root
npm run build
```

1. Open `chrome://extensions/`
2. Enable **Developer mode** (top-right toggle)
3. Click **Load unpacked** → select the `dist/` folder
4. Complete the Welcome onboarding (grant microphone access)

### 5. Use It

1. Navigate to any website
2. **Hold the backtick key (`` ` ``)** and speak your command
3. **Release** — watch the AI reason and act

---

## Project Structure

```
elevenlab_firecrawl/
├── src/
│   ├── background/              # Service worker (orchestration)
│   │   ├── service-worker.ts    # Pipeline: record → transcribe → reason → execute
│   │   ├── agent-executor.ts    # Agent loop (max 25 iterations)
│   │   ├── conversation-manager.ts  # Per-tab state machine
│   │   ├── transcription-service.ts # ElevenLabs + Groq STT
│   │   ├── screenshot.ts        # Page capture
│   │   ├── offscreen-manager.ts # MV3 mic recording sandbox
│   │   ├── message-router.ts    # Chrome runtime message dispatch
│   │   └── api/
│   │       ├── backend-client.ts    # HTTP client to FastAPI
│   │       ├── elevenlabs-stt.ts    # ElevenLabs transcription
│   │       ├── groq-stt.ts          # Groq Whisper fallback
│   │       └── groq-vision.ts       # Groq Vision (future)
│   ├── content/                 # Content scripts (injected into pages)
│   │   ├── content-script.ts    # Entry point
│   │   ├── cursor-bubble.ts     # Floating UI (Shadow DOM, 1700+ lines)
│   │   ├── dom-scraper.ts       # Structured page snapshot with CSS selectors
│   │   ├── action-executor.ts   # DOM manipulation (click/type/navigate/scroll)
│   │   ├── shortcut-handler.ts  # Backtick hold/release detection
│   │   ├── tts.ts               # ElevenLabs + Web Speech API
│   │   ├── audio-recorder.ts    # Recording via offscreen document
│   │   ├── chat-history.ts      # Conversation display
│   │   ├── bubble-state-machine.ts  # UI state transitions
│   │   ├── waveform-renderer.ts # Real-time audio waveform
│   │   └── markdown.ts          # Markdown rendering
│   ├── offscreen/               # MV3 sandbox for microphone
│   ├── popup/                   # Extension popup UI (React)
│   ├── settings/                # Settings page (shortcut, display, voice)
│   ├── welcome/                 # Onboarding flow (3 steps)
│   ├── shared/                  # Types, storage, constants
│   └── __tests__/               # Frontend test suite (244 tests)
├── backend/
│   ├── main.py                  # FastAPI app with CORS
│   ├── routers/
│   │   ├── task.py              # POST /task, POST /task/continue
│   │   ├── transcribe.py        # POST /transcribe, WS /transcribe/stream
│   │   ├── events.py            # GET /events (SSE)
│   │   └── firecrawl.py         # POST /firecrawl/scrape, /extract, /crawl
│   ├── services/
│   │   ├── nova_reasoning.py    # Amazon Nova Lite via Bedrock (466 lines)
│   │   ├── nova_sonic.py        # AWS Transcribe + Groq Whisper fallback
│   │   ├── firecrawl_service.py # Web scraping with SSRF protection + caching
│   │   └── event_bus.py         # Pub/sub for SSE broadcasting
│   ├── tests/                   # Backend test suite (170 tests)
│   ├── requirements.txt
│   └── .env.example
├── dist/                        # Built extension (load this in Chrome)
├── manifest.json                # Chrome MV3 manifest
├── webpack.config.js            # 6 entry points
├── jest.config.js               # Frontend test config
├── package.json
├── TESTING.md                   # Detailed testing guide
└── README.md
```

---

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/health` | Health check |
| `POST` | `/task` | Initial task reasoning (command + screenshot + DOM) |
| `POST` | `/task/continue` | Multi-turn continuation with action history |
| `GET` | `/events` | Server-Sent Events for real-time status |
| `POST` | `/transcribe` | Batch audio transcription |
| `WS` | `/transcribe/stream` | WebSocket streaming transcription |
| `POST` | `/firecrawl/scrape` | Scrape URL to markdown |
| `POST` | `/firecrawl/extract` | AI-powered structured extraction |
| `POST` | `/firecrawl/crawl` | Start async crawl job |
| `GET` | `/firecrawl/crawl/{id}` | Poll crawl status |

Interactive API docs available at `http://localhost:8000/docs` when backend is running.

---

## Testing

```bash
# Backend (170 tests)
cd backend && python -m pytest -v

# Frontend (244 tests)
npm test

# Both
cd backend && python -m pytest -v && cd .. && npm test
```

See **[TESTING.md](TESTING.md)** for the complete testing guide, including what each test covers and end-to-end verification steps.

---

## Settings

| Setting | Options | Default |
|---------|---------|---------|
| **Shortcut Key** | Any key | Backtick (`` ` ``) |
| **Hold Delay** | 100ms – 500ms | 200ms |
| **Display Mode** | Text + Audio, Audio Only, Text Only | Text + Audio |
| **Explanation Level** | Kid, Student, College, PhD, Executive | College |
| **Voice** | ElevenLabs voices | Rachel |

Access via: Extension icon > right-click > **Options**

---

## Troubleshooting

| Issue | Fix |
|-------|-----|
| Bubble doesn't appear | Reload the page. Extension doesn't work on `chrome://` pages |
| No voice pickup | Check mic permission at `chrome://settings/content/microphone` |
| Backend unavailable | Verify `http://localhost:8000/health` returns OK |
| Agent seems stuck | Reload page, try simpler command first |
| No audio response | Check Display Mode is not "Text Only" in Settings |
| Settings not saving | Click "Save Changes" button, then reload |

For more details, see the troubleshooting section in [TESTING.md](TESTING.md).

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Extension | TypeScript, React 18, Tailwind CSS, Webpack 5, Chrome MV3 |
| Backend | Python 3.10+, FastAPI, uvicorn, boto3 |
| AI Reasoning | Amazon Nova 2 Lite (AWS Bedrock) — multimodal vision + language |
| Speech-to-Text | ElevenLabs (primary), Groq Whisper (fallback), AWS Transcribe (optional) |
| Text-to-Speech | ElevenLabs (primary), Web Speech API (fallback) |
| Web Scraping | Firecrawl — converts pages to clean markdown with SSRF protection |
| Testing | Jest + ts-jest (frontend), pytest + pytest-asyncio (backend) |

---

## License

MIT

---

<p align="center">
  Built for the <strong>Amazon Nova AI Hackathon 2026</strong><br/>
  <code>#AmazonNova</code> &middot; <code>#ElevenLabs</code> &middot; <code>#Firecrawl</code>
</p>
