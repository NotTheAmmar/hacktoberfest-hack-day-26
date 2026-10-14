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

const questionBannerBox    = document.getElementById('question-banner-box');
const questionBannerBadge  = document.getElementById('question-banner-badge');
const questionBannerText   = document.getElementById('question-banner-text');

const btnRecordHero        = document.getElementById('btn-record-hero');
const recordMainLabel      = document.getElementById('record-main-label');
const recordSubLabel       = document.getElementById('record-sub-label');
const recordTimerBadge     = document.getElementById('record-timer-badge');
const voiceInstruction     = document.getElementById('voice-instruction');

const optionsContainer     = document.getElementById('options-container');
const optionsChipsList     = document.getElementById('options-chips-list');

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
    if (questionBannerBox) questionBannerBox.classList.add('hidden');
    if (optionsContainer) optionsContainer.classList.add('hidden');
    updateHeroBtnState();
    return;
  }

  // Interview complete state
  if (currentQuestionIndex >= parsedFields.length) {
    formFieldsBadge.textContent = 'Completed! ✓';
    if (questionBannerBox) {
      questionBannerBox.classList.remove('hidden');
      questionBannerBadge.textContent = 'All Questions Answered ✓';
      questionBannerText.textContent = 'Interview Complete 🎉 You can now review your answers below and autofill or open the prefilled URL.';
    }
    if (optionsContainer) optionsContainer.classList.add('hidden');

    recordMainLabel.textContent = 'Interview Complete 🎉';
    recordSubLabel.textContent = `All ${parsedFields.length} questions answered`;
    voiceInstruction.textContent = 'Click "Autofill Form" or "Prefilled URL" below to finish.';
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

  // 1. Display field.interview_prompt as the main question banner
  if (questionBannerBox) {
    questionBannerBox.classList.remove('hidden');
    questionBannerBadge.textContent = `Question ${qNum} of ${total} • ${escapeHtml(q.label || '')}`;
    questionBannerText.textContent = q.interview_prompt || q.label || `Question ${qNum}`;
  }

  // 2. Microphone hero button labels
  recordMainLabel.textContent = 'Tap to Speak Answer';
  recordSubLabel.textContent = `Recording answer for question ${qNum} of ${total}`;

  // 3. Option pills: collect choices from fields in this group
  if (optionsContainer && optionsChipsList) {
    let optionsList = [];
    if (q.target_fields && Array.isArray(q.target_fields)) {
      q.target_fields.forEach(f => {
        if (f.options && Array.isArray(f.options) && f.options.length > 0) {
          f.options.forEach(opt => {
            optionsList.push({ fieldId: f.id, fieldLabel: f.label, opt });
          });
        }
      });
    } else if (q.options && Array.isArray(q.options) && q.options.length > 0) {
      optionsList = q.options.map(opt => ({ fieldId: q.id, fieldLabel: q.label, opt }));
    }

    if (optionsList.length > 0) {
      optionsChipsList.innerHTML = '';
      optionsList.forEach(item => {
        const pill = document.createElement('button');
        pill.className = 'option-pill';
        pill.type = 'button';
        pill.textContent = item.opt;

        if (allAnswers[item.fieldId] === item.opt) {
          pill.classList.add('selected');
        }

        pill.addEventListener('click', () => {
          allAnswers[item.fieldId] = item.opt;
          if (item.fieldLabel) allAnswers[item.fieldLabel] = item.opt;
          mappedEntries = allAnswers;
          log(`Selected option "${item.opt}" for ${item.fieldLabel || item.fieldId}`, 'success');
          renderResults(`Selected option: ${item.opt}`, allAnswers);
          renderFieldChips();
          pill.classList.add('selected');
        });

        optionsChipsList.appendChild(pill);
      });
      optionsContainer.classList.remove('hidden');
    } else {
      optionsContainer.classList.add('hidden');
      optionsChipsList.innerHTML = '';
    }
  }

  // Helper instruction below
  voiceInstruction.textContent = 'Speak naturally. Single voice answer will extract all details for this question.';

  btnRecordHero.disabled = !backendHealthy;
  btnRecordHero.classList.remove('recording', 'processing');
  recordTimerBadge.classList.add('hidden');

  renderFieldChips();
}

function updateHeroBtnState() {
  if (isRecording) return;

  if (!isGoogleForm) {
    if (questionBannerBox) questionBannerBox.classList.add('hidden');
    if (optionsContainer) optionsContainer.classList.add('hidden');
    recordMainLabel.textContent = 'Open a Google Form';
    recordSubLabel.textContent = 'Navigate to a Google Form tab to start voice interview';
    btnRecordHero.disabled = true;
  } else if (parsedFields.length === 0) {
    if (questionBannerBox) questionBannerBox.classList.add('hidden');
    if (optionsContainer) optionsContainer.classList.add('hidden');
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

  // Flatten all fields across groups to show progress chips for all form inputs
  const allFieldItems = [];
  parsedFields.forEach((g, gIdx) => {
    if (g.target_fields && Array.isArray(g.target_fields)) {
      g.target_fields.forEach(f => allFieldItems.push({ ...f, groupIndex: gIdx, groupTitle: g.label }));
    } else {
      allFieldItems.push({ ...g, groupIndex: gIdx, groupTitle: g.label });
    }
  });

  allFieldItems.forEach((f) => {
    const isAnswered = Boolean(allAnswers[f.id] || (f.label && allAnswers[f.label]));
    const isCurrentGroup = f.groupIndex === currentQuestionIndex;

    const chip = document.createElement('span');
    chip.className = 'field-chip';
    chip.style.cursor = 'pointer';

    if (isCurrentGroup) {
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

    chip.title = `Question ${f.groupIndex + 1}: ${f.groupTitle}`;
    chip.addEventListener('click', () => {
      currentQuestionIndex = f.groupIndex;
      renderCurrentQuestion();
      log(`Switched to Question ${f.groupIndex + 1}: "${f.groupTitle}"`, 'info');
    });

    fieldsChipList.appendChild(chip);
  });

  fieldsChipList.classList.remove('hidden');
}

// ── Step 1: Prepare Interview (Model Analyzes & Structures Questions) ────────
async function prepareFormInterview() {
  if (!isGoogleForm || !activeTabUrl) return;

  fieldsLoading.classList.remove('hidden');
  fieldsLoading.innerHTML = '<span class="spinner-sm"></span> Extracting form fields…';
  fieldsChipList.classList.add('hidden');
  formFieldsBadge.textContent = 'Preparing…';

  const baseUrl = cleanUrl(currentBackendUrl);
  let fields = [];

  // ── Step 1: ALWAYS extract fields from the page DOM first ────────────────
  // This works 100% of the time (no internet needed on backend).
  // The backend only needs to bundle them with Gemma, not scrape them.
  try {
    log('Extracting fields from page DOM…');
    const results = await chrome.scripting.executeScript({
      target: { tabId: activeTabId },
      func: () => window.__LWP_getKaggleFields?.() || [],
    });
    const domFields = results?.[0]?.result;
    if (Array.isArray(domFields) && domFields.length > 0) {
      fields = domFields;
      log(`DOM extracted ${fields.length} raw fields from page.`, 'info');
    }
  } catch (err) {
    log(`DOM extraction error: ${err.message}`, 'info');
  }

  // ── Step 2: Send pre-extracted fields to Kaggle for Gemma bundling ───────
  // We send the fields array (not the URL) so Kaggle doesn't need to scrape.
  if (baseUrl && fields.length > 0) {
    try {
      fieldsLoading.innerHTML = '<span class="spinner-sm"></span> Gemma 2 bundling into 2-3 questions…';
      log('Sending fields to /api/v1/prepare-interview for Gemma bundling…');

      const res = await fetch(`${baseUrl}/api/v1/prepare-interview`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'ngrok-skip-browser-warning': 'true',
        },
        // Send pre-extracted fields directly — no URL scraping needed
        body: JSON.stringify({ fields: fields, url: activeTabUrl }),
        signal: AbortSignal.timeout(30000),
      });

      if (res.ok) {
        const data = await res.json();
        const incoming = Array.isArray(data.groups) ? data.groups
                       : Array.isArray(data.fields) ? data.fields
                       : null;
        if (data.status === 'success' && incoming && incoming.length > 0) {
          fields = incoming;
          log(`Gemma bundled into ${fields.length} interview questions!`, 'success');
        }
      } else {
        log(`Backend bundling returned ${res.status} — will use client-side bundling.`, 'info');
      }
    } catch (err) {
      log(`Backend bundling failed (${err.message}) — using client-side bundling.`, 'info');
    }
  } else if (!fields.length) {
    // Last resort: try sending URL to backend (may fail if internet disabled)
    if (baseUrl) {
      try {
        const res = await fetch(`${baseUrl}/api/v1/prepare-interview`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'ngrok-skip-browser-warning': 'true' },
          body: JSON.stringify({ url: activeTabUrl }),
          signal: AbortSignal.timeout(20000),
        });
        if (res.ok) {
          const data = await res.json();
          const incoming = Array.isArray(data.groups) ? data.groups : Array.isArray(data.fields) ? data.fields : null;
          if (incoming && incoming.length > 0) fields = incoming;
        }
      } catch (_) {}
    }
  }


  // ── Client-side bundling ──────────────────────────────────────────────────
  // If fields are individual (not already grouped by the new backend),
  // bundle them into 2-3 interview questions so the user only speaks 2-3 times.
  fields = bundleIntoGroups(fields);

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

// ── Bundle individual fields into 2-3 interview groups ────────────────────────
function bundleIntoGroups(fields) {
  if (!fields || fields.length === 0) return fields;

  // Flatten if needed (in case already wrapped)
  let rawFields = [];
  fields.forEach(f => {
    if (f.target_fields && Array.isArray(f.target_fields)) {
      rawFields.push(...f.target_fields);
    } else {
      rawFields.push(f);
    }
  });

  const n = rawFields.length;
  // If 3 or fewer fields, each can be its own question
  if (n <= 3) {
    return rawFields.map((f, idx) => ({
      label: f.label || `Field ${idx + 1}`,
      interview_prompt: f.interview_prompt || `What is your ${(f.label || '').toLowerCase()}?`,
      target_fields: [f],
      id: f.id,
    }));
  }

  // Helper to build a fluent, specific conversational prompt from an array of fields
  function buildFluentPrompt(fieldList, defaultPrompt) {
    const labels = fieldList.map(f => {
      if (f.options && Array.isArray(f.options) && f.options.length > 0) {
        const opts = f.options.slice(0, 3).join(', ') + (f.options.length > 3 ? '…' : '');
        return `${f.label} (options: ${opts})`;
      }
      return f.label;
    });

    if (labels.length === 0) return defaultPrompt;
    if (labels.length === 1) return `Could you please state your ${labels[0]}?`;
    if (labels.length === 2) return `Could you please state your ${labels[0]} and ${labels[1]}?`;
    
    const last = labels[labels.length - 1];
    const initial = labels.slice(0, -1).join(', ');
    return `Could you please provide your ${initial}, and your ${last}?`;
  }

  // Semantic grouping heuristics for standard forms (Contact, Address, Other/Feedback)
  const contactKeywords = ['company', 'organization', 'business', 'name', 'contact', 'email', 'phone', 'mobile', 'title', 'role', 'position'];
  const addressKeywords = ['address', 'street', 'lane', 'house', 'city', 'state', 'province', 'region', 'postal', 'zip', 'country', 'location'];

  const contactFields = [];
  const addressFields = [];
  const otherFields = [];

  rawFields.forEach(f => {
    const lbl = (f.label || '').toLowerCase();
    if (addressKeywords.some(kw => lbl.includes(kw))) {
      addressFields.push(f);
    } else if (contactKeywords.some(kw => lbl.includes(kw))) {
      contactFields.push(f);
    } else {
      otherFields.push(f);
    }
  });

  const groups = [];

  // If semantic categorization matched well (at least 2 categories populated)
  if ((contactFields.length > 0 && addressFields.length > 0) || 
      (contactFields.length > 0 && otherFields.length > 0) || 
      (addressFields.length > 0 && otherFields.length > 0)) {

    if (contactFields.length > 0) {
      groups.push({
        label: 'Company & Contact Info',
        interview_prompt: buildFluentPrompt(
          contactFields,
          'Please state your company name, contact person name, job title, email address, and phone number.'
        ),
        target_fields: contactFields,
        id: contactFields.map(f => f.id).join(','),
      });
    }

    if (addressFields.length > 0) {
      groups.push({
        label: 'Physical Address & Location',
        interview_prompt: buildFluentPrompt(
          addressFields,
          'What is your full address including street address, apartment or house name, city, state/region, zip code, and country?'
        ),
        target_fields: addressFields,
        id: addressFields.map(f => f.id).join(','),
      });
    }

    if (otherFields.length > 0) {
      groups.push({
        label: 'Industry & Additional Details',
        interview_prompt: buildFluentPrompt(
          otherFields,
          'What industry are you in, how did you hear about us, and do you have any additional comments or questions?'
        ),
        target_fields: otherFields,
        id: otherFields.map(f => f.id).join(','),
      });
    }
  }

  // Fallback: If semantic categories didn't cover everything, split rawFields into 2-3 even chunks
  if (groups.length === 0 || groups.reduce((acc, g) => acc + g.target_fields.length, 0) < n) {
    groups.length = 0; // reset
    const numGroups = n <= 5 ? 2 : 3;
    const chunkSize = Math.ceil(n / numGroups);

    for (let i = 0; i < numGroups; i++) {
      const chunk = rawFields.slice(i * chunkSize, (i + 1) * chunkSize);
      if (chunk.length === 0) continue;

      const groupTitles = ['Primary Details', 'Specific Requirements', 'Final Details & Preferences'];
      const title = groupTitles[i] || `Section ${i + 1}`;
      const prompt = buildFluentPrompt(chunk, `Please provide the details for ${title}.`);

      groups.push({
        label: title,
        interview_prompt: prompt,
        target_fields: chunk,
        id: chunk.map(f => f.id).join(','),
      });
    }
  }

  log(`Bundled ${n} form fields into ${groups.length} specific interview questions.`, 'info');
  return groups;
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

  log(`Sending answer for question ${currentQuestionIndex + 1}/${parsedFields.length} to backend…`, 'info');
  const baseUrl = cleanUrl(currentBackendUrl);

  const formData = new FormData();
  formData.append('audio_file', audioBlob, 'question_answer.webm');
  // Send group_meta_json with target_fields
  formData.append('group_meta_json', JSON.stringify(currentQ));
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
      const transcript = data.transcript || '';
      const targets = currentQ.target_fields || [currentQ];

      // Merge and normalize all mapped_entries from this group
      if (data.mapped_entries && typeof data.mapped_entries === 'object') {
        for (const [k, v] of Object.entries(data.mapped_entries)) {
          if (!v || !String(v).trim()) continue;
          const cleanVal = String(v).trim();
          const cleanKey = String(k).trim();

          // 1. Check if key is already an entry ID
          const matchedById = targets.find(f => f.id === cleanKey);
          if (matchedById) {
            allAnswers[matchedById.id] = cleanVal;
            if (matchedById.label) allAnswers[matchedById.label] = cleanVal;
            continue;
          }

          // 2. Check if key matches a field label
          const matchedByLabel = targets.find(f => 
            f.label && (
              f.label.toLowerCase() === cleanKey.toLowerCase() ||
              f.label.toLowerCase().includes(cleanKey.toLowerCase()) ||
              cleanKey.toLowerCase().includes(f.label.toLowerCase())
            )
          );
          if (matchedByLabel) {
            allAnswers[matchedByLabel.id] = cleanVal;
            allAnswers[matchedByLabel.label] = cleanVal;
            continue;
          }

          // 3. Fallback: store as-is
          allAnswers[cleanKey] = cleanVal;
        }
      } else {
        // Legacy fallback: single formatted_value
        const fieldId = data.id || currentQ.id;
        const formatted = data.formatted_value || transcript;
        allAnswers[fieldId] = formatted;
        if (currentQ.label) allAnswers[currentQ.label] = formatted;
      }
      mappedEntries = allAnswers;

      // Count unique target fields mapped so far
      let totalFieldsCount = 0;
      let filledFieldsCount = 0;
      parsedFields.forEach(g => {
        const fList = g.target_fields || [g];
        totalFieldsCount += fList.length;
        fList.forEach(f => {
          if (allAnswers[f.id] || (f.label && allAnswers[f.label])) filledFieldsCount++;
        });
      });

      log(`Q${currentQuestionIndex + 1} answered — ${filledFieldsCount}/${totalFieldsCount} total fields mapped. Transcript: "${transcript}"`, 'success');

      // Update UI results view and field chips
      renderResults(transcript, allAnswers);
      renderFieldChips();
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

  // Collect all field definitions across groups
  const allFieldDefs = [];
  parsedFields.forEach(g => {
    if (g.target_fields && Array.isArray(g.target_fields)) {
      allFieldDefs.push(...g.target_fields);
    } else {
      allFieldDefs.push(g);
    }
  });

  const seenIds = new Set();
  const uniqueDefs = [];
  allFieldDefs.forEach(f => {
    if (!seenIds.has(f.id)) {
      seenIds.add(f.id);
      uniqueDefs.push(f);
    }
  });

  let filledCount = 0;
  mappedList.innerHTML = '';

  uniqueDefs.forEach(f => {
    const val = answers[f.id] || (f.label && answers[f.label]);
    if (val) {
      filledCount++;
      const row = document.createElement('div');
      row.className = 'mapped-item';
      row.innerHTML = `
        <span class="mapped-item__label" title="${escapeHtml(f.label || f.id)}">${escapeHtml(f.label || f.id)}</span>
        <span class="mapped-item__val" title="${escapeHtml(val)}">${escapeHtml(val)}</span>
      `;
      mappedList.appendChild(row);
    }
  });

  mappedCountBadge.textContent = `${filledCount} / ${uniqueDefs.length || parsedFields.length} fields filled`;
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

  // Clear stale cached questions and answers on popup init to prevent old sessions from persisting
  chrome.storage.local.remove(['lastParsedFields', 'lastMappedEntries']);

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
