/**
 * popup.js — Extension popup controller
 *
 * Implements Kaggle Backend Schema:
 *   1. POST /api/v1/parse-fields  { url: currentTabUrl }
 *   2. POST /api/v1/process-audio { audio_file, fields_json }
 *   3. Autofill Google Form via entry.XXXX mapping
 * Also supports launching the in-page Floating Interview Panel.
 */

// Default backend: uses chrome.storage or fallback to localhost
let currentBackendUrl = 'http://localhost:8000';

// ── DOM refs ──────────────────────────────────────────────────────────────────
const statusBanner       = document.getElementById('status-banner');
const statusText         = document.getElementById('status-text');
const backendUrlInput    = document.getElementById('backend-url-input');
const btnSaveUrl         = document.getElementById('btn-save-url');
const backendIndicator   = document.getElementById('backend-indicator');
const backendTextEl      = document.getElementById('backend-text');
const btnRetryBackend    = document.getElementById('btn-retry-backend');
const formTitleText      = document.getElementById('form-title-text');
const formQuestionCount  = document.getElementById('form-question-count');

const btnParseFields     = document.getElementById('btn-parse-fields');
const btnRecordAudio     = document.getElementById('btn-record-audio');
const micLabel           = document.getElementById('mic-label');
const btnOpenPanel       = document.getElementById('btn-open-panel');
const btnFill            = document.getElementById('btn-fill');

const resultBox          = document.getElementById('result-box');
const transcriptPreview  = document.getElementById('transcript-preview');
const mappedPreview      = document.getElementById('mapped-preview');

const fillProgress       = document.getElementById('fill-progress');
const progressFill       = document.getElementById('progress-fill');
const progressText       = document.getElementById('progress-text');
const logEl              = document.getElementById('log');

// ── State ─────────────────────────────────────────────────────────────────────
let activeTabUrl   = '';
let isGoogleForm   = false;
let backendHealthy = false;
let parsedFields   = [];          // [{ id: "entry.123", label: "Full Name" }]
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
  btnFill.disabled        = !(isGoogleForm && Object.keys(mappedEntries).length > 0);
}

// ── Check active tab ──────────────────────────────────────────────────────────
async function checkActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) return;

  activeTabUrl = tab.url || '';
  if (activeTabUrl.match(/^https:\/\/(docs\.google\.com\/forms|forms\.gle)\//)) {
    isGoogleForm = true;
    statusBanner.className = 'status-banner status-ok';
    statusText.textContent = 'Google Form detected';
    const title = tab.title || 'Google Form';
    formTitleText.textContent = title.replace(' - Google Forms', '').trim();
  } else {
    isGoogleForm = false;
    statusBanner.className = 'status-banner status-none';
    statusText.textContent = 'No Google Form detected on active tab';
    formTitleText.textContent = '—';
    formQuestionCount.textContent = '0 fields';
  }
  updateButtons();
}

// ── Check backend health ──────────────────────────────────────────────────────
async function checkBackend() {
  backendIndicator.className = 'indicator indicator-checking';
  backendTextEl.textContent = 'Testing connection…';

  try {
    const baseUrl = currentBackendUrl.replace(/\/+$/, '');
    const res = await fetch(`${baseUrl}/api/health`, { signal: AbortSignal.timeout(3500) }).catch(() => null);
    
    if (res && res.ok) {
      backendHealthy = true;
      backendIndicator.className = 'indicator indicator-ok';
      backendTextEl.textContent = `Connected (${baseUrl})`;
    } else {
      const ping = await fetch(baseUrl, { method: 'HEAD', signal: AbortSignal.timeout(3500) }).catch(() => null);
      if (ping || res) {
        backendHealthy = true;
        backendIndicator.className = 'indicator indicator-ok';
        backendTextEl.textContent = `Endpoint reachable: ${baseUrl}`;
      } else {
        throw new Error('Connection failed');
      }
    }
  } catch {
    backendHealthy = false;
    backendIndicator.className = 'indicator indicator-error';
    backendTextEl.textContent = 'Cannot reach backend URL';
    log('Could not connect to backend. Check your ngrok or local URL.', 'error');
  }

  updateButtons();
}

// ── Step 1: Parse Form Fields ─────────────────────────────────────────────────
btnParseFields.addEventListener('click', async () => {
  btnParseFields.disabled = true;
  btnParseFields.textContent = 'Parsing fields…';
  log(`Requesting /api/v1/parse-fields for active tab…`);

  const baseUrl = currentBackendUrl.replace(/\/+$/, '');

  try {
    const res = await fetch(`${baseUrl}/api/v1/parse-fields`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
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
      log(`Successfully parsed ${parsedFields.length} form fields!`, 'success');
      
      chrome.storage.local.set({ lastParsedFields: parsedFields });
    } else {
      throw new Error('Invalid response structure from /parse-fields');
    }
  } catch (err) {
    log(`Parse error: ${err.message}`, 'error');
  } finally {
    btnParseFields.textContent = '1. Parse Form Fields';
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
  micLabel.textContent = 'Processing Whisper + Gemma 4…';
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
      log(`Mapped ${Object.keys(mappedEntries).length} entries with Gemma 4!`, 'success');

      chrome.storage.local.set({ lastMappedEntries: mappedEntries });
    } else {
      throw new Error('Unexpected response format from /process-audio');
    }
  } catch (err) {
    log(`Process error: ${err.message}`, 'error');
  } finally {
    micLabel.textContent = '2. Record Audio Response';
    btnRecordAudio.disabled = false;
    updateButtons();
  }
}

// ── Step 3: Fill Google Form via Content Script ────────────────────────────────
btnFill.addEventListener('click', async () => {
  btnFill.disabled = true;
  fillProgress.classList.remove('hidden');
  progressFill.style.width = '30%';
  log('Autofilling Google Form fields…', 'info');

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

// ── URL Save & Storage ────────────────────────────────────────────────────────
btnSaveUrl.addEventListener('click', () => {
  const val = backendUrlInput.value.trim();
  if (val) {
    currentBackendUrl = val;
    chrome.storage.local.set({ backendUrl: val });
    log(`Updated backend URL to ${val}`);
    checkBackend();
  }
});

btnRetryBackend.addEventListener('click', () => checkBackend());

// ── Init ──────────────────────────────────────────────────────────────────────
(async () => {
  const saved = await chrome.storage.local.get(['backendUrl', 'lastParsedFields', 'lastMappedEntries']);
  if (saved.backendUrl) {
    currentBackendUrl = saved.backendUrl;
  }
  backendUrlInput.value = currentBackendUrl;

  if (saved.lastParsedFields) {
    parsedFields = saved.lastParsedFields;
    formQuestionCount.textContent = `${parsedFields.length} fields`;
  }
  if (saved.lastMappedEntries) {
    mappedEntries = saved.lastMappedEntries;
  }

  await Promise.all([checkActiveTab(), checkBackend()]);
})();
