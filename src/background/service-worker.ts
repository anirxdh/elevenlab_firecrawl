import { ExtensionState, IconState, ConversationTurn, ConversationInfo, DomSnapshot } from '../shared/types';
import { isMicPermissionGranted, getApiKeys } from '../shared/storage';
import { MAX_CONVERSATION_TURNS } from '../shared/constants';
import { captureScreenshot } from './screenshot';
import { connectSSE, checkBackendHealth, sendTask, scrapeUrl, TaskResponse } from './api/backend-client';
import { transcribe } from './transcription-service';
import { ensureOffscreen, handleOffscreenReady, forwardAmplitude } from './offscreen-manager';
import { runAgentLoop, dbg, dbgTimer, clearDebugLog, AgentLoopState, classifyResponse } from './agent-executor';
import { registerHandler, initMessageRouter } from './message-router';
import { ConversationManager, ConversationState, routeByIntent } from './conversation-manager';
// groq-vision imports retained for Phase 8+ migration
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { streamVisionResponse, generateTtsSummary } from './api/groq-vision';

// ─── Shared State ───

let currentState: ExtensionState = 'idle';
let pendingTabId: number | null = null;
let recordingTabId: number | null = null;
let swAmpLogged = false;
let pipelineRunning = false;

// Conversation manager for multi-turn dialogue
const conversation = new ConversationManager();

// Track whether the offscreen document has been set up and recording started
// so that stop-recording waits for start-recording to complete.
let recordingStartedPromise: Promise<void> | null = null;

// Agent loop state — shared with agent-executor module
const agentState: AgentLoopState = {
  agentLoopCancelled: false,
  agentLoopRunning: false,
  agentLoopTabId: null,
};

// Per-tab conversation history
const conversations = new Map<number, ConversationTurn[]>();

function getConversation(tabId: number): ConversationTurn[] {
  if (!conversations.has(tabId)) {
    conversations.set(tabId, []);
  }
  return conversations.get(tabId)!;
}

function clearConversation(tabId: number): void {
  conversations.delete(tabId);
}

function getConversationInfo(tabId: number): ConversationInfo {
  const history = conversations.get(tabId) || [];
  return {
    turns: Math.floor(history.length / 2),
    maxTurns: MAX_CONVERSATION_TURNS,
  };
}

// ─── Icon & State ───

function openWelcomeTab(): void {
  const welcomeUrl = chrome.runtime.getURL('welcome.html');
  chrome.tabs.create({ url: welcomeUrl });
}

function updateToolbarIcon(iconState: IconState): void {
  switch (iconState) {
    case 'inactive':
      chrome.action.setBadgeText({ text: '' });
      break;
    case 'ready':
      chrome.action.setBadgeText({ text: 'OK' });
      chrome.action.setBadgeBackgroundColor({ color: '#4CAF50' });
      break;
    case 'recording':
      chrome.action.setBadgeText({ text: 'REC' });
      chrome.action.setBadgeBackgroundColor({ color: '#F44336' });
      break;
  }
}

async function resolveIconState(): Promise<void> {
  if (currentState === 'listening') {
    updateToolbarIcon('recording');
  } else {
    const micGranted = await isMicPermissionGranted();
    updateToolbarIcon(micGranted ? 'ready' : 'inactive');
  }
}

function sendToTab(tabId: number, message: object): void {
  chrome.tabs.sendMessage(tabId, message).catch(() => {
    // Content script may not be loaded in this tab — ignore
  });
}

function broadcastStateChange(state: ExtensionState): void {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (tabs[0]?.id) {
      chrome.tabs.sendMessage(tabs[0].id, {
        action: 'state-changed' as const,
        state,
      }).catch((err) => console.error('[ScreenSense] state-changed broadcast:', err));
    }
  });
}

// ─── Pipeline ───

async function runPipeline(tabId: number, audioBase64: string, mimeType: string): Promise<void> {
  if (pipelineRunning || agentState.agentLoopRunning) {
    sendToTab(tabId, { action: 'pipeline-error', error: 'Please wait — still processing your previous request' });
    return;
  }
  pipelineRunning = true;
  clearDebugLog();
  dbg(`=== PIPELINE START === tabId=${tabId} audioLen=${audioBase64.length} mime=${mimeType}`);

  // Start conversation session and transition to listening
  conversation.startSession(tabId);
  conversation.transition(ConversationState.Listening);

  try {
    // Capture screenshot (overlay hidden during capture)
    const endScreenshot = dbgTimer('Pipeline: screenshot');
    let screenshot: string;
    try {
      screenshot = await captureScreenshot(tabId);
      endScreenshot();
    } catch {
      sendToTab(tabId, { action: 'pipeline-error', error: 'Could not capture screen' });
      currentState = 'idle';
      resolveIconState();
      broadcastStateChange('idle');
      return;
    }

    // Stage 1: Transcribe audio
    sendToTab(tabId, { action: 'bubble-state', state: 'transcribing' });

    const endTranscribe = dbgTimer('Pipeline: transcription');
    let transcript: string;
    try {
      const { elevenLabsKey, groqKey } = await getApiKeys();
      if (!elevenLabsKey) throw new Error('ElevenLabs API key not configured — check Settings');
      transcript = await transcribe(audioBase64, mimeType, elevenLabsKey, groqKey);
      dbg(`Transcript: "${transcript}"`);
      endTranscribe();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Couldn't catch that — try holding a bit longer";
      sendToTab(tabId, { action: 'pipeline-error', error: msg });
      currentState = 'idle';
      resolveIconState();
      broadcastStateChange('idle');
      return;
    }

    // Record user turn in conversation manager
    conversation.addTurn('user', transcript);
    conversation.transition(ConversationState.Processing);

    sendToTab(tabId, { action: 'bubble-set-task', task: transcript });
    sendToTab(tabId, { action: 'bubble-state', state: 'understanding', label: transcript });

    // Capture DOM snapshot from content script
    let domSnapshot: Partial<DomSnapshot> = {};
    try {
      const domResponse = await chrome.tabs.sendMessage(tabId, { action: 'scrape-dom' });
      if (domResponse?.ok && domResponse.snapshot) {
        domSnapshot = domResponse.snapshot;
      }
    } catch {
      console.warn('[ScreenSense] Could not scrape DOM, proceeding without');
    }

    // Scrape current URL via Firecrawl (optional, non-blocking on failure)
    let firecrawlMarkdown: string | undefined;
    try {
      const currentUrl = (domSnapshot as DomSnapshot).url;
      if (currentUrl) {
        firecrawlMarkdown = await scrapeUrl(currentUrl);
        dbg(`Firecrawl scraped ${firecrawlMarkdown.length} chars`);
      }
    } catch (err) {
      dbg(`Firecrawl scrape failed (non-fatal): ${err}`);
    }

    // Get conversation history for context
    const conversationHistory = conversation.getTextOnlyHistory(tabId);

    // Send command + screenshot + DOM to backend for Nova reasoning
    const endNova = dbgTimer('Pipeline: Nova /task call');
    let taskResult: TaskResponse;
    try {
      taskResult = await sendTask(transcript, screenshot, domSnapshot, firecrawlMarkdown, conversationHistory);
      endNova();
      dbg(`Nova initial response: type=${taskResult.type} reasoning="${taskResult.reasoning || 'none'}" actions=${taskResult.actions?.length || 0}`);
      if (taskResult.actions) {
        dbg(`Initial actions: ${JSON.stringify(taskResult.actions.map(a => a.description))}`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Something went wrong — give it another try';
      sendToTab(tabId, { action: 'pipeline-error', error: msg });
      currentState = 'idle';
      resolveIconState();
      broadcastStateChange('idle');
      return;
    }

    // Handle intent-based routing if an intent was returned
    if (taskResult.intent) {
      const route = routeByIntent(taskResult.intent, tabId, conversation);
      if (route === 'cancel') {
        sendToTab(tabId, { action: 'bubble-state', state: 'done', label: 'Cancelled' });
        return;
      }
      // 'new_session' clears and restarts; 'continue' proceeds normally
    }

    // Send reasoning to bubble if present
    if (taskResult.reasoning) {
      sendToTab(tabId, { action: 'bubble-reasoning', text: taskResult.reasoning });
    }

    // Handle conversational response types before standard handling
    const responseClass = classifyResponse(taskResult);
    if (responseClass === 'clarify') {
      const question = taskResult.question || 'Could you clarify?';
      conversation.addTurn('agent', question);
      sendToTab(tabId, { action: 'tts-summary', summary: question });
      sendToTab(tabId, { action: 'bubble-state', state: 'done', label: question });
      conversation.transition(ConversationState.AwaitingReply);
      return;
    }
    if (responseClass === 'options') {
      const optionsText = taskResult.question
        ? `${taskResult.question} ${taskResult.options!.join(', ')}`
        : taskResult.options!.join(', ');
      conversation.addTurn('agent', optionsText);
      sendToTab(tabId, { action: 'tts-summary', summary: optionsText });
      sendToTab(tabId, { action: 'bubble-state', state: 'done', label: optionsText });
      conversation.transition(ConversationState.AwaitingReply);
      return;
    }
    if (responseClass === 'suggest') {
      const suggestionText = taskResult.suggestion || 'I have a suggestion.';
      conversation.addTurn('agent', suggestionText);
      sendToTab(tabId, { action: 'tts-summary', summary: suggestionText });
      sendToTab(tabId, { action: 'bubble-state', state: 'done', label: suggestionText });
      conversation.transition(ConversationState.AwaitingReply);
      return;
    }
    if (responseClass === 'speak') {
      const speakText = taskResult.speak || '';
      conversation.addTurn('agent', speakText);
      sendToTab(tabId, { action: 'tts-summary', summary: speakText });
      sendToTab(tabId, { action: 'bubble-state', state: 'done', label: speakText });
      return;
    }

    // Handle response based on type
    if (taskResult.type === 'answer') {
      const answerText = taskResult.text || '';
      sendToTab(tabId, { action: 'bubble-state', state: 'answering' });
      sendToTab(tabId, { action: 'bubble-answer-chunk', text: answerText });
      sendToTab(tabId, { action: 'bubble-answer-done', fullText: answerText });
      // Short summary for voice: just the first sentence
      const firstSentence = answerText.split(/\.\s/)[0];
      const summary = firstSentence.endsWith('.') ? firstSentence : firstSentence + '.';
      sendToTab(tabId, { action: 'tts-summary', summary });

      // Add to conversation history (both old map and ConversationManager)
      conversation.addTurn('agent', answerText);
      const history = getConversation(tabId);
      history.push({ role: 'user', content: transcript });
      history.push({ role: 'agent', content: answerText });
      while (history.length > MAX_CONVERSATION_TURNS * 2) {
        history.shift();
        history.shift();
      }
      sendToTab(tabId, { action: 'conversation-info', info: getConversationInfo(tabId) });
    } else if (taskResult.type === 'steps') {
      console.log('[ScreenSense] Executing action plan:', taskResult.actions);

      // Add to conversation history (store the step plan as assistant response)
      const stepsText = taskResult.actions
        ?.map((a, i) => `${i + 1}. ${a.description}`)
        .join('\n') || 'No steps returned';

      conversation.addTurn('agent', stepsText);
      const history = getConversation(tabId);
      history.push({ role: 'user', content: transcript });
      history.push({ role: 'agent', content: stepsText });
      while (history.length > MAX_CONVERSATION_TURNS * 2) {
        history.shift();
        history.shift();
      }
      sendToTab(tabId, { action: 'conversation-info', info: getConversationInfo(tabId) });

      // Pass Firecrawl + conversation context to agent loop
      agentState.firecrawlMarkdown = firecrawlMarkdown;
      agentState.conversationHistory = conversationHistory;
      agentState.onAwaitReply = () => {
        conversation.transition(ConversationState.AwaitingReply);
        sendToTab(tabId, { action: 'bubble-state', state: 'done', label: 'Waiting for your reply...' });
      };

      // Execute steps via agent loop (re-observes page after each batch)
      conversation.transition(ConversationState.Executing);
      await runAgentLoop(tabId, transcript, taskResult.actions, agentState);
    }
  } catch (err) {
    console.error('[ScreenSense] Pipeline error:', err);
    sendToTab(tabId, { action: 'pipeline-error', error: 'Something went wrong — give it another try' });
  } finally {
    pipelineRunning = false;
    currentState = 'idle';
    resolveIconState();
    broadcastStateChange('idle');
  }
}

/** Run a follow-up text query (no audio transcription needed) */
async function runFollowUp(tabId: number, text: string): Promise<void> {
  if (pipelineRunning || agentState.agentLoopRunning) {
    sendToTab(tabId, { action: 'pipeline-error', error: 'Please wait — still processing your previous request' });
    return;
  }
  pipelineRunning = true;
  currentState = 'processing';
  broadcastStateChange('processing');

  // Start/continue conversation session
  conversation.startSession(tabId);
  conversation.addTurn('user', text);
  conversation.transition(ConversationState.Processing);

  try {
    let screenshot: string;
    try {
      screenshot = await captureScreenshot(tabId);
    } catch {
      sendToTab(tabId, { action: 'pipeline-error', error: 'Could not capture screen' });
      return;
    }

    sendToTab(tabId, { action: 'bubble-state', state: 'understanding', label: text });

    // Capture DOM snapshot from content script
    let domSnapshot: Partial<DomSnapshot> = {};
    try {
      const domResponse = await chrome.tabs.sendMessage(tabId, { action: 'scrape-dom' });
      if (domResponse?.ok && domResponse.snapshot) {
        domSnapshot = domResponse.snapshot;
      }
    } catch {
      console.warn('[ScreenSense] Could not scrape DOM for follow-up, proceeding without');
    }

    // Scrape current URL via Firecrawl (optional, non-blocking on failure)
    let firecrawlMarkdown: string | undefined;
    try {
      const currentUrl = (domSnapshot as DomSnapshot).url;
      if (currentUrl) {
        firecrawlMarkdown = await scrapeUrl(currentUrl);
      }
    } catch {
      // Firecrawl not available — proceed without
    }

    // Get conversation history for context
    const conversationHistory = conversation.getTextOnlyHistory(tabId);

    // Send command + screenshot + DOM to backend for Nova reasoning
    let taskResult: TaskResponse;
    try {
      taskResult = await sendTask(text, screenshot, domSnapshot, firecrawlMarkdown, conversationHistory);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Something went wrong — give it another try';
      sendToTab(tabId, { action: 'pipeline-error', error: msg });
      return;
    }

    // Handle intent-based routing if an intent was returned
    if (taskResult.intent) {
      const route = routeByIntent(taskResult.intent, tabId, conversation);
      if (route === 'cancel') {
        sendToTab(tabId, { action: 'bubble-state', state: 'done', label: 'Cancelled' });
        return;
      }
    }

    // Send reasoning to bubble if present
    if (taskResult.reasoning) {
      sendToTab(tabId, { action: 'bubble-reasoning', text: taskResult.reasoning });
    }

    // Handle conversational response types before standard handling
    const responseClass = classifyResponse(taskResult);
    if (responseClass === 'clarify') {
      const question = taskResult.question || 'Could you clarify?';
      conversation.addTurn('agent', question);
      sendToTab(tabId, { action: 'tts-summary', summary: question });
      sendToTab(tabId, { action: 'bubble-state', state: 'done', label: question });
      conversation.transition(ConversationState.AwaitingReply);
      return;
    }
    if (responseClass === 'options') {
      const optionsText = taskResult.question
        ? `${taskResult.question} ${taskResult.options!.join(', ')}`
        : taskResult.options!.join(', ');
      conversation.addTurn('agent', optionsText);
      sendToTab(tabId, { action: 'tts-summary', summary: optionsText });
      sendToTab(tabId, { action: 'bubble-state', state: 'done', label: optionsText });
      conversation.transition(ConversationState.AwaitingReply);
      return;
    }
    if (responseClass === 'suggest') {
      const suggestionText = taskResult.suggestion || 'I have a suggestion.';
      conversation.addTurn('agent', suggestionText);
      sendToTab(tabId, { action: 'tts-summary', summary: suggestionText });
      sendToTab(tabId, { action: 'bubble-state', state: 'done', label: suggestionText });
      conversation.transition(ConversationState.AwaitingReply);
      return;
    }
    if (responseClass === 'speak') {
      const speakText = taskResult.speak || '';
      conversation.addTurn('agent', speakText);
      sendToTab(tabId, { action: 'tts-summary', summary: speakText });
      sendToTab(tabId, { action: 'bubble-state', state: 'done', label: speakText });
      return;
    }

    // Handle response based on type
    if (taskResult.type === 'answer') {
      const answerText = taskResult.text || '';
      sendToTab(tabId, { action: 'bubble-state', state: 'answering' });
      sendToTab(tabId, { action: 'bubble-answer-chunk', text: answerText });
      sendToTab(tabId, { action: 'bubble-answer-done', fullText: answerText });
      // Short summary for voice: just the first sentence
      const firstSentence2 = answerText.split(/\.\s/)[0];
      const summary = firstSentence2.endsWith('.') ? firstSentence2 : firstSentence2 + '.';
      sendToTab(tabId, { action: 'tts-summary', summary });

      conversation.addTurn('agent', answerText);
      const history = getConversation(tabId);
      history.push({ role: 'user', content: text });
      history.push({ role: 'agent', content: answerText });
      while (history.length > MAX_CONVERSATION_TURNS * 2) {
        history.shift();
        history.shift();
      }
      sendToTab(tabId, { action: 'conversation-info', info: getConversationInfo(tabId) });
    } else if (taskResult.type === 'steps') {
      console.log('[ScreenSense] Executing follow-up action plan:', taskResult.actions);

      // Add to conversation history (store the step plan as assistant response)
      const stepsText = taskResult.actions
        ?.map((a, i) => `${i + 1}. ${a.description}`)
        .join('\n') || 'No steps returned';

      conversation.addTurn('agent', stepsText);
      const history = getConversation(tabId);
      history.push({ role: 'user', content: text });
      history.push({ role: 'agent', content: stepsText });
      while (history.length > MAX_CONVERSATION_TURNS * 2) {
        history.shift();
        history.shift();
      }
      sendToTab(tabId, { action: 'conversation-info', info: getConversationInfo(tabId) });

      // Pass Firecrawl + conversation context to agent loop
      agentState.firecrawlMarkdown = firecrawlMarkdown;
      agentState.conversationHistory = conversationHistory;
      agentState.onAwaitReply = () => {
        conversation.transition(ConversationState.AwaitingReply);
        sendToTab(tabId, { action: 'bubble-state', state: 'done', label: 'Waiting for your reply...' });
      };

      // Execute steps via agent loop (re-observes page after each batch)
      conversation.transition(ConversationState.Executing);
      await runAgentLoop(tabId, text, taskResult.actions, agentState);
    }
  } catch (err) {
    console.error('[ScreenSense] Follow-up error:', err);
    sendToTab(tabId, { action: 'pipeline-error', error: 'Something went wrong — give it another try' });
  } finally {
    pipelineRunning = false;
    currentState = 'idle';
    resolveIconState();
    broadcastStateChange('idle');
  }
}

// ─── Message Handlers ───

registerHandler('shortcut-hold', (message, sender, sendResponse) => {
  console.log('[ScreenSense][SW] Received shortcut-hold');
  currentState = 'listening';
  recordingTabId = sender.tab?.id ?? null;
  swAmpLogged = false;
  updateToolbarIcon('recording');
  broadcastStateChange(currentState);
  if (recordingTabId) {
    sendToTab(recordingTabId, { action: 'start-listening' });
  }
  recordingStartedPromise = ensureOffscreen().then(() => {
    console.log('[ScreenSense][SW] Sending start-recording to offscreen');
    return chrome.runtime.sendMessage({ target: 'offscreen', action: 'start-recording' }).catch((err) => console.error('[ScreenSense] start-recording send:', err));
  }).then(() => {
    console.log('[ScreenSense][SW] start-recording message sent successfully');
  }).catch((err) => {
    console.error('[ScreenSense][SW] Failed to create offscreen document:', err);
  });
  sendResponse({ ok: true, state: currentState });
});

registerHandler('shortcut-release', (message, sender, sendResponse) => {
  console.log('[ScreenSense][SW] Received shortcut-release');
  currentState = 'processing';
  broadcastStateChange(currentState);
  pendingTabId = sender.tab?.id ?? recordingTabId;
  if (pendingTabId) {
    sendToTab(pendingTabId, { action: 'bubble-state', state: 'transcribing' });
  }
  const startPromise = recordingStartedPromise || Promise.resolve();
  startPromise.then(() => {
    console.log('[ScreenSense][SW] Sending stop-recording to offscreen');
    chrome.runtime.sendMessage({ target: 'offscreen', action: 'stop-recording' }).catch((err) => {
      console.error('[ScreenSense][SW] Failed to send stop-recording:', err);
    });
  });
  recordingStartedPromise = null;
  sendResponse({ ok: true, state: currentState });
});

registerHandler('offscreen-amplitude', (message) => {
  const ampData = (message as { action: 'offscreen-amplitude'; data: number[] }).data;
  swAmpLogged = forwardAmplitude(ampData, recordingTabId, swAmpLogged);
});

registerHandler('offscreen-ready', () => {
  handleOffscreenReady();
});

registerHandler('offscreen-started', () => {
  console.log('[ScreenSense][SW] Offscreen recording started');
});

registerHandler('offscreen-recording-complete', (message) => {
  const msg = message as unknown as { action: 'offscreen-recording-complete'; audioBase64: string; mimeType: string };
  console.log('[ScreenSense][SW] Offscreen recording complete, audioBase64 length:', msg.audioBase64?.length, 'mimeType:', msg.mimeType, 'pendingTabId:', pendingTabId);
  const tabId = pendingTabId;
  pendingTabId = null;
  if (tabId && msg.audioBase64) {
    console.log('[ScreenSense][SW] Calling runPipeline with tabId:', tabId);
    runPipeline(tabId, msg.audioBase64, msg.mimeType);
  } else {
    console.error('[ScreenSense][SW] Cannot run pipeline: tabId=', tabId, 'hasAudio=', !!msg.audioBase64);
  }
});

registerHandler('offscreen-error', (message) => {
  const errMsg = (message as unknown as { action: 'offscreen-error'; error: string }).error;
  console.error('[ScreenSense] Offscreen error:', errMsg);
  if (pendingTabId) {
    sendToTab(pendingTabId, { action: 'pipeline-error', error: errMsg });
  }
  currentState = 'idle';
  resolveIconState();
  broadcastStateChange('idle');
});

registerHandler('elevenlabs-tts', (message, _sender, sendResponse) => {
  const ttsMsg = message as unknown as { action: 'elevenlabs-tts'; voiceId: string; text: string; apiKey: string; modelId: string };
  fetch(`https://api.elevenlabs.io/v1/text-to-speech/${ttsMsg.voiceId}`, {
    method: 'POST',
    headers: {
      'xi-api-key': ttsMsg.apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      text: ttsMsg.text,
      model_id: ttsMsg.modelId,
      voice_settings: { stability: 0.5, similarity_boost: 0.75 },
    }),
  })
    .then(async (resp) => {
      if (!resp.ok) {
        sendResponse({ ok: false, error: `HTTP ${resp.status}` });
        return;
      }
      const blob = await resp.blob();
      const reader = new FileReader();
      reader.onloadend = () => {
        const base64 = (reader.result as string).split(',')[1];
        sendResponse({ ok: true, audioBase64: base64 });
      };
      reader.readAsDataURL(blob);
    })
    .catch((err) => {
      sendResponse({ ok: false, error: String(err) });
    });
  return true; // async sendResponse
});

registerHandler('capture-screenshot', (_message, sender, sendResponse) => {
  captureScreenshot(sender.tab?.id).then((dataUrl) => {
    sendResponse({ ok: true, dataUrl });
  }).catch((err) => sendResponse({ ok: false, error: String(err) }));
  return true;
});

registerHandler('follow-up', (message, sender, sendResponse) => {
  if (sender.tab?.id) {
    runFollowUp(sender.tab.id, (message as unknown as { action: 'follow-up'; text: string }).text);
  }
  sendResponse({ ok: true });
});

registerHandler('cancel-agent-loop', (_message, _sender, sendResponse) => {
  agentState.agentLoopCancelled = true;
  sendResponse({ ok: true });
});

registerHandler('clear-conversation', (_message, sender, sendResponse) => {
  if (sender.tab?.id) {
    clearConversation(sender.tab.id);
    conversation.clearSession(sender.tab.id);
    sendToTab(sender.tab.id, {
      action: 'conversation-info',
      info: { turns: 0, maxTurns: MAX_CONVERSATION_TURNS },
    });
  }
  sendResponse({ ok: true });
});

registerHandler('get-conversation-info', (_message, sender, sendResponse) => {
  if (sender.tab?.id) {
    sendResponse({ ok: true, info: getConversationInfo(sender.tab.id) });
  } else {
    sendResponse({ ok: true, info: { turns: 0, maxTurns: MAX_CONVERSATION_TURNS } });
  }
});

registerHandler('get-state', (_message, _sender, sendResponse) => {
  sendResponse({ ok: true, state: currentState });
});

registerHandler('open-welcome', (_message, _sender, sendResponse) => {
  openWelcomeTab();
  sendResponse({ ok: true });
});

registerHandler('check-mic-permission', (_message, _sender, sendResponse) => {
  sendResponse({ ok: true });
});

// ─── Install the router ───

initMessageRouter();

// ─── Lifecycle ───

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    openWelcomeTab();
  }
  resolveIconState();
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === 'local' && changes['screensense-mic-granted']) {
    resolveIconState();
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  conversations.delete(tabId);
  conversation.clearSession(tabId);
  if (agentState.agentLoopTabId !== null && tabId === agentState.agentLoopTabId) {
    agentState.agentLoopCancelled = true;
  }
});

// ─── Backend SSE Connection ───

let sseConnection: EventSource | null = null;

function initSSE(): void {
  if (sseConnection) {
    sseConnection.close();
  }
  sseConnection = connectSSE();
  sseConnection.addEventListener('status', (event: MessageEvent) => {
    try {
      if (agentState.agentLoopRunning) return;
      const data = JSON.parse(event.data);
      console.log('[ScreenSense] SSE status:', data.stage, data);

      // Determine which tab to send to
      const tabId = pendingTabId ?? recordingTabId;
      if (!tabId) return;

      // Map backend SSE stages to bubble states
      switch (data.stage) {
        case 'transcribing':
          sendToTab(tabId, { action: 'bubble-state', state: 'transcribing' });
          break;
        case 'done':
          break;
        case 'understanding':
          sendToTab(tabId, { action: 'bubble-state', state: 'understanding' });
          break;
        case 'task_complete':
          break;
        case 'error':
          sendToTab(tabId, { action: 'pipeline-error', error: data.detail || 'Something went wrong' });
          break;
      }
    } catch {
      console.warn('[ScreenSense] Failed to parse SSE event:', event.data);
    }
  });
  sseConnection.onerror = () => {
    console.warn('[ScreenSense] SSE connection lost, will retry in 5s');
    sseConnection?.close();
    sseConnection = null;
    setTimeout(initSSE, 5000);
  };
}

// Try to connect SSE on startup (non-blocking, fails silently if backend not running)
checkBackendHealth().then((ok) => {
  if (ok) {
    initSSE();
    console.log('[ScreenSense] Backend connected, SSE initialized');
  } else {
    console.warn('[ScreenSense] Backend not reachable at localhost:8000 — start it with: cd backend && uvicorn backend.main:app');
  }
});
