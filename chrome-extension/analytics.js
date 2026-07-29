'use strict';

// ── Google Analytics 4 – Measurement Protocol ─────────────────────────────
// To activate: replace the two placeholders below with your GA4 credentials.
// 1. Go to analytics.google.com → Admin → Data Streams → your stream
// 2. Copy the Measurement ID (looks like G-XXXXXXXXXX)
// 3. Under that stream, open "Measurement Protocol API secrets" → create one
// 4. Paste both values here, then reload the extension and resubmit to the Store
const GA4_MEASUREMENT_ID = 'G-SXN6VOXTDH';
const GA4_API_SECRET     = 'cpDOTPnRQz-QmgqJwlrnWw';

const ENDPOINT = `https://www.google-analytics.com/mp/collect?measurement_id=${GA4_MEASUREMENT_ID}&api_secret=${GA4_API_SECRET}`;

function isConfigured() {
  return !GA4_MEASUREMENT_ID.includes('X') && !GA4_API_SECRET.includes('X');
}

async function getClientId() {
  return new Promise(resolve => {
    chrome.storage.local.get(['_aid'], r => {
      if (r._aid) { resolve(r._aid); return; }
      const id = crypto.randomUUID();
      chrome.storage.local.set({ _aid: id });
      resolve(id);
    });
  });
}

async function track(eventName, params = {}) {
  if (!isConfigured()) return;
  try {
    const clientId = await getClientId();
    await fetch(ENDPOINT, {
      method: 'POST',
      body: JSON.stringify({ client_id: clientId, events: [{ name: eventName, params }] })
    });
  } catch (_) {}
}

window.Analytics = { track };
