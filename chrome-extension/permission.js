'use strict';

// Requesting getUserMedia from the action popup is unreliable — Chrome can
// close the popup when the permission bubble takes focus, killing the
// request before it resolves. This page is a normal, persistent tab instead,
// where the prompt reliably completes.
(async () => {
  const statusEl = document.getElementById('status');
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach((t) => t.stop());
    statusEl.textContent = 'Microphone enabled! You can close this tab and click "Auto-detect" again in the extension.';
    statusEl.className = 'ok';
    setTimeout(() => window.close(), 2500);
  } catch (err) {
    statusEl.textContent = 'Microphone access was blocked. Click the camera/mic icon in the address bar to allow it, then try again.';
    statusEl.className = 'err';
  }
})();
