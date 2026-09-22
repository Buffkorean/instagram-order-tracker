'use strict';

// Runs inside the hidden offscreen document. Captures the seller's
// microphone (not tab audio — Instagram's own broadcast page doesn't loop
// the seller's mic back through tab audio, so tabCapture would hear
// silence), cycles a fresh MediaRecorder every CHUNK_MS so each blob is a
// standalone decodable webm file, and posts each chunk to the tracker
// backend for transcription + item extraction.

const API_BASE = 'https://speaksuccess.kr';
const CHUNK_MS = 20000;

let capturing = false;
let stream = null;

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
  const { currentItem, trackerKey } = await chrome.storage.local.get(['currentItem', 'trackerKey']);
  if (!trackerKey) {
    await reportStatus({ error: 'No backend API key set — add it in Settings.' });
    return;
  }

  const form = new FormData();
  form.append('audio', blob, 'chunk.webm');
  if (currentItem) form.append('currentItem', JSON.stringify(currentItem));

  const res = await fetch(`${API_BASE}/api/live-order-tracker/detect-item`, {
    method: 'POST',
    headers: { 'x-tracker-key': trackerKey },
    body: form,
  });

  if (!res.ok) {
    await reportStatus({ error: `Backend error ${res.status}` });
    return;
  }

  const data = await res.json();
  await reportStatus({ lastTranscript: data.transcript || '', lastCheckedAt: Date.now(), error: null });

  if (data.confident && data.item) {
    const name = String(data.item).trim();
    const alreadySet = currentItem?.name?.trim().toLowerCase() === name.toLowerCase();
    if (name && !alreadySet) {
      await chrome.storage.local.set({
        currentItem: {
          name,
          price: data.price != null ? String(data.price) : (currentItem?.price || ''),
        },
      });
    }
  }
}

async function reportStatus(patch) {
  const { autoDetectStatus } = await chrome.storage.local.get(['autoDetectStatus']);
  await chrome.storage.local.set({
    autoDetectStatus: { ...(autoDetectStatus || {}), ...patch },
  });
}

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === 'OFFSCREEN_START_CAPTURE') startCapture();
  if (message?.type === 'OFFSCREEN_STOP_CAPTURE') stopCapture();
});
