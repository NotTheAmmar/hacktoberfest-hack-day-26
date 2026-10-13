/**
 * popup.js — Extension popup controller
 *
 * Implements Kaggle Backend Schema:
 *   1. POST /api/v1/parse-fields  { url: currentTabUrl }
 *   2. POST /api/v1/process-audio { audio_file, fields_json }
 *   3. Autofill Google Form via entry.XXXX mapping
 *      Option A: Open Prefilled Form URL
 *      Option B: Direct DOM Autofill
 * Also supports launching the in-page Floating Interview Panel.
 */

// Default backend: uses chrome.storage or fallback to localhost
let currentBackendUrl = 'http://localhost:8000';

// ── DOM refs ──────────────────────────────────────────────────────────────────
const tabPill            = document.getElementById('tab-pill');
const tabPillText        = document.getElementById('tab-pill-text');
const btnToggleSettings  = document.getElementById('btn-toggle-settings');
const sectionSettings    = document.getElementById('section-settings');
const backendUrlInput    = document.getElementById('backend-url-input');
const btnSaveUrl         = document.getElementById('btn-save-url');
const backendDot         = document.getElementById('backend-dot');
const backendTextEl      = document.getElementById('backend-text');
const btnRetryBackend    = document.getElementById('btn-retry-backend');
const formTitleText      = document.getElementById('form-title-text');
const formQuestionCount  = document.getElementById('form-question-count');

const btnParseFields     = document.getElementById('btn-parse-fields');
const btnRecordAudio     = document.getElementById('btn-record-audio');
const micLabel           = document.getElementById('mic-label');
const btnOpenPanel       = document.getElementById('btn-open-panel');
const btnFill            = document.getElementById('btn-fill');
const btnPrefillUrl      = document.getElementById('btn-prefill-url');

const resultBox          = document.getElementById('result-box');
const transcriptPreview  = document.getElementById('transcript-preview');
const mappedPreview      = document.getElementById('mapped-preview');

const fillProgress       = document.getElementById('fill-progress');
const progressFill       = document.getElementById('progress-fill');
const progressText       = document.getElementById('progress-text');
const logEl              = document.getElementById('log');

// ── Helpers: status UI ────────────────────────────────────────────────────────
function setTabPill(state, text) {
  tabPill.className = `tab-pill tab-pill--${state}`;
  tabPillText.textContent = text;
}

function setBackendDot(state, text) {
  if (backendDot) backendDot.dataset.state = state;
  if (backendTextEl) backendTextEl.textContent = text;
}

// ── State ─────────────────────────────────────────────────────────────────────
let activeTabUrl   = '';
let isGoogleForm   = false;
let backendHealthy = false;
let parsedFields   = [];          // [{ id: "entry.123", label: "Full Name", type, options? }]
let mappedEntries  = {};          // { "entry.123": "Value" }

let mediaRecorder  = null;
let audioChunks    = [];
let isRecording    = false;

// ── Logging ───────────────────────────────────────────────────────────────────
function log(msg, type = 'info') {
  const entry = document.createElement('div');
  entry.className = `log-entry ${type}`;
  entry.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`;
  logEl.prepend(entry);
  while (logEl.children.length > 25) logEl.removeChild(logEl.lastChild);
}

// ── Button States ─────────────────────────────────────────────────────────────
function updateButtons() {
  btnParseFields.disabled = !(isGoogleForm && backendHealthy);
  btnRecordAudio.disabled = !(parsedFields.length > 0 && backendHealthy);
  if (btnOpenPanel) {
    btnOpenPanel.disabled = !isGoogleForm;
  }
  const hasMapped = isGoogleForm && Object.keys(mappedEntries).length > 0;
  btnFill.disabled        = !hasMapped;
  if (btnPrefillUrl) {
    btnPrefillUrl.disabled = !hasMapped;
  }
}

// ── Check active tab ──────────────────────────────────────────────────────────
async function checkActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) return;

  activeTabUrl = tab.url || '';
  if (activeTabUrl.match(/^https:\/\/(docs\.google\.com\/forms|forms\.gle)\//)) {
    isGoogleForm = true;
    setTabPill('ok', 'Form detected');
    const title = tab.title || 'Google Form';
    formTitleText.textContent = title.replace(/\s*[-–]\s*Google Forms?\s*$/i, '').trim();
  } else {
    isGoogleForm = false;
    setTabPill('none', 'No form here');
    formTitleText.textContent = 'No form on this tab';
    formQuestionCount.textContent = '0 fields';
  }
  updateButtons();
}

// ── Check backend health ──────────────────────────────────────────────────────
async function checkBackend() {
  setBackendDot('checking', 'Testing connection…');

  try {
    const baseUrl = currentBackendUrl.replace(/\/+$/, '');
    const headers = { 'ngrok-skip-browser-warning': 'true' };
    const res = await fetch(`${baseUrl}/api/health`, { headers, signal: AbortSignal.timeout(3500) }).catch(() => null);

    if (res && res.ok) {
      backendHealthy = true;
      setBackendDot('ok', `Connected — ${baseUrl}`);
    } else {
      const ping = await fetch(baseUrl, { method: 'HEAD', headers, signal: AbortSignal.timeout(3500) }).catch(() => null);
      if (ping || res) {
        backendHealthy = true;
        setBackendDot('ok', `Reachable — ${baseUrl}`);
      } else {
        throw new Error('Connection failed');
      }
    }
  } catch {
    backendHealthy = false;
    setBackendDot('error', 'Cannot reach backend');
    log('Could not connect to backend — check URL.', 'error');
  }

  updateButtons();
}

// ── Step 1: Parse Form Fields ─────────────────────────────────────────────────
btnParseFields.addEventListener('click', async () => {
  btnParseFields.disabled = true;
  const origLabel = btnParseFields.querySelector('.action-btn__label');
  origLabel.textContent = 'Parsing…';
  log('Requesting /api/v1/parse-fields for active tab…');

  const baseUrl = currentBackendUrl.replace(/\/+$/, '');

  try {
    const res = await fetch(`${baseUrl}/api/v1/parse-fields`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'ngrok-skip-browser-warning': 'true',
      },
      body: JSON.stringify({ url: activeTabUrl }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || `Parse failed: HTTP ${res.status}`);
    }

    const data = await res.json();
    if (data.status === 'success' && Array.isArray(data.fields)) {
      parsedFields = data.fields;
      formQuestionCount.textContent = `${parsedFields.length} fields`;
      log(`Parsed ${parsedFields.length} form fields`, 'success');
      chrome.storage.local.set({ lastParsedFields: parsedFields });
    } else {
      throw new Error('Invalid response from /parse-fields');
    }
  } catch (err) {
    log(`Parse error: ${err.message}`, 'error');
  } finally {
    origLabel.textContent = 'Parse Form Fields';
    updateButtons();
  }
});

// ── Open Floating Interview Panel (injected into the Google Form page) ────────
if (btnOpenPanel) {
  btnOpenPanel.addEventListener('click', async () => {
    btnOpenPanel.disabled = true;
    log('Injecting floating interview panel on the form…');

    try {
      const res = await chrome.runtime.sendMessage({ type: 'OPEN_PANEL' });
      if (res?.success) {
        log('Panel opened on the form page ✓', 'success');
        window.close(); // close popup so panel is visible
      } else {
        log(`Failed to open panel: ${res?.error ?? 'unknown error'}`, 'error');
        btnOpenPanel.disabled = false;
      }
    } catch (err) {
      log(`Panel error: ${err.message}`, 'error');
      btnOpenPanel.disabled = false;
    }
  });
}

// ── Step 2: Record Audio via MediaRecorder & Process via /process-audio ───────
btnRecordAudio.addEventListener('click', async () => {
  if (isRecording) {
    stopRecording();
  } else {
    await startRecording();
  }
});

async function startRecording() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    audioChunks = [];
    mediaRecorder = new MediaRecorder(stream);

    mediaRecorder.ondataavailable = e => {
      if (e.data.size > 0) audioChunks.push(e.data);
    };

    mediaRecorder.onstop = async () => {
      stream.getTracks().forEach(track => track.stop());
      const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });

      // Guard: audio must be >= 1 KB / ~2+ seconds long
      if (audioBlob.size < 1000) {
        log('Audio too short (< 1 KB). Please speak for at least 2 seconds.', 'error');
        micLabel.textContent = 'Record Audio Response';
        btnRecordAudio.classList.remove('recording');
        btnRecordAudio.disabled = false;
        updateButtons();
        return;
      }

      await processAudioWithKaggle(audioBlob);
    };

    mediaRecorder.start();
    isRecording = true;
    btnRecordAudio.classList.add('recording');
    micLabel.textContent = 'Recording… Click to Stop & Send';
    log('Recording audio… speak your answers clearly.', 'info');
  } catch (err) {
    log(`Microphone access error: ${err.message}`, 'error');
  }
}

function stopRecording() {
  if (mediaRecorder && mediaRecorder.state !== 'inactive') {
    mediaRecorder.stop();
  }
  isRecording = false;
  btnRecordAudio.classList.remove('recording');
  micLabel.textContent = 'Processing Whisper + Gemma…';
  btnRecordAudio.disabled = true;
}

async function processAudioWithKaggle(audioBlob) {
  log('Sending audio to /api/v1/process-audio…', 'info');
  const baseUrl = currentBackendUrl.replace(/\/+$/, '');

  const formData = new FormData();
  formData.append('audio_file', audioBlob, 'recording.webm');
  formData.append('fields_json', JSON.stringify(parsedFields));

  try {
    const res = await fetch(`${baseUrl}/api/v1/process-audio`, {
      method: 'POST',
      headers: {
        'ngrok-skip-browser-warning': 'true',
      },
      body: formData,
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || `Audio processing failed with HTTP ${res.status}`);
    }

    const data = await res.json();
    if (data.status === 'success') {
      mappedEntries = data.mapped_entries || {};
      const transcript = data.transcript || '';

      resultBox.classList.remove('hidden');
      transcriptPreview.textContent = `"${transcript}"`;
      mappedPreview.textContent = JSON.stringify(mappedEntries, null, 2);

      log(`Transcribed: "${transcript.substring(0, 50)}…"`, 'success');
      log(`Mapped ${Object.keys(mappedEntries).length} entries with Gemma!`, 'success');

      chrome.storage.local.set({ lastMappedEntries: mappedEntries });
    } else {
      throw new Error('Unexpected response format from /process-audio');
    }
  } catch (err) {
    log(`Process error: ${err.message}`, 'error');
  } finally {
    micLabel.textContent = 'Record Audio Response';
    btnRecordAudio.disabled = false;
    updateButtons();
  }
}

// ── Step 3A: Option B — Direct DOM Autofill via Content Script ────────────────
btnFill.addEventListener('click', async () => {
  btnFill.disabled = true;
  fillProgress.classList.remove('hidden');
  progressFill.style.width = '30%';
  log('Autofilling Google Form fields directly…', 'info');

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) throw new Error('No active tab found');

    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: (entries) => window.__LWP_fillForm?.({ mapped_entries: entries }),
      args: [mappedEntries],
    });

    const res = results?.[0]?.result || { filled: 0, total: Object.keys(mappedEntries).length };
    progressFill.style.width = '100%';
    progressText.textContent = `Filled ${res.filled} / ${res.total} fields`;
    log(`Autofill complete: ${res.filled} fields filled!`, 'success');
  } catch (err) {
    log(`Autofill error: ${err.message}`, 'error');
  } finally {
    updateButtons();
  }
});

// ── Step 3B: Option A — Open Prefilled Form URL Redirection ───────────────────
if (btnPrefillUrl) {
  btnPrefillUrl.addEventListener('click', () => {
    if (!activeTabUrl || Object.keys(mappedEntries).length === 0) return;
    try {
      const cleanUrl = new URL(activeTabUrl.replace('/edit', '/viewform'));
      Object.entries(mappedEntries).forEach(([entryId, value]) => {
        if (value) cleanUrl.searchParams.set(entryId, String(value));
      });
      chrome.tabs.create({ url: cleanUrl.toString() });
      log('Opened prefilled form URL in a new tab!', 'success');
    } catch (e) {
      log(`Error generating URL: ${e.message}`, 'error');
    }
  });
}

// ── Settings Toggle & URL Save ───────────────────────────────────────────────
if (btnToggleSettings && sectionSettings) {
  btnToggleSettings.addEventListener('click', () => {
    sectionSettings.classList.toggle('hidden');
    if (!sectionSettings.classList.contains('hidden') && backendUrlInput) {
      backendUrlInput.focus();
      backendUrlInput.select();
    }
  });
}

function saveBackendUrl() {
  const val = backendUrlInput ? backendUrlInput.value.trim() : '';
  if (val) {
    currentBackendUrl = val;
    chrome.storage.local.set({ backendUrl: val });
    log(`Saved backend URL: ${val}`);
    checkBackend();
  }
}

if (btnSaveUrl) {
  btnSaveUrl.addEventListener('click', saveBackendUrl);
}

if (backendUrlInput) {
  backendUrlInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      saveBackendUrl();
    }
  });
}

if (btnRetryBackend) {
  btnRetryBackend.addEventListener('click', () => checkBackend());
}

// ── Init ──────────────────────────────────────────────────────────────────────
(async () => {
  const saved = await chrome.storage.local.get(['backendUrl', 'lastParsedFields', 'lastMappedEntries']);
  if (saved.backendUrl) {
    currentBackendUrl = saved.backendUrl;
  }
  if (backendUrlInput) {
    backendUrlInput.value = currentBackendUrl;
  }

  if (saved.lastParsedFields) {
    parsedFields = saved.lastParsedFields;
    formQuestionCount.textContent = `${parsedFields.length} fields`;
  }
  if (saved.lastMappedEntries) {
    mappedEntries = saved.lastMappedEntries;
  }

  await Promise.all([checkActiveTab(), checkBackend()]);
  if (!backendHealthy && sectionSettings) {
    sectionSettings.classList.remove('hidden');
  }
})();
