/**
 * popup.js — Extension popup controller
 *
 * Responsibilities:
 *  - Check if the active tab is a Google Form
 *  - Check backend health (localhost:8000)
 *  - Send "extract" message to the service worker → content script
 *  - Open the interview UI in a new tab
 *  - Trigger "fill" from backend autofill data
 */

const BACKEND = 'http://localhost:8000';

// ── DOM refs ──────────────────────────────────────────────────────────────────
const statusBanner    = document.getElementById('status-banner');
const statusText      = document.getElementById('status-text');
const backendIndicator= document.getElementById('backend-indicator');
const backendTextEl   = document.getElementById('backend-text');
const btnRetryBackend = document.getElementById('btn-retry-backend');
const formTitleText   = document.getElementById('form-title-text');
const formQuestionCount = document.getElementById('form-question-count');
const btnExtract      = document.getElementById('btn-extract');
const btnOpenUI       = document.getElementById('btn-open-ui');
const btnFill         = document.getElementById('btn-fill');
const fillProgress    = document.getElementById('fill-progress');
const progressFill    = document.getElementById('progress-fill');
const progressText    = document.getElementById('progress-text');
const logEl           = document.getElementById('log');

// ── State ─────────────────────────────────────────────────────────────────────
let isGoogleForm = false;
let backendOk    = false;
let schemaLoaded = false;

// ── Logging ───────────────────────────────────────────────────────────────────
function log(msg, type = 'info') {
  const entry = document.createElement('div');
  entry.className = `log-entry ${type}`;
  entry.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`;
  logEl.prepend(entry);
  // Keep only last 20 lines
  while (logEl.children.length > 20) logEl.removeChild(logEl.lastChild);
}

// ── Update button states ──────────────────────────────────────────────────────
function updateButtons() {
  btnExtract.disabled = !(isGoogleForm && backendOk);
  btnOpenUI.disabled  = !backendOk;
  btnFill.disabled    = !(isGoogleForm && backendOk && schemaLoaded);
}

// ── Check if active tab is a Google Form ─────────────────────────────────────
async function checkActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) return;

  const url = tab.url || '';
  if (url.match(/^https:\/\/docs\.google\.com\/forms\//)) {
    isGoogleForm = true;
    statusBanner.className = 'status-banner status-ok';
    statusText.textContent = 'Google Form detected';
    // Try to get form title from tab title
    const title = tab.title || 'Untitled Form';
    formTitleText.textContent = title.replace(' - Google Forms', '').trim();
  } else {
    isGoogleForm = false;
    statusBanner.className = 'status-banner status-none';
    statusText.textContent = 'No Google Form detected on this tab';
    formTitleText.textContent = '—';
    formQuestionCount.textContent = '0 questions';
  }
  updateButtons();
}

// ── Check backend health ──────────────────────────────────────────────────────
async function checkBackend() {
  backendIndicator.className = 'indicator indicator-checking';
  backendTextEl.textContent = 'Connecting to localhost:8000…';

  try {
    const res = await fetch(`${BACKEND}/api/health`, { signal: AbortSignal.timeout(3000) });
    const data = await res.json();
    backendOk = true;
    backendIndicator.className = 'indicator indicator-ok';
    backendTextEl.textContent = `Backend ready (${data.whisper_model ?? 'whisper'})`;

    // Check if a schema is already loaded
    try {
      const sr = await fetch(`${BACKEND}/api/form-schema`);
      if (sr.ok) {
        const schema = await sr.json();
        if (schema?.questions?.length) {
          schemaLoaded = true;
          formQuestionCount.textContent = `${schema.questions.length} questions`;
        }
      }
    } catch { /* no schema yet */ }

  } catch {
    backendOk = false;
    backendIndicator.className = 'indicator indicator-error';
    backendTextEl.textContent = 'Cannot reach localhost:8000';
    log('Backend unreachable — is the server running?', 'error');
  }

  updateButtons();
}

// ── Extract form ──────────────────────────────────────────────────────────────
btnExtract.addEventListener('click', async () => {
  btnExtract.disabled = true;
  btnExtract.textContent = 'Extracting…';
  log('Sending extract command…');

  try {
    const response = await chrome.runtime.sendMessage({ type: 'EXTRACT_FORM' });

    if (response?.success) {
      const schema = response.schema;
      schemaLoaded = true;
      formTitleText.textContent = schema.form_title || 'Untitled Form';
      formQuestionCount.textContent = `${schema.questions?.length ?? 0} questions`;
      log(`Extracted ${schema.questions?.length ?? 0} questions`, 'success');
    } else {
      log(`Extraction failed: ${response?.error ?? 'unknown error'}`, 'error');
    }
  } catch (err) {
    log(`Error: ${err.message}`, 'error');
  } finally {
    btnExtract.textContent = 'Extract Form';
    updateButtons();
  }
});

// ── Open Interview Panel (injected into the Google Form page) ────────────────
btnOpenUI.addEventListener('click', async () => {
  btnOpenUI.disabled = true;
  btnOpenUI.textContent = 'Opening…';
  log('Injecting interview panel on the form…');

  try {
    const res = await chrome.runtime.sendMessage({ type: 'OPEN_PANEL' });
    if (res?.success) {
      log('Panel opened on the form page ✓', 'success');
      window.close(); // close popup so panel is visible
    } else {
      log(`Failed: ${res?.error ?? 'unknown error'}`, 'error');
      btnOpenUI.disabled = false;
      btnOpenUI.textContent = 'Open Interview';
    }
  } catch (err) {
    log(`Error: ${err.message}`, 'error');
    btnOpenUI.disabled = false;
    btnOpenUI.textContent = 'Open Interview';
  }
});

// ── Fill form ─────────────────────────────────────────────────────────────────
btnFill.addEventListener('click', async () => {
  btnFill.disabled = true;
  fillProgress.classList.remove('hidden');
  log('Fetching autofill data…');

  try {
    // 1. Get validated answers from backend
    const res = await fetch(`${BACKEND}/api/autofill-data`);
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.detail ?? 'Failed to fetch autofill data');
    }
    const autofillData = await res.json();

    log(`Filling ${Object.keys(autofillData.answers ?? {}).length} fields…`);

    // 2. Send to service worker → content script
    const fillRes = await chrome.runtime.sendMessage({
      type: 'FILL_FORM',
      payload: autofillData,
    });

    if (fillRes?.success) {
      const filled = fillRes.filled ?? 0;
      const total  = fillRes.total  ?? 0;
      progressFill.style.width = '100%';
      progressText.textContent = `Filled ${filled} / ${total} fields`;
      log(`Autofill complete: ${filled}/${total} fields`, 'success');
    } else {
      throw new Error(fillRes?.error ?? 'Fill failed');
    }

  } catch (err) {
    log(`Fill error: ${err.message}`, 'error');
  } finally {
    updateButtons();
  }
});

// ── Retry backend ─────────────────────────────────────────────────────────────
btnRetryBackend.addEventListener('click', () => checkBackend());

// ── Init ──────────────────────────────────────────────────────────────────────
(async () => {
  await Promise.all([checkActiveTab(), checkBackend()]);
})();
