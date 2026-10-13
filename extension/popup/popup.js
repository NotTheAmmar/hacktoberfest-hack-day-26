/**
 * popup.js — Local Whisper Paperwork popup controller
 *
 * New Question-by-Question Interview Schema:
 *   1. Setup Interview:
 *      POST /api/v1/prepare-interview { url: formUrl }
 *      Receives fields with model-generated structured 'interview_prompt'
 *      (incorporating short options for choices).
 *   2. Answer Each Question:
 *      POST /api/v1/process-single-answer
 *      FormData: audio_file (single question audio), field_meta_json
 *      Receives: { status: "success", id, transcript, formatted_value }
 *   3. Complete the Form:
 *      allAnswers[id] = formatted_value
 *      Generates pre-filled URL: ?entry.XXXX=val
 *      Offers direct DOM autofill via filler.js
 */

// ── State ─────────────────────────────────────────────────────────────────────
let currentBackendUrl    = 'https://rewrite-climatic-shredder.ngrok-free.dev';
let activeTabId          = null;
let activeTabUrl         = '';
let isGoogleForm         = false;
let backendHealthy       = false;

let parsedFields         = []; // [{ id, label, type, options?, interview_prompt }]
let currentQuestionIndex = 0;
let allAnswers           = {}; // { "entry.184920482": "Engineering" }
let allTranscripts       = {}; // { "entry.184920482": "uh engineering please" }
let mappedEntries        = {}; // mirror of allAnswers for autofill

let mediaRecorder        = null;
let audioChunks          = [];
let isRecording          = false;
let recordingSeconds     = 0;
let timerInterval        = null;

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

function escapeHtml(str) {
  return String(str || '').replace(/[&<>"']/g, m => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[m]);
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
    // Ping with OPTIONS (CORSMiddleware answers 200 OK)
    const res = await fetch(`${target}/api/v1/prepare-interview`, {
      method: 'OPTIONS',
      headers: { 'ngrok-skip-browser-warning': 'true' },
      signal: AbortSignal.timeout(4000),
    }).catch(() => null);

    // Fallback ping to parse-fields if prepare-interview isn't mounted yet
    const ok = res && (res.ok || res.status === 200 || res.status === 405);
    if (ok) {
      backendHealthy = true;
      const hostname = target.replace(/^https?:\/\//, '').split('/')[0];
      setBackendStatus('ok', `Connected: ${hostname}`);
      log(`Connected to Kaggle backend: ${target}`, 'success');
      updateHeroBtnState();
      return true;
    } else {
      const pingAlt = await fetch(`${target}/api/v1/parse-fields`, {
        method: 'OPTIONS',
        headers: { 'ngrok-skip-browser-warning': 'true' },
        signal: AbortSignal.timeout(3000),
      }).catch(() => null);

      if (pingAlt && (pingAlt.ok || pingAlt.status === 200 || pingAlt.status === 405)) {
        backendHealthy = true;
        const hostname = target.replace(/^https?:\/\//, '').split('/')[0];
        setBackendStatus('ok', `Connected: ${hostname}`);
        log(`Connected to Kaggle backend: ${target}`, 'success');
        updateHeroBtnState();
        return true;
      }
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

// ── Render Interview Question ─────────────────────────────────────────────────
function renderCurrentQuestion() {
  if (!parsedFields || parsedFields.length === 0) {
    updateHeroBtnState();
    return;
  }

  // Interview complete state
  if (currentQuestionIndex >= parsedFields.length) {
    formFieldsBadge.textContent = 'Completed! ✓';
    recordMainLabel.textContent = 'Interview Complete 🎉';
    recordSubLabel.textContent = `All ${parsedFields.length} questions answered`;
    voiceInstruction.textContent = 'Review your answers below. Click "Autofill Form" or "Prefilled URL" to finish.';
    btnRecordHero.disabled = true;
    btnRecordHero.classList.remove('recording', 'processing');
    recordTimerBadge.classList.add('hidden');
    renderFieldChips();
    return;
  }

  const q = parsedFields[currentQuestionIndex];
  const qNum = currentQuestionIndex + 1;
  const total = parsedFields.length;

  formFieldsBadge.textContent = `Q ${qNum} of ${total}`;
  recordMainLabel.textContent = q.interview_prompt || q.label || `Question ${qNum}`;
  recordSubLabel.textContent = `Tap mic to speak answer (${qNum}/${total})`;

  // Display choices in instruction if available
  if (q.options && q.options.length > 0) {
    voiceInstruction.textContent = `Choices: ${q.options.join(', ')}`;
  } else if (q.type === 'date') {
    voiceInstruction.textContent = 'Say a date (e.g., "Tomorrow", "October 13th 2026").';
  } else if (q.type === 'time') {
    voiceInstruction.textContent = 'Say a time (e.g., "2:30 PM", "14:30").';
  } else {
    voiceInstruction.textContent = 'Speak naturally. Single answer for this question.';
  }

  btnRecordHero.disabled = !backendHealthy;
  btnRecordHero.classList.remove('recording', 'processing');
  recordTimerBadge.classList.add('hidden');

  renderFieldChips();
}

function updateHeroBtnState() {
  if (isRecording) return;

  if (!isGoogleForm) {
    recordMainLabel.textContent = 'Open a Google Form';
    recordSubLabel.textContent = 'Navigate to a Google Form tab to start voice interview';
    btnRecordHero.disabled = true;
  } else if (parsedFields.length === 0) {
    recordMainLabel.textContent = 'Preparing Interview…';
    recordSubLabel.textContent = 'Analyzing form questions with model';
    btnRecordHero.disabled = true;
  } else if (!backendHealthy) {
    recordMainLabel.textContent = 'Check Backend URL';
    recordSubLabel.textContent = 'Ensure Kaggle ngrok tunnel is running and connected';
    btnRecordHero.disabled = true;
  } else {
    renderCurrentQuestion();
  }
}

// ── Render Field Chips with Progress State ────────────────────────────────────
function renderFieldChips() {
  fieldsLoading.classList.add('hidden');
  fieldsChipList.innerHTML = '';

  if (!parsedFields || parsedFields.length === 0) {
    fieldsLoading.classList.remove('hidden');
    fieldsLoading.textContent = 'No questions detected on this form';
    return;
  }

  parsedFields.forEach((f, idx) => {
    const isAnswered = allAnswers[f.id] !== undefined;
    const isCurrent  = idx === currentQuestionIndex;

    const chip = document.createElement('span');
    chip.className = 'field-chip';
    chip.style.cursor = 'pointer';

    if (isCurrent) {
      chip.style.borderColor = 'var(--accent)';
      chip.style.background = 'var(--accent-bg)';
      chip.style.color = 'var(--text)';
    } else if (isAnswered) {
      chip.style.borderColor = 'var(--green-border)';
      chip.style.color = '#34d399';
    }

    const checkIcon = isAnswered ? '✓ ' : '';
    chip.innerHTML = `
      <span>${checkIcon}${escapeHtml(f.label || f.id)}</span>
      <span class="field-chip__type">${escapeHtml(f.type || 'text')}</span>
    `;

    // Click on a chip allows jumping to that question to re-record
    chip.title = f.interview_prompt || f.label;
    chip.addEventListener('click', () => {
      currentQuestionIndex = idx;
      renderCurrentQuestion();
      log(`Switched to question ${idx + 1}: "${f.label}"`, 'info');
    });

    fieldsChipList.appendChild(chip);
  });

  fieldsChipList.classList.remove('hidden');
}

// ── Step 1: Prepare Interview (Model Analyzes & Structures Questions) ────────
async function prepareFormInterview() {
  if (!isGoogleForm || !activeTabUrl) return;

  fieldsLoading.classList.remove('hidden');
  fieldsLoading.innerHTML = '<span class="spinner-sm"></span> Model analyzing questions & structuring interview…';
  fieldsChipList.classList.add('hidden');
  formFieldsBadge.textContent = 'Preparing…';

  const baseUrl = cleanUrl(currentBackendUrl);
  let fields = [];

  // 1. Try Kaggle Endpoint 1: POST /api/v1/prepare-interview
  if (baseUrl) {
    try {
      log('Requesting POST /api/v1/prepare-interview from Kaggle…');
      const res = await fetch(`${baseUrl}/api/v1/prepare-interview`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'ngrok-skip-browser-warning': 'true',
        },
        body: JSON.stringify({ url: activeTabUrl }),
        signal: AbortSignal.timeout(15000),
      });

      if (res.ok) {
        const data = await res.json();
        if (data.status === 'success' && Array.isArray(data.fields) && data.fields.length > 0) {
          fields = data.fields;
          log(`Kaggle prepared ${fields.length} structured interview questions!`, 'success');
        }
      } else {
        // Fallback: try legacy /api/v1/parse-fields
        log(`prepare-interview returned ${res.status}. Falling back to /api/v1/parse-fields…`, 'info');
        const alt = await fetch(`${baseUrl}/api/v1/parse-fields`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'ngrok-skip-browser-warning': 'true',
          },
          body: JSON.stringify({ url: activeTabUrl }),
          signal: AbortSignal.timeout(10000),
        });
        if (alt.ok) {
          const altData = await alt.json();
          if (altData.status === 'success' && Array.isArray(altData.fields)) {
            fields = altData.fields;
          }
        }
      }
    } catch (err) {
      log(`Remote prepare failed (${err.message}). Trying DOM fallback…`, 'info');
    }
  }

  // 2. Client-side DOM question extractor fallback
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
        log(`DOM fallback extracted ${fields.length} questions from page!`, 'success');
      }
    } catch (err) {
      log(`DOM extraction error: ${err.message}`, 'error');
    }
  }

  // Ensure each field has an interview_prompt
  fields.forEach(f => {
    if (!f.interview_prompt) {
      const label = f.label || 'this question';
      if (f.options && f.options.length > 0) {
        const optsStr = f.options.slice(0, 4).join(', ') + (f.options.length > 4 ? ', or others' : '');
        f.interview_prompt = `Which ${label.toLowerCase()} are you with: ${optsStr}?`;
      } else {
        f.interview_prompt = label.endsWith('?') ? label : `What is your ${label.toLowerCase()}?`;
      }
    }
  });

  if (fields.length > 0) {
    parsedFields = fields;
    currentQuestionIndex = 0;
    allAnswers = {};
    allTranscripts = {};
    mappedEntries = {};

    renderFieldChips();
    renderCurrentQuestion();
    chrome.storage.local.set({ lastParsedFields: parsedFields });
  } else {
    fieldsLoading.classList.remove('hidden');
    fieldsLoading.textContent = 'Could not find question fields. Refresh form tab and try again.';
    formFieldsBadge.textContent = '0 questions';
    updateHeroBtnState();
  }
}

// ── Check Active Tab ──────────────────────────────────────────────────────────
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
    await prepareFormInterview();
  }
}

if (btnSaveUrl) btnSaveUrl.addEventListener('click', saveBackendUrl);
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
    await prepareFormInterview();
  });
}

// ── Hero Voice Recording (Question-by-Question) ───────────────────────────────
btnRecordHero.addEventListener('click', async () => {
  if (isRecording) {
    stopRecording();
  } else {
    await startRecording();
  }
});

async function startRecording() {
  if (currentQuestionIndex >= parsedFields.length) return;

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

      // Guard: must be >= 500 bytes and >= 1 second
      if (audioBlob.size < 500 || recordingSeconds < 1) {
        log('Recording was too short. Please speak clearly.', 'error');
        voiceInstruction.textContent = '⚠️ Recording too short. Please tap and speak your answer again.';
        voiceInstruction.style.color = '#f87171';
        resetRecordBtn();
        return;
      }

      await processSingleAnswerWithKaggle(audioBlob);
    };

    mediaRecorder.start();
    isRecording = true;
    recordingSeconds = 0;

    btnRecordHero.classList.add('recording');
    recordMainLabel.textContent = 'Listening… Tap to Finish';
    recordSubLabel.textContent = `Recording answer for question ${currentQuestionIndex + 1}`;
    recordTimerBadge.textContent = '00:00';
    recordTimerBadge.classList.remove('hidden');

    timerInterval = setInterval(() => {
      recordingSeconds++;
      const mins = String(Math.floor(recordingSeconds / 60)).padStart(2, '0');
      const secs = String(recordingSeconds % 60).padStart(2, '0');
      recordTimerBadge.textContent = `${mins}:${secs}`;
    }, 1000);

    log(`Recording answer for Q${currentQuestionIndex + 1}…`, 'info');
  } catch (err) {
    log(`Microphone error: ${err.message}`, 'error');
    alert(`Microphone error: ${err.message}`);
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
  recordMainLabel.textContent = 'Structuring Answer…';
  recordSubLabel.textContent = 'Whisper transcribing + Gemma formatting';
  btnRecordHero.disabled = true;
}

function resetRecordBtn() {
  btnRecordHero.classList.remove('recording', 'processing');
  recordTimerBadge.classList.add('hidden');
  renderCurrentQuestion();
}

// ── Step 2: Answer Each Question (POST /api/v1/process-single-answer) ────────
async function processSingleAnswerWithKaggle(audioBlob) {
  const currentQ = parsedFields[currentQuestionIndex];
  if (!currentQ) return;

  log(`Sending single answer to /api/v1/process-single-answer for field: ${currentQ.label}…`, 'info');
  const baseUrl = cleanUrl(currentBackendUrl);

  const formData = new FormData();
  formData.append('audio_file', audioBlob, 'question_answer.webm');
  formData.append('field_meta_json', JSON.stringify(currentQ));

  try {
    const res = await fetch(`${baseUrl}/api/v1/process-single-answer`, {
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
      const fieldId   = data.id || currentQ.id;
      const transcript = data.transcript || '';
      const formatted  = data.formatted_value || transcript;

      // Accumulator: store formatted value
      allAnswers[fieldId]     = formatted;
      allTranscripts[fieldId] = transcript;
      mappedEntries           = allAnswers;

      log(`Q${currentQuestionIndex + 1} answered: "${formatted}" (transcription: "${transcript}")`, 'success');

      // Update UI results view
      renderResults(transcript, allAnswers);
      chrome.storage.local.set({ lastMappedEntries: allAnswers });

      // Advance to next question!
      currentQuestionIndex++;
      renderCurrentQuestion();
    } else {
      throw new Error('Unexpected response format from /process-single-answer');
    }
  } catch (err) {
    log(`Single answer error: ${err.message}`, 'error');
    alert(`Error processing answer: ${err.message}`);
    resetRecordBtn();
  }
}

// ── Step 3: Complete the Form (Results & Autofill Accumulator) ────────────────
function renderResults(latestTranscript, answers) {
  sectionResults.classList.remove('hidden');
  transcriptText.textContent = latestTranscript ? `"${latestTranscript}"` : '(No transcript)';

  const keys = Object.keys(answers);
  mappedCountBadge.textContent = `${keys.length} / ${parsedFields.length} answered`;

  mappedList.innerHTML = '';
  keys.forEach(k => {
    const field = parsedFields.find(f => f.id === k);
    const label = field ? field.label : k;
    const val   = answers[k];

    const row = document.createElement('div');
    row.className = 'mapped-item';
    row.innerHTML = `
      <span class="mapped-item__label" title="${escapeHtml(label)}">${escapeHtml(label)}</span>
      <span class="mapped-item__val" title="${escapeHtml(val)}">${escapeHtml(val)}</span>
    `;
    mappedList.appendChild(row);
  });
}

// ── Complete the Form: Option A — Direct DOM Autofill ─────────────────────────
btnAutofill.addEventListener('click', async () => {
  if (!activeTabId || Object.keys(allAnswers).length === 0) return;

  btnAutofill.disabled = true;
  fillProgress.classList.remove('hidden');
  progressFill.style.width = '35%';
  progressText.textContent = 'Autofilling Google Form fields…';
  log('Injecting accumulated answers into form DOM…', 'info');

  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId: activeTabId },
      func: (entries) => window.__LWP_fillForm?.({ mapped_entries: entries }),
      args: [allAnswers],
    });

    const res = results?.[0]?.result || { filled: 0, total: Object.keys(allAnswers).length };
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

// ── Complete the Form: Option B — Generate Pre-filled URL Redirection ─────────
btnPrefillUrl.addEventListener('click', () => {
  if (!activeTabUrl || Object.keys(allAnswers).length === 0) return;
  try {
    const finalUrl = new URL(activeTabUrl.replace('/edit', '/viewform'));
    Object.entries(allAnswers).forEach(([entryId, val]) => {
      if (val) finalUrl.searchParams.append(entryId, val);
    });
    window.open(finalUrl.toString(), '_blank');
    log('Opened prefilled form URL in a new tab!', 'success');
  } catch (e) {
    log(`Error generating prefilled URL: ${e.message}`, 'error');
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
    renderFieldChips();
  }

  if (saved.lastMappedEntries && Object.keys(saved.lastMappedEntries).length > 0) {
    allAnswers    = saved.lastMappedEntries;
    mappedEntries = allAnswers;
    renderResults('', allAnswers);
  }

  // Detect active tab and verify Kaggle connection concurrently
  await Promise.all([
    checkActiveTab(),
    checkBackend(currentBackendUrl),
  ]);

  // If on a Google Form, prepare the interview immediately
  if (isGoogleForm) {
    await prepareFormInterview();
  }
})();
