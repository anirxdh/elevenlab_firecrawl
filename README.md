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
  <img src="https://img.shields.io/badge/AWS-Transcribe-232F3E?style=flat-square&logo=amazon-aws" alt="Transcribe" />
  <img src="https://img.shields.io/badge/Chrome-MV3-4285F4?style=flat-square&logo=google-chrome" alt="Chrome" />
  <img src="https://img.shields.io/badge/License-MIT-green?style=flat-square" alt="MIT" />
</p>

<p align="center">
  <a href="https://youtu.be/szfykWVgEYM"><strong>Demo Video</strong></a> &middot;
  <a href="https://screen-sense-nova-anirxdh.netlify.app/"><strong>Landing Page</strong></a>
</p>

---

## What is ScreenSense Voice?

ScreenSense Voice is a Chrome extension that turns your voice into browser actions. Hold a key, speak a command, and an AI agent powered by **Amazon Nova 2 Lite** sees your screen, reasons about what to do, and executes actions autonomously — clicking buttons, filling forms, navigating sites, and completing multi-step tasks.

**Example:** *"Add the cheapest USB-C cable to my cart on Amazon"* — ScreenSense will navigate to Amazon, search, find the cheapest option, click it, and add it to your cart. All hands-free.

### Services Used

| Service | Purpose |
|---------|---------|
| **Amazon Nova 2 Lite** (Bedrock) | Multimodal reasoning — analyzes screenshots + DOM to decide actions |
| **ElevenLabs TTS** | Natural voice readback of AI responses (optional, falls back to browser speech) |

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
        |                  Conversation Store (per-tab), Screenshot Capture
        |
        v  (HTTP / WebSocket)
[ FastAPI Backend ]  ──  POST /transcribe, POST /task, POST /task/continue,
        |                  GET /events (SSE), Nova Reasoning Service
        |
        v  (AWS SDK)
[ Cloud APIs ]       ──  AWS Bedrock (Nova Lite), AWS Transcribe,
                          Groq Whisper (STT fallback), ElevenLabs TTS
```

### How the Agent Loop Works

1. User holds backtick key and speaks a command
2. Audio is recorded via an offscreen document (MV3 sandbox)
3. Service worker captures a screenshot + scrapes the DOM
4. Backend transcribes audio (AWS Transcribe) and sends command + screenshot + DOM to Nova
5. Nova reasons and returns an action (click, type, navigate, scroll, extract)
6. Content script executes the action on the page
7. Service worker re-captures screenshot + re-scrapes DOM
8. Backend re-evaluates with Nova — loops until task is complete (max 25 iterations)

---

## Getting Started

### Prerequisites

- **Node.js** 18+ and npm
- **Python** 3.10+
- **Google Chrome** (latest)
- **AWS Account** with Bedrock access (Nova Lite model enabled)

### 1. Clone the Repository

```bash
git clone <repository-url>
cd screensense-voice
```

### 2. Install Frontend Dependencies

```bash
npm install
```

### 3. Build the Chrome Extension

```bash
npm run build
```

This creates a `dist/` folder with the compiled extension.

### 4. Set Up the Backend

```bash
cd backend
pip install -r requirements.txt
```

### 5. Configure API Keys

Create a `backend/.env` file with:

```env
# Required — AWS credentials for Nova Lite (Bedrock) and Transcribe
AWS_ACCESS_KEY_ID=your-aws-access-key
AWS_SECRET_ACCESS_KEY=your-aws-secret-key
AWS_REGION=us-east-1

# Required — Groq API key (fallback STT if AWS Transcribe unavailable)
GROQ_API_KEY=your-groq-api-key

# Server config
BACKEND_PORT=8000
CORS_ORIGINS=chrome-extension://*
```

**Getting the keys:**

| Key | Where to get it |
|-----|----------------|
| AWS Access Key / Secret | [IAM Console](https://console.aws.amazon.com/iam/) — create a user with `AmazonBedrockFullAccess` and `AmazonTranscribeFullAccess` policies |
| Groq API Key | [console.groq.com/keys](https://console.groq.com/keys) — free, no credit card |

**Important:** Make sure Amazon Nova Lite model access is enabled in your AWS Bedrock console (us-east-1 region).

### 6. Start the Backend

```bash
cd backend
uvicorn main:app --host 0.0.0.0 --port 8000 --reload
```

You should see:
```
INFO:     Uvicorn running on http://0.0.0.0:8000
```

### 7. Load the Extension in Chrome

1. Open Chrome and go to `chrome://extensions/`
2. Enable **Developer mode** (toggle in top-right)
3. Click **Load unpacked**
4. Select the `dist/` folder from the project root
5. The ScreenSense Voice extension will appear — click it to open the popup
6. Complete the onboarding (Welcome page) to grant microphone access

### 8. Use It

1. Navigate to any website (e.g., amazon.com)
2. **Hold the backtick key (`)** and speak your command
3. **Release** the key — ScreenSense processes your voice and executes actions
4. Watch the floating bubble as it listens, transcribes, reasons, and acts

### 9. Customize via Settings

Right-click the extension icon → **Options** (or navigate to the Settings page from the popup) to personalize your experience:

- **Shortcut Key** — Change the hold-to-talk key (default is backtick `` ` ``)
- **Hold Delay** — Adjust how long you need to hold the key before recording starts (100ms–500ms)
- **Display Mode** — Choose how AI responses are delivered: *Text + Audio*, *Audio Only*, or *Text Only*
- **Explanation Level** — Control how detailed the AI's responses are: *Kid*, *Student*, *College*, *PhD*, or *Executive*

All changes are saved per-profile and persist across sessions.

---

## Project Structure

```
Nova-AWS/
├── src/
│   ├── background/          # Service worker (orchestration, pipeline)
│   │   ├── service-worker.ts
│   │   ├── screenshot.ts
│   │   └── api/             # API clients (Groq STT, ElevenLabs, etc.)
│   ├── content/             # Content scripts (injected into web pages)
│   │   ├── content-script.ts
│   │   ├── shortcut-handler.ts
│   │   ├── cursor-bubble.ts  # Floating UI (Shadow DOM, 1700+ lines)
│   │   ├── dom-scraper.ts    # Structured page snapshot
│   │   ├── action-executor.ts # DOM manipulation (click/type/navigate)
│   │   └── tts.ts            # ElevenLabs + Web Speech API
│   ├── offscreen/            # Mic recording (MV3 sandbox)
│   ├── popup/                # Extension popup
│   ├── settings/             # Settings page (shortcut, display mode, etc.)
│   ├── welcome/              # Onboarding flow
│   └── shared/               # Types, storage, constants
├── backend/
│   ├── main.py               # FastAPI app
│   ├── routers/
│   │   ├── transcribe.py     # POST /transcribe, WS /transcribe/stream
│   │   ├── task.py           # POST /task, POST /task/continue
│   │   └── events.py         # GET /events (SSE)
│   └── services/
│       ├── nova_reasoning.py  # Amazon Nova Lite via Bedrock
│       ├── nova_sonic.py      # AWS Transcribe + Groq Whisper fallback
│       └── event_bus.py       # Pub/sub for SSE
├── landing/                   # Landing page (static HTML)
├── dist/                      # Built extension (load this in Chrome)
├── manifest.json
├── webpack.config.js
└── package.json
```

---

## Features

- **Voice-to-Action**: Hold a key, speak, release — AI handles the rest
- **Multimodal Reasoning**: Nova sees screenshots AND reads DOM structure for precise actions
- **Autonomous Agent Loop**: Re-captures screen after each action, reasons about next step (up to 25 iterations)
- **Smart DOM Scraping**: Extracts structured selectors for buttons, links, inputs, forms, products
- **Cross-Site Navigation**: Can navigate between websites to complete tasks
- **Natural TTS**: ElevenLabs voice readback with browser speech fallback
- **Explanation Levels**: Kid, Student, College, PhD, Executive — adjusts AI response depth
- **Dark/Light Theme**: Full theme support across all pages

---

## Testing Instructions

Follow these steps end-to-end to verify everything works correctly.

### Step 1 — Verify the Backend

1. Make sure the backend is running:
   ```bash
   cd backend
   uvicorn main:app --host 0.0.0.0 --port 8000 --reload
   ```
2. Open your browser and navigate to `http://localhost:8000/docs` — you should see the FastAPI Swagger UI. This confirms the server is up and accepting requests.
3. If it fails to start, double-check your `backend/.env` file has valid AWS credentials and a Groq API key.

### Step 2 — Load the Extension

1. Run `npm run build` in the project root to generate the `dist/` folder.
2. Go to `chrome://extensions/`, enable **Developer mode**, click **Load unpacked**, and select the `dist/` folder.
3. You should see the **ScreenSense Voice** extension appear with the icon in your toolbar.
4. Click the extension icon — the popup should open with the ScreenSense UI.

### Step 3 — Complete Onboarding

1. On first install, a **Welcome** page opens automatically.
2. Grant **microphone access** when prompted — this is required for voice commands.
3. After onboarding, the popup should show the main interface.

### Step 4 — Test a Simple Voice Command

1. Navigate to any website (e.g., `google.com`).
2. **Hold the backtick key (`` ` ``)** and speak a simple command like *"Search for weather today"*.
3. **Release the key** — you should see:
   - The floating bubble appear near your cursor
   - The bubble show a "Listening..." state while recording
   - The transcribed text appear in the bubble
   - The AI reasoning and executing actions (e.g., clicking the search bar, typing, pressing Enter)
4. The bubble should show a completion message when the task is done.

### Step 5 — Test a Multi-Step Task

1. Navigate to a shopping site (e.g., `amazon.com`).
2. Hold backtick and say something like *"Find a USB-C cable under $10 and add it to my cart"*.
3. Watch the agent loop — it should:
   - Search for the item
   - Scroll through results
   - Click on a product
   - Add it to cart
   - Confirm completion
4. The agent may take multiple iterations (visible in the bubble). It can run up to 25 iterations before stopping.

### Step 6 — Test the Settings Page

1. Right-click the extension icon in the toolbar and select **Options** (or click the settings/gear icon in the popup).
2. The Settings page should load with the current configuration.
3. **Test each setting:**

   | Setting | What to test |
   |---------|-------------|
   | **Shortcut Key** | Click the key display, press a new key (e.g., `Space`), save, then go to a website and verify the new key triggers recording instead of backtick |
   | **Hold Delay** | Drag the slider to 300ms or 500ms, save, then test — you should need to hold the key slightly longer before recording begins |
   | **Display Mode** | Switch to *Audio Only* → save → test a voice command → you should hear the response but not see text. Switch to *Text Only* → you should see text but hear no speech. Switch back to *Text + Audio* for both |
   | **Explanation Level** | Set to *Kid* → ask a question like "What is this website about?" → response should be very simple. Set to *PhD* → same question → response should be detailed and technical |

4. Click **Reset to Defaults** and verify all settings return to their original values.
5. Close and reopen the Settings page — your saved changes should persist.

### Step 7 — Test Voice Readback (TTS)

1. Make sure Display Mode is set to *Text + Audio* or *Audio Only*.
2. Give a voice command — after the task completes, you should hear the AI speak a summary.
3. If you have an ElevenLabs API key configured, the voice will sound natural. Otherwise, it falls back to your browser's built-in speech engine — both are fine.

### Step 8 — Test Cross-Site Navigation

1. Start on any website.
2. Hold backtick and say *"Go to wikipedia.org and search for artificial intelligence"*.
3. The agent should navigate to Wikipedia, find the search bar, type the query, and search — all autonomously.

---

## Troubleshooting

If something isn't working, try these steps in order:

### The bubble doesn't appear when I hold the key
- **Reload the page** (`Cmd+R` / `Ctrl+R`) — the content script may not have injected yet.
- Make sure you're holding the correct shortcut key (default is backtick `` ` ``). Check Settings if you changed it.
- The extension doesn't work on `chrome://` pages, the Chrome Web Store, or other browser-internal pages. Try on a regular website.

### Voice isn't being picked up
- Check that you granted microphone permission during onboarding. You can verify at `chrome://settings/content/microphone`.
- Try closing and reopening the tab.
- If the issue persists, **remove the extension and re-add it**: go to `chrome://extensions/`, click **Remove** on ScreenSense, then **Load unpacked** again with the `dist/` folder. This resets all permissions.

### "Backend unavailable" or network errors
- Confirm the backend is running at `http://localhost:8000`. Visit `http://localhost:8000/docs` in your browser to verify.
- If you restarted the backend, **reload the page** you're testing on so the extension reconnects.
- Check the terminal running the backend for any Python errors (missing packages, invalid API keys, etc.).

### AI isn't performing actions / seems stuck
- **Reload the page** and try again — sometimes the DOM state gets stale after heavy interaction.
- Try a simpler command first to confirm the pipeline works (e.g., *"Click the search bar"*).
- Check the browser DevTools console (`F12` → Console tab) for any error messages from the extension.
- If the agent loop seems frozen, **close the tab and open a new one**. Each tab has its own conversation state.

### Settings aren't saving
- After making changes, make sure you click the **Save Changes** button.
- Try **removing and re-adding the extension** to reset storage, then configure settings again.

### No audio response from the AI
- Make sure Display Mode is set to *Text + Audio* or *Audio Only* in Settings.
- Check that your system volume is not muted.
- If ElevenLabs TTS isn't working, the extension automatically falls back to the browser's built-in speech engine — you should still hear something.

### General: When in doubt
1. **Reload the page** you're on.
2. Go to `chrome://extensions/` and click the **refresh icon** (circular arrow) on the ScreenSense extension.
3. If it's still broken, **remove the extension entirely** and **load it again** from the `dist/` folder.
4. As a last resort, run `npm run build` again to regenerate the `dist/` folder, then reload.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Extension | TypeScript, React, Tailwind CSS, Webpack 5, Chrome MV3 |
| Backend | Python, FastAPI, uvicorn, boto3 |
| AI Reasoning | Amazon Nova 2 Lite (AWS Bedrock) |
| Speech-to-Text | AWS Transcribe Streaming (primary), Groq Whisper (fallback) |
| Text-to-Speech | ElevenLabs (optional), Web Speech API (fallback) |

---

## License

MIT

---

<p align="center">
  Built for the <strong>Amazon Nova AI Hackathon 2026</strong><br/>
  <code>#AmazonNova</code>
</p>
