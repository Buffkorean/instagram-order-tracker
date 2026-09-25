'use strict';

// Routes auto-detect start/stop between the popup and the offscreen
// document. A service worker can't hold a live microphone stream itself
// (it can be killed at any time), so the actual capture + MediaRecorder
// loop lives in offscreen.js, which stays alive while actively recording.

let offscreenReady = null;

async function ensureOffscreenDocument() {
  if (offscreenReady) return offscreenReady;

  offscreenReady = (async () => {
    const existing = await chrome.runtime.getContexts({
      contextTypes: ['OFFSCREEN_DOCUMENT'],
    });
    if (existing.length > 0) return;

    await chrome.offscreen.createDocument({
      url: 'offscreen.html',
      reasons: ['USER_MEDIA'],
      justification: 'Capture microphone audio during a live session to auto-detect the item being sold.',
    });
  })();

  return offscreenReady;
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === 'START_AUTO_DETECT') {
    (async () => {
      await ensureOffscreenDocument();
      chrome.runtime.sendMessage({ type: 'OFFSCREEN_START_CAPTURE' });
      sendResponse({ ok: true });
    })();
    return true;
  }

  if (message?.type === 'STOP_AUTO_DETECT') {
    chrome.runtime.sendMessage({ type: 'OFFSCREEN_STOP_CAPTURE' });
    sendResponse({ ok: true });
    return true;
  }

  // The offscreen document's access to chrome.storage directly is
  // unreliable in practice, so it routes reads/writes through here instead
  // — the service worker always has full API access.
  if (message?.type === 'STORAGE_GET') {
    chrome.storage.local.get(message.keys).then(sendResponse);
    return true;
  }

  if (message?.type === 'STORAGE_SET') {
    chrome.storage.local.set(message.items).then(() => sendResponse({ ok: true }));
    return true;
  }
});
