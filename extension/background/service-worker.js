/**
 * service-worker.js — MV3 Service Worker
 *
 * Acts as the message router between popup ↔ content scripts ↔ backend.
 * All chrome.tabs / chrome.scripting calls must happen here (not in popup).
 */

let BACKEND = 'https://rewrite-climatic-shredder.ngrok-free.dev';
if (typeof chrome !== 'undefined' && chrome?.storage?.local) {
  chrome.storage.local.get(['backendUrl'], (res) => {
    if (res?.backendUrl) BACKEND = res.backendUrl.replace(/\/+$/, '');
  });
}

// ── Message Handler ───────────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'EXTRACT_FORM') {
    handleExtract(sendResponse);
    return true; // keep channel open for async response
  }

  if (message.type === 'FILL_FORM') {
    handleFill(message.payload, sendResponse);
    return true;
  }

  if (message.type === 'OPEN_PANEL') {
    handleOpenPanel(sendResponse);
    return true;
  }
});

// ── Extract Form ──────────────────────────────────────────────────────────────
async function handleExtract(sendResponse) {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) throw new Error('No active tab found');

    // Inject extractor and run it
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => window.__LWP_extractForm?.(),
    });

    const schema = results?.[0]?.result;
    if (!schema) throw new Error('Extractor returned no data. Is extractor.js injected?');

    // POST schema to backend
    const res = await fetch(`${BACKEND}/api/form-schema`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(schema),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail ?? `Backend returned ${res.status}`);
    }

    const saved = await res.json();
    sendResponse({ success: true, schema: saved.schema ?? schema });

  } catch (err) {
    console.error('[LWP service-worker] Extract error:', err);
    sendResponse({ success: false, error: err.message });
  }
}

// ── Fill Form ─────────────────────────────────────────────────────────────────
async function handleFill(autofillData, sendResponse) {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) throw new Error('No active tab found');

    // Forward autofill payload to the filler content script
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: (data) => window.__LWP_fillForm?.(data),
      args: [autofillData],
    });

    const result = results?.[0]?.result ?? { filled: 0, total: 0 };
    sendResponse({ success: true, ...result });

  } catch (err) {
    console.error('[LWP service-worker] Fill error:', err);
    sendResponse({ success: false, error: err.message });
  }
}

// ── Open Panel ────────────────────────────────────────────────────────────────
async function handleOpenPanel(sendResponse) {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) throw new Error('No active tab');

    const url = tab.url || '';
    if (!url.match(/^https:\/\/docs\.google\.com\/forms\//)) {
      throw new Error('Please navigate to a Google Form first.');
    }

    // Inject the panel script into the active tab
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ['content/panel.js'],
    });

    sendResponse({ success: true });
  } catch (err) {
    console.error('[LWP] Open panel error:', err);
    sendResponse({ success: false, error: err.message });
  }
}

// ── Install / Startup Logging ─────────────────────────────────────────────────
chrome.runtime.onInstalled.addListener(() => {
  console.log('[LWP] Extension installed/updated. Backend expected at', BACKEND);
});
