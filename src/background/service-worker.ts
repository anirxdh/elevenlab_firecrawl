import { ExtensionState, IconState, MessageType, ConversationTurn, ConversationInfo } from '../shared/types';
import { isMicPermissionGranted } from '../shared/storage';
import { MAX_CONVERSATION_TURNS } from '../shared/constants';
import { captureScreenshot } from './screenshot';
import { transcribeAudio, transcribeAudioStreaming, connectSSE, checkBackendHealth, sendTask, sendTaskContinue, TaskResponse, ActionHistoryEntry } from './api/backend-client';
// groq-vision imports retained for Phase 8+ migration
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { streamVisionResponse, generateTtsSummary } from './api/groq-vision';

const MAX_AGENT_ITERATIONS = 25;

let currentState: ExtensionState = 'idle';
let latestScreenshot: string | undefined;
let pendingTabId: number | null = null;
let recordingTabId: number | null = null;
let offscreenReady = false;
let swAmpLogged = false;
let agentLoopCancelled = false;
let agentLoopRunning = false;
let pipelineRunning = false;
let agentLoopTabId: number | null = null;
let ensureOffscreenInFlight: Promise<void> | null = null;

// Track whether the offscreen document has been set up and recording started
// so that stop-recording waits for start-recording to complete.
let recordingStartedPromise: Promise<void> | null = null;

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

// ─── Offscreen Document Management ───

// Resolves when the offscreen document has loaded its script and sent 'offscreen-ready'.
let offscreenReadyResolve: (() => void) | null = null;
let offscreenReadyPromise: Promise<void> | null = null;

async function ensureOffscreen(): Promise<void> {
  if (ensureOffscreenInFlight) return ensureOffscreenInFlight;
  ensureOffscreenInFlight = _ensureOffscreen().finally(() => { ensureOffscreenInFlight = null; });
  return ensureOffscreenInFlight;
}

async function _ensureOffscreen(): Promise<void> {
  const chrome_ = chrome as any;

  const contexts = await chrome_.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT'],
  });

  if (contexts && contexts.length > 0) {
    offscreenReady = true;
    return;
  }

  // Create a promise that resolves when the offscreen document signals it's ready
  offscreenReadyPromise = new Promise<void>((resolve) => {
    offscreenReadyResolve = resolve;
  });

  console.log('[ScreenSense][SW] Creating offscreen document...');
  await chrome_.offscreen.createDocument({
    url: 'offscreen.html',
    reasons: ['USER_MEDIA'],
    justification: 'Microphone recording for voice queries',
  });

  // Wait for the offscreen script to load and register its listener.
  // The offscreen document sends an 'offscreen-ready' message on load.
  // Use a timeout fallback in case the ready message is missed.
  await Promise.race([
    offscreenReadyPromise,
    new Promise<void>((resolve) => setTimeout(resolve, 500)),
  ]);

  offscreenReady = true;
  console.log('[ScreenSense][SW] Offscreen document ready');
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

function sendToTab(tabId: number, message: MessageType): void {
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
      }).catch(() => {});
    }
  });
}

// ─── Debug Logger ───

const DEBUG_LOG: string[] = [];

function dbg(msg: string): void {
  const ts = new Date().toISOString().slice(11, 23); // HH:MM:SS.mmm
  const line = `[${ts}] ${msg}`;
  DEBUG_LOG.push(line);
  console.log(`[ScreenSense][DBG] ${line}`);
}

function dbgTimer(label: string): () => string {
  const start = performance.now();
  return () => {
    const ms = Math.round(performance.now() - start);
    const result = `${label} (${ms}ms)`;
    dbg(result);
    return result;
  };
}

/** Get the full debug log as a string (for copying from console) */
function getDebugLog(): string {
  return DEBUG_LOG.join('\n');
}

// Expose globally for console access
(globalThis as any).__screensenseDebugLog = getDebugLog;

// ─── Pipeline ───

/** Send done state with completed steps summary */
/** Convert an action result to a short 3-7 word TTS phrase */
function shortSpeak(result: string): string {
  if (result.startsWith('Navigating to')) return 'Going to ' + result.replace('Navigating to https://www.', '').replace('Navigating to https://', '').split('/')[0];
  if (result.startsWith('Navigated to')) return 'Opened ' + result.replace('Navigated to https://www.', '').replace('Navigated to https://', '').split('/')[0];
  if (result.startsWith("Typed '")) {
    const match = result.match(/Typed '([^']+)'/);
    return match ? `Searching ${match[1].slice(0, 20)}` : 'Typing';
  }
  if (result.startsWith("Clicked '#add-to-cart") || result.includes('Add to Cart') || result.includes('Add to cart')) return 'Added to cart';
  if (result.startsWith("Clicked '")) {
    const match = result.match(/Clicked '([^']+)'/);
    const label = match ? match[1].slice(0, 25) : 'element';
    return `Clicking ${label}`;
  }
  if (result.startsWith('Scrolled')) return 'Scrolling';
  if (result.startsWith('Extracted')) return 'Reading text';
  if (result.includes('navigated')) return 'Page loaded';
  return result.slice(0, 30);
}

function sendAgentDone(tabId: number, actionHistory: ActionHistoryEntry[], label?: string): void {
  if (actionHistory.length > 0) {
    const stepSummaries = actionHistory.map(a => a.result || a.description);
    sendToTab(tabId, { action: 'bubble-done-summary', steps: stepSummaries });

    // Speak "All done" when task completes
    if (label !== 'Cancelled') {
      sendToTab(tabId, { action: 'tts-summary', summary: 'All done.' });
    }
  }
  sendToTab(tabId, { action: 'bubble-state', state: 'done', label });
  dbg(`=== AGENT DONE === steps=${actionHistory.length} label=${label || 'complete'}`);
  dbg(`Full log:\n${getDebugLog()}`);
}

async function waitForDomStable(tabId: number, timeout = 2000, settleMs = 300): Promise<boolean> {
  try {
    const result = await chrome.tabs.sendMessage(tabId, {
      action: 'wait-for-dom-stable',
      timeout,
      settleMs,
    });
    return result?.stable ?? false;
  } catch {
    // Content script unreachable — page may have navigated
    return false;
  }
}

/** Wait until DOM scrape returns meaningful content (buttons/inputs/links > 0) */
async function waitForDomContent(tabId: number, maxWaitMs = 8000): Promise<object> {
  const start = Date.now();
  let lastSnapshot: object = {};
  let attempt = 0;

  while (Date.now() - start < maxWaitMs) {
    attempt++;
    try {
      const domResponse = await chrome.tabs.sendMessage(tabId, { action: 'scrape-dom' });
      dbg(`waitForDomContent[${attempt}]: raw response ok=${domResponse?.ok} hasSnapshot=${!!domResponse?.snapshot} type=${typeof domResponse} keys=${domResponse?.snapshot ? Object.keys(domResponse.snapshot).length : 'N/A'} error=${domResponse?.error || 'none'}`);
      if (domResponse?.ok && domResponse.snapshot) {
        const snap = domResponse.snapshot;
        const bCount = snap.buttons?.length || 0;
        const iCount = snap.inputs?.length || 0;
        const lCount = snap.links?.length || 0;
        dbg(`waitForDomContent[${attempt}]: buttons=${bCount} inputs=${iCount} links=${lCount} url=${snap.url || 'none'}`);
        if (bCount > 0 || iCount > 0 || lCount > 5) {
          dbg(`waitForDomContent: found content after ${Date.now() - start}ms`);
          return snap;
        }
        lastSnapshot = snap;
      } else if (domResponse && !domResponse.ok) {
        dbg(`waitForDomContent[${attempt}]: scrape FAILED: ${domResponse.error}`);
      } else {
        dbg(`waitForDomContent[${attempt}]: unexpected response: ${JSON.stringify(domResponse)?.slice(0, 200)}`);
      }
    } catch (err) {
      dbg(`waitForDomContent[${attempt}]: sendMessage threw: ${err}`);
    }
    await new Promise(r => setTimeout(r, 500));
  }

  dbg(`waitForDomContent: timed out after ${maxWaitMs}ms (${attempt} attempts) — using last snapshot with keys=${Object.keys(lastSnapshot).length}`);
  return lastSnapshot;
}

async function runAgentLoop(
  tabId: number,
  originalCommand: string,
  initialActions: TaskResponse['actions']
): Promise<void> {
  if (!initialActions || initialActions.length === 0) {
    sendToTab(tabId, { action: 'bubble-state', state: 'done' });
    return;
  }

  // Guard against concurrent agent loops
  if (agentLoopRunning) {
    console.warn('[ScreenSense][loop] Agent loop already running, skipping');
    return;
  }
  agentLoopRunning = true;
  agentLoopTabId = tabId;

  try {
  // Clear debug log for new run
  DEBUG_LOG.length = 0;
  dbg(`=== AGENT LOOP START === command="${originalCommand}" actions=${initialActions.length}`);
  dbg(`Initial actions: ${JSON.stringify(initialActions.map(a => a.description))}`);

  // Show the task in the bubble
  sendToTab(tabId, { action: 'bubble-set-task', task: originalCommand });

  // Transition bubble to executing state
  sendToTab(tabId, { action: 'bubble-state', state: 'executing' });

  const actionHistory: ActionHistoryEntry[] = [];
  let currentActions = initialActions;
  let iteration = 0;

  // Reset cancel flag at start of each agent loop run
  agentLoopCancelled = false;

  while (iteration < MAX_AGENT_ITERATIONS) {
    iteration++;
    dbg(`--- Iteration ${iteration}/${MAX_AGENT_ITERATIONS} --- batch=${currentActions.length} actions`);

    // Check for user cancellation at start of each outer iteration
    if (agentLoopCancelled) {
      agentLoopCancelled = false;
      sendAgentDone(tabId, actionHistory, 'Cancelled');
      return;
    }

    // Execute ONLY the first action, then re-observe with fresh DOM.
    const step = currentActions[0];
    dbg(`Action: ${step.action} — "${step.description}" selector=${step.selector || 'none'}`);

    // Show intent in bubble
    sendToTab(tabId, {
      action: 'bubble-step',
      stepName: step.description,
      stepIndex: actionHistory.length + 1,
      totalSteps: 0,
    });

    // Execute the action
    const endActionTimer = dbgTimer(`Execute: ${step.action} "${step.description}"`);
    let result: { ok: boolean; summary: string; error?: string } | null = null;
    try {
      result = await chrome.tabs.sendMessage(tabId, {
        action: 'execute-action',
        actionType: step.action,
        selector: step.selector,
        value: step.value,
        url: step.url,
        direction: step.direction,
        description: step.description,
      });
    } catch {
      // Content script destroyed by navigation — wait for new page
      dbg('Content script unreachable — waiting for page reload...');
      await new Promise(r => setTimeout(r, 2000));
      try {
        await chrome.tabs.sendMessage(tabId, { action: 'scrape-dom' });
        actionHistory.push({ description: step.description, result: 'Page navigated (action triggered navigation)' });
        sendToTab(tabId, { action: 'bubble-set-task', task: originalCommand });
        sendToTab(tabId, { action: 'bubble-state', state: 'executing' });
      } catch {
        sendToTab(tabId, { action: 'pipeline-error', error: 'Lost connection to page after navigation' });
        return;
      }
    }

    if (result) {
      endActionTimer();
      dbg(`Result: ok=${result.ok} summary="${result.summary}" error=${result.error || 'none'}`);

      if (!result.ok) {
        dbg(`ACTION FAILED: ${result.error} — will retry with fresh DOM`);
        sendToTab(tabId, {
          action: 'bubble-step',
          stepName: `Failed: ${(result.error || 'Unknown').slice(0, 50)} — retrying...`,
          stepIndex: actionHistory.length + 1,
          totalSteps: 0,
        });
        actionHistory.push({
          description: step.description,
          result: `FAILED: ${result.error}. Try a different selector or approach.`,
        });
      } else {
        // Success — show result, speak short phrase, and record
        sendToTab(tabId, {
          action: 'bubble-step',
          stepName: result.summary,
          stepIndex: actionHistory.length + 1,
          totalSteps: 0,
        });
        actionHistory.push({ description: step.description, result: result.summary });

        // Speak short action phrase — use Nova's "speak" field if available, else generate from result
        const speakText = (step as any).speak || shortSpeak(result.summary);
        sendToTab(tabId, { action: 'tts-summary', summary: speakText });
      }

      // Navigate actions need special handling — wait for new page to load
      if (step.action === 'navigate' && result.ok) {
        dbg(`NAVIGATE: waiting for page to load... url=${step.url}`);
        sendToTab(tabId, { action: 'bubble-state', state: 'understanding', label: 'Navigating...' });
        const endNavTimer = dbgTimer('Navigate: page load');
        await new Promise(r => setTimeout(r, 3000));
        let pageReady = false;
        for (let attempt = 0; attempt < 10; attempt++) {
          try {
            await chrome.tabs.sendMessage(tabId, { action: 'scrape-dom' });
            pageReady = true;
            break;
          } catch {
            await new Promise(r => setTimeout(r, 1000));
          }
        }
        if (!pageReady) {
          dbg('NAVIGATE FAILED: page never loaded');
          sendToTab(tabId, { action: 'pipeline-error', error: 'Page failed to load' });
          return;
        }
        endNavTimer();
        sendToTab(tabId, { action: 'bubble-set-task', task: originalCommand });
        sendToTab(tabId, { action: 'bubble-state', state: 'executing' });
        sendToTab(tabId, { action: 'bubble-step', stepName: `Navigated to ${step.url}`, stepIndex: actionHistory.length, totalSteps: 0 });
        dbg('Navigate complete. Waiting for page content...');
        sendToTab(tabId, { action: 'bubble-state', state: 'understanding', label: 'Loading page content...' });
        await waitForDomContent(tabId, 8000);
      }
    }

    // Check for cancellation
    if (agentLoopCancelled) {
      agentLoopCancelled = false;
      sendAgentDone(tabId, actionHistory, 'Cancelled');
      return;
    }

    // Wait for DOM to settle after action
    if (step.action !== 'navigate') {
      await waitForDomStable(tabId, 1500, 200);
    }

    // Re-observe the page with fresh DOM after every action
    dbg('Re-observing page...');
    const endSettleTimer = dbgTimer('DOM settle + content wait');
    await waitForDomStable(tabId, 2000, 250);
    endSettleTimer();

    // Re-capture screenshot of the updated page
    const endScreenTimer = dbgTimer('Screenshot capture');
    let newScreenshot: string;
    try {
      newScreenshot = await captureScreenshot(tabId);
    } catch {
      // Cannot re-observe — treat as done
      console.warn('[ScreenSense][loop] Could not capture screenshot for re-observation, treating as done');
      sendAgentDone(tabId, actionHistory);
      return;
    }

    endScreenTimer();

    // Re-scrape DOM — wait for meaningful content (handles AJAX-heavy pages)
    const endDomTimer = dbgTimer('DOM content wait');
    let domSnapshot: object = {};
    try {
      domSnapshot = await waitForDomContent(tabId, 5000);
    } catch {
      dbg('WARNING: DOM content wait failed entirely');
    }
    endDomTimer();
    const domKeys = domSnapshot ? Object.keys(domSnapshot) : [];
    const domButtonCount = (domSnapshot as any)?.buttons?.length || 0;
    const domInputCount = (domSnapshot as any)?.inputs?.length || 0;
    const domLinkCount = (domSnapshot as any)?.links?.length || 0;
    const domUrl = (domSnapshot as any)?.url || 'unknown';
    dbg(`DOM snapshot: url=${domUrl} keys=${domKeys.length} buttons=${domButtonCount} inputs=${domInputCount} links=${domLinkCount}`);
    if (domKeys.length === 0) {
      dbg('WARNING: DOM snapshot is EMPTY — content script may have returned before page loaded');
    }

    // Show re-evaluation progress in the bubble
    sendToTab(tabId, {
      action: 'bubble-state',
      state: 'understanding',
      label: `Re-evaluating... (${iteration}/${MAX_AGENT_ITERATIONS})`,
    });

    // Ask Nova what to do next based on the updated page
    const endNovaTimer = dbgTimer('Nova /task/continue call');
    let continueResult: TaskResponse;
    try {
      continueResult = await sendTaskContinue(originalCommand, actionHistory, newScreenshot, domSnapshot);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Agent loop failed to continue';
      sendToTab(tabId, { action: 'pipeline-error', error: msg });
      return;
    }

    // Check for cancellation immediately after in-flight fetch returns
    if (agentLoopCancelled) {
      agentLoopCancelled = false;
      sendAgentDone(tabId, actionHistory, 'Cancelled');
      return;
    }

    endNovaTimer();
    dbg(`Nova response: type=${continueResult.type} reasoning="${continueResult.reasoning || 'none'}" actions=${continueResult.actions?.length || 0}`);
    if (continueResult.actions) {
      dbg(`Next actions: ${JSON.stringify(continueResult.actions.map(a => a.description))}`);
    }

    // Send reasoning to bubble if present
    if (continueResult.reasoning) {
      sendToTab(tabId, { action: 'bubble-reasoning', text: continueResult.reasoning });
    }

    // Evaluate Nova's response
    if (continueResult.type === 'done') {
      // Task complete — speak the model's summary if available
      const doneSummary = continueResult.summary || 'All done.';
      sendToTab(tabId, { action: 'tts-summary', summary: doneSummary });
      sendAgentDone(tabId, actionHistory);
      return;
    }

    if (continueResult.type === 'answer') {
      // Model returned text instead of actions — show reasoning and retry
      const answerText = continueResult.text || '';
      sendToTab(tabId, { action: 'bubble-reasoning', text: answerText });
      // Add as reasoning to history and re-prompt for actual actions
      actionHistory.push({
        description: `Reasoning: ${answerText.substring(0, 80)}`,
        result: 'Re-prompting for actions',
      });
      // Continue the loop — the next iteration will capture fresh state and re-ask
      currentActions = [];
      continue;
    }

    if (continueResult.type === 'steps') {
      if (!continueResult.actions || continueResult.actions.length === 0) {
        // Empty steps — treat as done
        sendAgentDone(tabId, actionHistory);
        return;
      }
      // Continue the loop with the next batch of actions
      currentActions = continueResult.actions;
      sendToTab(tabId, { action: 'bubble-state', state: 'executing' });
      continue;
    }
  }

  // Max iterations reached without Nova signalling done
  sendToTab(tabId, {
    action: 'bubble-step',
    stepName: `Reached maximum iterations (${MAX_AGENT_ITERATIONS})`,
    stepIndex: actionHistory.length,
    totalSteps: 0,
  });
  sendAgentDone(tabId, actionHistory);
  } finally {
    agentLoopRunning = false;
    agentLoopTabId = null;
  }
}

async function runPipeline(tabId: number, audioBase64: string, mimeType: string): Promise<void> {
  if (pipelineRunning || agentLoopRunning) {
    sendToTab(tabId, { action: 'pipeline-error', error: 'Please wait — still processing your previous request' });
    return;
  }
  pipelineRunning = true;
  DEBUG_LOG.length = 0;
  dbg(`=== PIPELINE START === tabId=${tabId} audioLen=${audioBase64.length} mime=${mimeType}`);
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
      try {
        transcript = await transcribeAudioStreaming(audioBase64, mimeType);
        dbg(`Transcript (streaming): "${transcript}"`);
      } catch (streamErr) {
        dbg(`Streaming STT failed, falling back to batch: ${streamErr}`);
        transcript = await transcribeAudio(audioBase64, mimeType);
        dbg(`Transcript (batch): "${transcript}"`);
      }
      endTranscribe();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Couldn't catch that — try holding a bit longer";
      sendToTab(tabId, { action: 'pipeline-error', error: msg });
      currentState = 'idle';
      resolveIconState();
      broadcastStateChange('idle');
      return;
    }

    sendToTab(tabId, { action: 'bubble-set-task', task: transcript });
    sendToTab(tabId, { action: 'bubble-state', state: 'understanding', label: transcript });

    // Capture DOM snapshot from content script
    let domSnapshot: object = {};
    try {
      const domResponse = await chrome.tabs.sendMessage(tabId, { action: 'scrape-dom' });
      if (domResponse?.ok && domResponse.snapshot) {
        domSnapshot = domResponse.snapshot;
      }
    } catch {
      console.warn('[ScreenSense] Could not scrape DOM, proceeding without');
    }

    // Send command + screenshot + DOM to backend for Nova reasoning
    const endNova = dbgTimer('Pipeline: Nova /task call');
    let taskResult: TaskResponse;
    try {
      taskResult = await sendTask(transcript, screenshot, domSnapshot);
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

    // Send reasoning to bubble if present
    if (taskResult.reasoning) {
      sendToTab(tabId, { action: 'bubble-reasoning', text: taskResult.reasoning });
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

      // Add to conversation history
      const history = getConversation(tabId);
      history.push({ role: 'user', content: transcript });
      history.push({ role: 'assistant', content: answerText });
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

      const history = getConversation(tabId);
      history.push({ role: 'user', content: transcript });
      history.push({ role: 'assistant', content: stepsText });
      while (history.length > MAX_CONVERSATION_TURNS * 2) {
        history.shift();
        history.shift();
      }
      sendToTab(tabId, { action: 'conversation-info', info: getConversationInfo(tabId) });

      // Execute steps via agent loop (re-observes page after each batch)
      await runAgentLoop(tabId, transcript, taskResult.actions);
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
  if (pipelineRunning || agentLoopRunning) {
    sendToTab(tabId, { action: 'pipeline-error', error: 'Please wait — still processing your previous request' });
    return;
  }
  pipelineRunning = true;
  currentState = 'processing';
  broadcastStateChange('processing');

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
    let domSnapshot: object = {};
    try {
      const domResponse = await chrome.tabs.sendMessage(tabId, { action: 'scrape-dom' });
      if (domResponse?.ok && domResponse.snapshot) {
        domSnapshot = domResponse.snapshot;
      }
    } catch {
      console.warn('[ScreenSense] Could not scrape DOM for follow-up, proceeding without');
    }

    // Send command + screenshot + DOM to backend for Nova reasoning
    let taskResult: TaskResponse;
    try {
      taskResult = await sendTask(text, screenshot, domSnapshot);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Something went wrong — give it another try';
      sendToTab(tabId, { action: 'pipeline-error', error: msg });
      return;
    }

    // Send reasoning to bubble if present
    if (taskResult.reasoning) {
      sendToTab(tabId, { action: 'bubble-reasoning', text: taskResult.reasoning });
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

      const history = getConversation(tabId);
      history.push({ role: 'user', content: text });
      history.push({ role: 'assistant', content: answerText });
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

      const history = getConversation(tabId);
      history.push({ role: 'user', content: text });
      history.push({ role: 'assistant', content: stepsText });
      while (history.length > MAX_CONVERSATION_TURNS * 2) {
        history.shift();
        history.shift();
      }
      sendToTab(tabId, { action: 'conversation-info', info: getConversationInfo(tabId) });

      // Execute steps via agent loop (re-observes page after each batch)
      await runAgentLoop(tabId, text, taskResult.actions);
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
  if (agentLoopTabId !== null && tabId === agentLoopTabId) {
    agentLoopCancelled = true;
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
      if (agentLoopRunning) return;
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
          // "done" from /transcribe means transcript is ready — next stage is understanding
          // Don't send 'done' state here — understanding comes from /task
          break;
        case 'understanding':
          sendToTab(tabId, { action: 'bubble-state', state: 'understanding' });
          break;
        case 'task_complete':
          // Don't send 'done' yet — the pipeline will send answer/steps content first,
          // then 'done' after content delivery is complete
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

// ─── Message Handling ───

chrome.runtime.onMessage.addListener(
  (
    message: MessageType & { target?: string },
    sender: chrome.runtime.MessageSender,
    sendResponse: (response?: unknown) => void
  ) => {
    // Ignore messages meant for offscreen document
    if (message.target === 'offscreen') return false;

    switch (message.action) {
      case 'shortcut-hold':
        console.log('[ScreenSense][SW] Received shortcut-hold');
        currentState = 'listening';
        recordingTabId = sender.tab?.id ?? null;
        swAmpLogged = false;
        updateToolbarIcon('recording');
        broadcastStateChange(currentState);
        // Tell the content script in this tab to show the listening bubble.
        // This is the reliable path — the custom DOM event only works when the
        // shortcut fires in the top frame, but this message reaches the top
        // frame's onMessage listener regardless of which frame sent it.
        if (recordingTabId) {
          sendToTab(recordingTabId, { action: 'start-listening' });
        }
        // Start recording via offscreen document.
        // Store the promise so stop-recording can await it (prevents the race
        // condition where stop arrives before the offscreen doc exists).
        recordingStartedPromise = ensureOffscreen().then(() => {
          console.log('[ScreenSense][SW] Sending start-recording to offscreen');
          return chrome.runtime.sendMessage({ target: 'offscreen', action: 'start-recording' }).catch(() => {});
        }).then(() => {
          console.log('[ScreenSense][SW] start-recording message sent successfully');
        }).catch((err) => {
          console.error('[ScreenSense][SW] Failed to create offscreen document:', err);
        });
        sendResponse({ ok: true, state: currentState });
        break;

      case 'shortcut-release': {
        console.log('[ScreenSense][SW] Received shortcut-release');
        currentState = 'processing';
        broadcastStateChange(currentState);
        pendingTabId = sender.tab?.id ?? recordingTabId;
        // Tell the content script to transition out of listening state immediately
        if (pendingTabId) {
          sendToTab(pendingTabId, { action: 'bubble-state', state: 'transcribing' });
        }
        // Wait for the recording to have actually started before sending stop.
        // This prevents the race condition where stop-recording arrives before
        // the offscreen document exists or before start-recording was sent.
        const startPromise = recordingStartedPromise || Promise.resolve();
        startPromise.then(() => {
          console.log('[ScreenSense][SW] Sending stop-recording to offscreen');
          chrome.runtime.sendMessage({ target: 'offscreen', action: 'stop-recording' }).catch((err) => {
            console.error('[ScreenSense][SW] Failed to send stop-recording:', err);
          });
        });
        recordingStartedPromise = null;
        sendResponse({ ok: true, state: currentState });
        break;
      }

      case 'offscreen-amplitude' as string: {
        // Forward amplitude data to the recording tab's content script for waveform
        const ampData = (message as any).data;
        if (recordingTabId) {
          if (!swAmpLogged) {
            console.log('[ScreenSense][SW] forwarding amplitude to tab', recordingTabId, 'dataLen=', ampData?.length, 'first8=', ampData?.slice(0, 8));
            swAmpLogged = true;
          }
          chrome.tabs.sendMessage(recordingTabId, {
            action: 'amplitude-data',
            data: ampData,
          }).catch(() => {});
        } else {
          console.warn('[ScreenSense][SW] amplitude received but recordingTabId is null');
        }
        break;
      }

      case 'offscreen-ready' as string:
        console.log('[ScreenSense][SW] Offscreen document script loaded');
        if (offscreenReadyResolve) {
          offscreenReadyResolve();
          offscreenReadyResolve = null;
        }
        break;

      case 'offscreen-started' as string:
        console.log('[ScreenSense][SW] Offscreen recording started');
        break;

      case 'offscreen-recording-complete' as string: {
        const msg = message as any;
        console.log('[ScreenSense][SW] Offscreen recording complete, audioBase64 length:', msg.audioBase64?.length, 'mimeType:', msg.mimeType, 'pendingTabId:', pendingTabId);
        const tabId = pendingTabId;
        pendingTabId = null;
        if (tabId && msg.audioBase64) {
          console.log('[ScreenSense][SW] Calling runPipeline with tabId:', tabId);
          runPipeline(tabId, msg.audioBase64, msg.mimeType);
        } else {
          console.error('[ScreenSense][SW] Cannot run pipeline: tabId=', tabId, 'hasAudio=', !!msg.audioBase64);
        }
        break;
      }

      case 'offscreen-error' as string:
        console.error('[ScreenSense] Offscreen error:', (message as any).error);
        if (pendingTabId) {
          sendToTab(pendingTabId, { action: 'pipeline-error', error: (message as any).error });
        }
        currentState = 'idle';
        resolveIconState();
        broadcastStateChange('idle');
        break;

      case 'elevenlabs-tts' as string: {
        // Proxy ElevenLabs TTS through service worker to avoid page CSP blocking
        const ttsMsg = message as any;
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
      }

      case 'capture-screenshot':
        captureScreenshot(sender.tab?.id).then((dataUrl) => {
          sendResponse({ ok: true, dataUrl });
        }).catch((err) => sendResponse({ ok: false, error: String(err) }));
        return true;

      case 'follow-up':
        if (sender.tab?.id) {
          runFollowUp(sender.tab.id, (message as any).text);
        }
        sendResponse({ ok: true });
        break;

      case 'cancel-agent-loop':
        agentLoopCancelled = true;
        sendResponse({ ok: true });
        break;

      case 'clear-conversation':
        if (sender.tab?.id) {
          clearConversation(sender.tab.id);
          sendToTab(sender.tab.id, {
            action: 'conversation-info',
            info: { turns: 0, maxTurns: MAX_CONVERSATION_TURNS },
          });
        }
        sendResponse({ ok: true });
        break;

      case 'get-conversation-info':
        if (sender.tab?.id) {
          sendResponse({ ok: true, info: getConversationInfo(sender.tab.id) });
        } else {
          sendResponse({ ok: true, info: { turns: 0, maxTurns: MAX_CONVERSATION_TURNS } });
        }
        break;

      case 'get-state':
        sendResponse({ ok: true, state: currentState });
        break;

      case 'open-welcome':
        openWelcomeTab();
        sendResponse({ ok: true });
        break;

      case 'check-mic-permission':
        sendResponse({ ok: true });
        break;

      default:
        sendResponse({ ok: false, error: 'Unknown action' });
    }

    return false;
  }
);
