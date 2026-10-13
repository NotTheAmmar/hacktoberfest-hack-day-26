/**
 * popup.js — Local Whisper Paperwork popup controller
 *
 * Kaggle Backend Integration:
 *   - Auto-detects Google Form on active tab.
 *   - Auto-parses form questions via POST /api/v1/parse-fields
 *     (with instant DOM fallback if private or auth-required).
 *   - Hero Voice Intake: Records audio (with live timer & >= 1KB validation).
 *   - Calls POST /api/v1/process-audio with Whisper Large-v3-Turbo + Gemma 2.
 *   - Renders transcript + mapped answers.
 *   - One-click DOM Autofill + Prefilled URL generation.
 */

// ── State ─────────────────────────────────────────────────────────────────────
let currentBackendUrl = 'https://rewrite-climatic-shredder.ngrok-free.dev';
let activeTabId       = null;
let activeTabUrl      = '';
let isGoogleForm      = false;
let backendHealthy    = false;
let parsedFields      = []; // [{ id: "entry.123", label: "Full Name", type: "short_text", options? }]
let mappedEntries     = {}; // { "entry.123": "Value" }

let mediaRecorder     = null;
let audioChunks       = [];
let isRecording       = false;
let recordingSeconds  = 0;
let timerInterval     = null;

// ── DOM Elements ──────────────────────────────────────────────────────────────
const tabPill              = document.getElementById('tab-pill');
const tabPillText          = document.getElementById('tab-pill-text');

const backendDot           = document.getElementById('backend-dot');
const backendTextEl        = document.getElementById('backend-text');
const backendUrlInput      = document.getElementById('backend-url-input');
const btnSaveUrl           = document.getElementById('btn-save-url');

const formTitleText        = document.getElementById('form-title-text');
const formFieldsBadge      = document.getElementById('form-fields-badge');
const btnReparse           = document.getElementById('btn-reparse');
const fieldsLoading        = document.getElementById('fields-loading');
const fieldsChipList       = document.getElementById('fields-chip-list');

const btnRecordHero        = document.getElementById('btn-record-hero');
const recordMainLabel      = document.getElementById('record-main-label');
const recordSubLabel       = document.getElementById('record-sub-label');
const recordTimerBadge     = document.getElementById('record-timer-badge');
const voiceInstruction     = document.getElementById('voice-instruction');

const sectionResults       = document.getElementById('section-results');
const mappedCountBadge     = document.getElementById('mapped-count-badge');
const transcriptText       = document.getElementById('transcript-text');
const mappedList           = document.getElementById('mapped-list');
const btnAutofill          = document.getElementById('btn-autofill');
const btnPrefillUrl        = document.getElementById('btn-prefill-url');

const fillProgress         = document.getElementById('fill-progress');
const progressFill         = document.getElementById('progress-fill');
const progressText         = document.getElementById('progress-text');

const btnOpenPanel         = document.getElementById('btn-open-panel');
const btnToggleLog         = document.getElementById('btn-toggle-log');
const logEl                = document.getElementById('log');

// ── Logging ───────────────────────────────────────────────────────────────────
function log(msg, type = 'info') {
  if (!logEl) return;
  const entry = document.createElement('div');
  entry.className = `log-entry ${type}`;
  entry.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`;
  logEl.prepend(entry);
  while (logEl.children.length > 30) logEl.removeChild(logEl.lastChild);
}

if (btnToggleLog) {
  btnToggleLog.addEventListener('click', () => {
    logEl.classList.toggle('hidden');
  });
}

// ── Status UI Helpers ─────────────────────────────────────────────────────────
function setTabPill(state, text) {
  if (!tabPill || !tabPillText) return;
  tabPill.className = `tab-pill tab-pill--${state}`;
  tabPillText.textContent = text;
}

function setBackendStatus(state, text) {
  if (backendDot) backendDot.dataset.state = state;
  if (backendTextEl) backendTextEl.textContent = text;
}

function cleanUrl(url) {
  return (url || '').trim().replace(/\/+$/, '');
}

// ── Backend Connectivity Check ────────────────────────────────────────────────
async function checkBackend(url) {
  const target = cleanUrl(url || currentBackendUrl);
  if (!target) {
    setBackendStatus('error', 'No URL configured');
    backendHealthy = false;
    updateHeroBtnState();
    return false;
  }

  setBackendStatus('checking', 'Connecting…');

  try {
    // Check Kaggle FastAPI endpoint using OPTIONS to verify CORS + tunnel
    const res = await fetch(`${target}/api/v1/parse-fields`, {
      method: 'OPTIONS',
      headers: { 'ngrok-skip-browser-warning': 'true' },
      signal: AbortSignal.timeout(4000),
    }).catch(() => null);

    if (res && (res.ok || res.status === 200 || res.status === 405)) {
      backendHealthy = true;
      const hostname = target.replace(/^https?:\/\//, '').split('/')[0];
      setBackendStatus('ok', `Connected: ${hostname}`);
      log(`Connected to Kaggle backend: ${target}`, 'success');
      updateHeroBtnState();
      return true;
    } else {
      throw new Error(`Status ${res ? res.status : 'timeout'}`);
    }
  } catch (err) {
    backendHealthy = false;
    setBackendStatus('error', 'Unreachable');
    log(`Kaggle backend unreachable at ${target} (${err.message})`, 'error');
    updateHeroBtnState();
    return false;
  }
}

// ── Update Hero Button State ──────────────────────────────────────────────────
function updateHeroBtnState() {
  if (isRecording) return;

  const canRecord = isGoogleForm && parsedFields.length > 0;
  btnRecordHero.disabled = !canRecord;

  if (!isGoogleForm) {
    recordMainLabel.textContent = 'Open a Google Form';
    recordSubLabel.textContent = 'Navigate to a Google Form tab to start voice filling';
  } else if (parsedFields.length === 0) {
    recordMainLabel.textContent = 'Detecting Fields…';
    recordSubLabel.textContent = 'Parsing questions from the form';
  } else if (!backendHealthy) {
    recordMainLabel.textContent = 'Check Backend URL';
    recordSubLabel.textContent = 'Ensure Kaggle ngrok tunnel is running and connected';
  } else {
    recordMainLabel.textContent = 'Tap to Speak Answers';
    recordSubLabel.textContent = `Ready for ${parsedFields.length} detected questions`;
  }
}

// ── Render Parsed Field Chips ─────────────────────────────────────────────────
function renderFieldChips(fields) {
  fieldsLoading.classList.add('hidden');
  fieldsChipList.innerHTML = '';

  if (!fields || fields.length === 0) {
    fieldsLoading.classList.remove('hidden');
    fieldsLoading.textContent = 'No questions detected on this form';
    return;
  }

  fields.forEach(f => {
    const chip = document.createElement('span');
    chip.className = 'field-chip';
    chip.innerHTML = `
      <span>${escapeHtml(f.label || f.id)}</span>
      <span class="field-chip__type">${escapeHtml(f.type || 'text')}</span>
    `;
    fieldsChipList.appendChild(chip);
  });

  fieldsChipList.classList.remove('hidden');
}

function escapeHtml(str) {
  return String(str || '').replace(/[&<>"']/g, m => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[m]);
}

// ── Parse Form Fields Automatically ───────────────────────────────────────────
async function parseFormFields() {
  if (!isGoogleForm || !activeTabUrl) return;

  fieldsLoading.classList.remove('hidden');
  fieldsLoading.innerHTML = '<span class="spinner-sm"></span> Parsing questions from form…';
  fieldsChipList.classList.add('hidden');
  formFieldsBadge.textContent = 'Parsing…';

  const baseUrl = cleanUrl(currentBackendUrl);
  let fields = [];

  // Step 1: Call Kaggle /api/v1/parse-fields
  if (baseUrl) {
    try {
      log('Calling Kaggle /api/v1/parse-fields…');
      const res = await fetch(`${baseUrl}/api/v1/parse-fields`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'ngrok-skip-browser-warning': 'true',
        },
        body: JSON.stringify({ url: activeTabUrl }),
        signal: AbortSignal.timeout(10000),
      });

      if (res.ok) {
        const data = await res.json();
        if (data.status === 'success' && Array.isArray(data.fields) && data.fields.length > 0) {
          fields = data.fields;
          backendHealthy = true;
          setBackendStatus('ok', `Connected: ${baseUrl.replace(/^https?:\/\//, '').split('/')[0]}`);
          log(`Kaggle scraped ${fields.length} fields from Google Form!`, 'success');
        }
      } else {
        const err = await res.json().catch(() => ({}));
        log(`Kaggle parse error: ${err.detail || res.status}. Trying DOM fallback…`, 'info');
      }
    } catch (err) {
      log(`Remote scrape failed (${err.message}). Trying DOM fallback…`, 'info');
    }
  }

  // Step 2: DOM fallback if remote scraping was blocked or private
  if (fields.length === 0 && activeTabId) {
    try {
      log('Running client-side DOM question extractor fallback…');
      const results = await chrome.scripting.executeScript({
        target: { tabId: activeTabId },
        func: () => window.__LWP_getKaggleFields?.() || [],
      });

      const domFields = results?.[0]?.result;
      if (Array.isArray(domFields) && domFields.length > 0) {
        fields = domFields;
        log(`DOM fallback extracted ${fields.length} questions from tab!`, 'success');
      }
    } catch (err) {
      log(`DOM extraction error: ${err.message}`, 'error');
    }
  }

  // Update State & UI
  if (fields.length > 0) {
    parsedFields = fields;
    formFieldsBadge.textContent = `${parsedFields.length} questions`;
    renderFieldChips(parsedFields);
    chrome.storage.local.set({ lastParsedFields: parsedFields });
  } else {
    fieldsLoading.classList.remove('hidden');
    fieldsLoading.textContent = 'Could not find question fields. Refresh tab and try again.';
    formFieldsBadge.textContent = '0 questions';
  }

  updateHeroBtnState();
}

// ── Check Active Browser Tab ──────────────────────────────────────────────────
async function checkActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) return;

  activeTabId  = tab.id;
  activeTabUrl = tab.url || '';

  if (activeTabUrl.match(/^https:\/\/(docs\.google\.com\/forms|forms\.gle)\//)) {
    isGoogleForm = true;
    setTabPill('ok', 'Form detected');
    const title = tab.title || 'Google Form';
    formTitleText.textContent = title.replace(/\s*[-–]\s*Google Forms?\s*$/i, '').trim();
    formTitleText.title = formTitleText.textContent;
  } else {
    isGoogleForm = false;
    setTabPill('none', 'No form');
    formTitleText.textContent = 'No Google Form on this tab';
    formFieldsBadge.textContent = '0 questions';
    fieldsLoading.classList.remove('hidden');
    fieldsLoading.textContent = 'Open a Google Form in this browser window';
    fieldsChipList.classList.add('hidden');
  }

  updateHeroBtnState();
}

// ── Save Backend URL ──────────────────────────────────────────────────────────
async function saveBackendUrl() {
  const val = (backendUrlInput?.value || '').trim();
  if (!val) return;

  currentBackendUrl = val;
  await chrome.storage.local.set({ backendUrl: val });
  log(`Saved Kaggle Backend URL: ${val}`, 'info');

  const ok = await checkBackend(val);
  if (ok && isGoogleForm && parsedFields.length === 0) {
    await parseFormFields();
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

if (btnReparse) {
  btnReparse.addEventListener('click', async () => {
    await checkActiveTab();
    await parseFormFields();
  });
}

// ── Hero Voice Recording ──────────────────────────────────────────────────────
btnRecordHero.addEventListener('click', async () => {
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
      if (audioBlob.size < 1000 || recordingSeconds < 2) {
        log('Audio too short (< 2s or < 1KB). Please speak for at least 2 seconds.', 'error');
        voiceInstruction.textContent = '⚠️ Spoke too briefly. Please speak for at least 2 seconds.';
        voiceInstruction.style.color = '#f87171';
        resetRecordBtn();
        return;
      }

      await processAudioWithKaggle(audioBlob);
    };

    mediaRecorder.start();
    isRecording = true;
    recordingSeconds = 0;

    btnRecordHero.classList.add('recording');
    recordMainLabel.textContent = 'Recording… Tap to Finish';
    recordSubLabel.textContent = 'Speak your answers naturally';
    recordTimerBadge.textContent = '00:00';
    recordTimerBadge.classList.remove('hidden');

    timerInterval = setInterval(() => {
      recordingSeconds++;
      const mins = String(Math.floor(recordingSeconds / 60)).padStart(2, '0');
      const secs = String(recordingSeconds % 60).padStart(2, '0');
      recordTimerBadge.textContent = `${mins}:${secs}`;
    }, 1000);

    log('Recording started — speak your answers clearly.', 'info');
  } catch (err) {
    log(`Microphone access error: ${err.message}`, 'error');
    alert(`Could not access microphone: ${err.message}`);
  }
}

function stopRecording() {
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }

  if (mediaRecorder && mediaRecorder.state !== 'inactive') {
    mediaRecorder.stop();
  }
  isRecording = false;

  btnRecordHero.classList.remove('recording');
  btnRecordHero.classList.add('processing');
  recordTimerBadge.classList.add('hidden');
  recordMainLabel.textContent = 'Transcribing & Mapping…';
  recordSubLabel.textContent = 'Whisper + Gemma 2 running on GPU';
  btnRecordHero.disabled = true;
}

function resetRecordBtn() {
  btnRecordHero.classList.remove('recording', 'processing');
  recordTimerBadge.classList.add('hidden');
  btnRecordHero.disabled = false;
  updateHeroBtnState();
}

// ── Process Audio via Kaggle Backend ──────────────────────────────────────────
async function processAudioWithKaggle(audioBlob) {
  log(`Uploading audio (${Math.round(audioBlob.size / 1024)} KB) to /api/v1/process-audio…`, 'info');
  const baseUrl = cleanUrl(currentBackendUrl);

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
      throw new Error(err.detail || `HTTP ${res.status}: ${res.statusText}`);
    }

    const data = await res.json();
    if (data.status === 'success') {
      mappedEntries = data.mapped_entries || {};
      const transcript = data.transcript || '';

      renderResults(transcript, mappedEntries);
      log(`Transcribed: "${transcript}"`, 'success');
      log(`Mapped ${Object.keys(mappedEntries).length} entries with Gemma!`, 'success');

      chrome.storage.local.set({ lastMappedEntries: mappedEntries });
    } else {
      throw new Error('Unexpected response format from /process-audio');
    }
  } catch (err) {
    log(`Processing error: ${err.message}`, 'error');
    alert(`AI Processing error: ${err.message}`);
  } finally {
    resetRecordBtn();
  }
}

// ── Render Results & Mapped Fields ────────────────────────────────────────────
function renderResults(transcript, mapped) {
  sectionResults.classList.remove('hidden');
  transcriptText.textContent = `"${transcript}"`;

  const keys = Object.keys(mapped);
  mappedCountBadge.textContent = `${keys.length} mapped`;

  mappedList.innerHTML = '';
  if (keys.length === 0) {
    mappedList.innerHTML = '<div style="color:var(--text-3);font-size:11px;">No fields could be mapped from the spoken answers.</div>';
    return;
  }

  keys.forEach(k => {
    const field = parsedFields.find(f => f.id === k);
    const label = field ? field.label : k;
    const val   = mapped[k];

    const row = document.createElement('div');
    row.className = 'mapped-item';
    row.innerHTML = `
      <span class="mapped-item__label" title="${escapeHtml(label)}">${escapeHtml(label)}</span>
      <span class="mapped-item__val" title="${escapeHtml(val)}">${escapeHtml(val)}</span>
    `;
    mappedList.appendChild(row);
  });
}

// ── Autofill Active Form directly in DOM ──────────────────────────────────────
btnAutofill.addEventListener('click', async () => {
  if (!activeTabId || Object.keys(mappedEntries).length === 0) return;

  btnAutofill.disabled = true;
  fillProgress.classList.remove('hidden');
  progressFill.style.width = '35%';
  progressText.textContent = 'Autofilling form fields…';
  log('Injecting answers directly into Google Form DOM…', 'info');

  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId: activeTabId },
      func: (entries) => window.__LWP_fillForm?.({ mapped_entries: entries }),
      args: [mappedEntries],
    });

    const res = results?.[0]?.result || { filled: 0, total: Object.keys(mappedEntries).length };
    progressFill.style.width = '100%';
    progressText.textContent = `✓ Filled ${res.filled} / ${res.total} fields!`;
    log(`Autofill complete: ${res.filled} fields filled!`, 'success');
  } catch (err) {
    log(`Autofill error: ${err.message}`, 'error');
    progressText.textContent = `Error: ${err.message}`;
  } finally {
    btnAutofill.disabled = false;
  }
});

// ── Open Prefilled Form URL ───────────────────────────────────────────────────
btnPrefillUrl.addEventListener('click', () => {
  if (!activeTabUrl || Object.keys(mappedEntries).length === 0) return;
  try {
    const cleanFormUrl = new URL(activeTabUrl.replace('/edit', '/viewform'));
    Object.entries(mappedEntries).forEach(([entryId, value]) => {
      if (value) cleanFormUrl.searchParams.set(entryId, String(value));
    });
    chrome.tabs.create({ url: cleanFormUrl.toString() });
    log('Opened prefilled form URL in a new tab!', 'success');
  } catch (e) {
    log(`Error generating URL: ${e.message}`, 'error');
  }
});

// ── Launch In-Page Floating Panel ─────────────────────────────────────────────
if (btnOpenPanel) {
  btnOpenPanel.addEventListener('click', async () => {
    btnOpenPanel.disabled = true;
    log('Launching in-page floating panel…');
    try {
      const res = await chrome.runtime.sendMessage({ type: 'OPEN_PANEL' });
      if (res?.success) {
        log('Floating panel launched on form page', 'success');
        window.close();
      } else {
        log(`Failed to open panel: ${res?.error || 'unknown error'}`, 'error');
        btnOpenPanel.disabled = false;
      }
    } catch (err) {
      log(`Panel launch error: ${err.message}`, 'error');
      btnOpenPanel.disabled = false;
    }
  });
}

// ── Initialization ────────────────────────────────────────────────────────────
(async () => {
  // Load saved configuration
  const saved = await chrome.storage.local.get(['backendUrl', 'lastParsedFields', 'lastMappedEntries']);
  if (saved.backendUrl) {
    currentBackendUrl = saved.backendUrl;
  }
  if (backendUrlInput) {
    backendUrlInput.value = currentBackendUrl;
  }

  if (saved.lastParsedFields && saved.lastParsedFields.length > 0) {
    parsedFields = saved.lastParsedFields;
    formFieldsBadge.textContent = `${parsedFields.length} questions`;
    renderFieldChips(parsedFields);
  }

  if (saved.lastMappedEntries && Object.keys(saved.lastMappedEntries).length > 0) {
    mappedEntries = saved.lastMappedEntries;
  }

  // Detect active tab and verify Kaggle connection concurrently
  await Promise.all([
    checkActiveTab(),
    checkBackend(currentBackendUrl),
  ]);

  // If on a Google Form, auto-parse fields right away!
  if (isGoogleForm) {
    await parseFormFields();
  }
})();
