'use strict';

// Runs inside the hidden offscreen document. Captures the seller's
// microphone (not tab audio — Instagram's own broadcast page doesn't loop
// the seller's mic back through tab audio, so tabCapture would hear
// silence), cycles a fresh MediaRecorder every CHUNK_MS so each blob is a
// standalone decodable webm file, and posts each chunk to the tracker
// backend for transcription + item extraction.

const CHUNK_MS = 20000;

let capturing = false;
let stream = null;

// chrome.storage access from inside an offscreen document has proven
// unreliable in practice (throws "Cannot read properties of undefined
// (reading 'local')"), so route it through the background service worker
// via messaging instead — that's already proven to work (it's how capture
// gets started in the first place).
function storageGet(keys) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: 'STORAGE_GET', keys }, (response) => {
      resolve(response || {});
    });
  });
}
function storageSet(items) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: 'STORAGE_SET', items }, () => resolve());
  });
}

async function startCapture() {
  if (capturing) return;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (err) {
    await reportStatus({ error: 'Microphone access not granted yet — open the extension popup and click "Enable Microphone" first.', listening: false });
    return;
  }
  capturing = true;
  await reportStatus({ error: null, listening: true });
  cycleRecorder();
}

function stopCapture() {
  capturing = false;
  if (stream) {
    stream.getTracks().forEach((t) => t.stop());
    stream = null;
  }
  reportStatus({ listening: false });
}

function cycleRecorder() {
  if (!capturing || !stream) return;

  const chunks = [];
  const recorder = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' });
  recorder.ondataavailable = (e) => {
    if (e.data.size > 0) chunks.push(e.data);
  };
  recorder.onstop = () => {
    const blob = new Blob(chunks, { type: 'audio/webm' });
    if (blob.size > 2000) {
      processChunk(blob).catch((err) => reportStatus({ error: String(err && err.message || err) }));
    }
    if (capturing) cycleRecorder();
  };
  recorder.start();
  setTimeout(() => {
    if (recorder.state !== 'inactive') recorder.stop();
  }, CHUNK_MS);
}

async function processChunk(blob) {
  const { currentItem, trackerKey } = await storageGet(['currentItem', 'trackerKey']);
  if (!trackerKey) {
    await reportStatus({ error: 'No backend API key set — add it in Settings.' });
    return;
  }

  // The network request itself is relayed through background.js rather than
  // fetched directly here — after finding chrome.storage unreliable inside
  // an offscreen document, the actual fetch() is relocated too rather than
  // risking the same class of undocumented restriction.
  const arrayBuffer = await blob.arrayBuffer();
  const base64Audio = arrayBufferToBase64(arrayBuffer);

  const response = await new Promise((resolve) => {
    chrome.runtime.sendMessage(
      { type: 'UPLOAD_AUDIO_CHUNK', base64Audio, currentItem, trackerKey },
      (res) => resolve(res)
    );
  });

  if (!response || !response.ok) {
    await reportStatus({ error: response?.error || 'Backend request failed' });
    return;
  }

  const data = response.data;
  await reportStatus({ lastTranscript: data.transcript || '', lastCheckedAt: Date.now(), error: null });

  if (data.confident && data.item) {
    const name = String(data.item).trim();
    const alreadySet = currentItem?.name?.trim().toLowerCase() === name.toLowerCase();
    if (name && !alreadySet) {
      await storageSet({
        currentItem: {
          name,
          price: data.price != null ? String(data.price) : (currentItem?.price || ''),
        },
      });
    }
  }
}

function arrayBufferToBase64(buffer) {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

async function reportStatus(patch) {
  const { autoDetectStatus } = await storageGet(['autoDetectStatus']);
  await storageSet({
    autoDetectStatus: { ...(autoDetectStatus || {}), ...patch },
  });
}

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === 'OFFSCREEN_START_CAPTURE') startCapture();
  if (message?.type === 'OFFSCREEN_STOP_CAPTURE') stopCapture();
});
