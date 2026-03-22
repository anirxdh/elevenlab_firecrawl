export async function captureScreenshot(tabId?: number): Promise<string> {
  // If tabId provided, hide the overlay before capturing
  if (tabId) {
    try {
      await chrome.tabs.sendMessage(tabId, { action: 'hide-overlay' });
      // Brief delay to let the DOM update render
      await new Promise(resolve => setTimeout(resolve, 50));
    } catch {
      // Content script may not be loaded -- proceed without hiding
    }
  }

  try {
    const dataUrl = await chrome.tabs.captureVisibleTab({ format: 'png' });

    // Re-show the overlay after capture
    if (tabId) {
      await chrome.tabs.sendMessage(tabId, { action: 'show-overlay' }).catch(() => {});
    }

    return dataUrl;
  } catch (err) {
    // Re-show overlay even on error
    if (tabId) {
      await chrome.tabs.sendMessage(tabId, { action: 'show-overlay' }).catch(() => {});
    }
    throw err;
  }
}
