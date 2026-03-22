/**
 * Agent reasoning loop — executes Nova-generated action plans one step at a
 * time, re-observing the page between each action.
 *
 * Extracted from service-worker.ts as a pure-refactor.
 */

import { DomSnapshot } from '../shared/types';
import { captureScreenshot } from './screenshot';
import { sendTaskContinue, TaskResponse, ActionHistoryEntry } from './api/backend-client';

// Re-export for convenience
export type { ActionHistoryEntry } from './api/backend-client';

const MAX_AGENT_ITERATIONS = 25;

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
export function getDebugLog(): string {
  return DEBUG_LOG.join('\n');
}

/** Clear the debug log (called at the start of a new pipeline run) */
export function clearDebugLog(): void {
  DEBUG_LOG.length = 0;
}

/** Write a debug line (exposed so the pipeline orchestrator can log too) */
export { dbg, dbgTimer };

// Expose globally for console access
(globalThis as Record<string, unknown>).__screensenseDebugLog = getDebugLog;

// ─── Helpers ───

function sendToTab(tabId: number, message: object): void {
  chrome.tabs.sendMessage(tabId, message).catch(() => {
    // Content script may not be loaded in this tab — ignore
  });
}

/** Convert an action result to a short 3-7 word TTS phrase */
export function shortSpeak(result: string): string {
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

export async function waitForDomStable(tabId: number, timeout = 2000, settleMs = 300): Promise<boolean> {
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
export async function waitForDomContent(tabId: number, maxWaitMs = 8000): Promise<Partial<DomSnapshot>> {
  const start = Date.now();
  let lastSnapshot: Partial<DomSnapshot> = {};
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

// ─── Agent Loop Context ───

/** Mutable state shared between the orchestrator and the agent loop. */
export interface AgentLoopState {
  agentLoopCancelled: boolean;
  agentLoopRunning: boolean;
  agentLoopTabId: number | null;
}

// ─── Agent Loop ───

export async function runAgentLoop(
  tabId: number,
  originalCommand: string,
  initialActions: TaskResponse['actions'],
  state: AgentLoopState,
): Promise<void> {
  if (!initialActions || initialActions.length === 0) {
    sendToTab(tabId, { action: 'bubble-state', state: 'done' });
    return;
  }

  // Guard against concurrent agent loops
  if (state.agentLoopRunning) {
    console.warn('[ScreenSense][loop] Agent loop already running, skipping');
    return;
  }
  state.agentLoopRunning = true;
  state.agentLoopTabId = tabId;

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
  state.agentLoopCancelled = false;

  while (iteration < MAX_AGENT_ITERATIONS) {
    iteration++;
    dbg(`--- Iteration ${iteration}/${MAX_AGENT_ITERATIONS} --- batch=${currentActions.length} actions`);

    // Check for user cancellation at start of each outer iteration
    if (state.agentLoopCancelled) {
      state.agentLoopCancelled = false;
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
        const speakText = step.speak || shortSpeak(result.summary);
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
    if (state.agentLoopCancelled) {
      state.agentLoopCancelled = false;
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
    let domSnapshot: Partial<DomSnapshot> = {};
    try {
      domSnapshot = await waitForDomContent(tabId, 5000);
    } catch {
      dbg('WARNING: DOM content wait failed entirely');
    }
    endDomTimer();
    const domKeys = domSnapshot ? Object.keys(domSnapshot) : [];
    const domButtonCount = domSnapshot?.buttons?.length || 0;
    const domInputCount = domSnapshot?.inputs?.length || 0;
    const domLinkCount = domSnapshot?.links?.length || 0;
    const domUrl = domSnapshot?.url || 'unknown';
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
    if (state.agentLoopCancelled) {
      state.agentLoopCancelled = false;
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
    state.agentLoopRunning = false;
    state.agentLoopTabId = null;
  }
}
