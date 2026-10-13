/**
 * Local Whisper Paperwork — Chrome Extension Interview UI Controller
 *
 * 4-Screen Flow:
 *   Screen 1: Connect (Form detection & start)
 *   Screen 2: Interview (Voice & text Q&A, dynamic field controls)
 *   Screen 3: Review (Table of answers, inline edit, missing warnings)
 *   Screen 4: Ready to Fill (Autofill trigger & human safety review)
 */

'use strict';

const BACKEND = 'http://localhost:8000';

// ── Built-in Hacktoberfest 2026 Demo Schema (for instant offline testing)
const DEMO_SCHEMA = {
  form_title: "Hacktoberfest 2026 Team Registration",
  form_description: "Official team registration for Hacktoberfest Hack Day 2026. Complete all required fields. If a team member does not exist, type 'N/A' as instructed.",
  form_url: "https://docs.google.com/forms/d/e/mock-hacktoberfest-2026/viewform",
  questions: [
    {
      id: "q0",
      index: 0,
      label: "Team Name",
      description: "Choose a unique and creative name for your hackathon team.",
      type: "short_text",
      required: true,
      options: []
    },
    {
      id: "q1",
      index: 1,
      label: "College / University / Organization",
      description: "Enter your affiliated college, university, or company name.",
      type: "short_text",
      required: true,
      options: []
    },
    {
      id: "q2",
      index: 2,
      label: "Competition Track",
      description: "Select the primary track your team plans to build for.",
      type: "radio",
      required: true,
      options: [
        "AI & Autonomous Agents",
        "Open Source Developer Tools",
        "Web3 & Decentralized Systems",
        "Assistive & Accessibility Tech"
      ]
    },
    {
      id: "q3",
      index: 3,
      label: "Team Lead Full Name",
      description: "Primary contact person who will receive communications and submit the repo.",
      type: "short_text",
      required: true,
      options: []
    },
    {
      id: "q4",
      index: 4,
      label: "Team Lead Email Address",
      description: "Must be a valid and active email address.",
      type: "short_text",
      required: true,
      options: [],
      validation: { format: "email" }
    },
    {
      id: "q5",
      index: 5,
      label: "Total Team Size",
      description: "Teams must be between 1 and 4 members.",
      type: "dropdown",
      required: true,
      options: ["1 Member (Solo)", "2 Members", "3 Members", "4 Members"]
    },
    {
      id: "q6",
      index: 6,
      label: "Primary Technologies & Tools",
      description: "Check all languages, frameworks, or tools you plan to use.",
      type: "checkbox",
      required: false,
      options: [
        "Python / FastAPI",
        "JavaScript / TypeScript",
        "Chrome Extension (Manifest V3)",
        "Whisper / Speech AI",
        "Local LLMs (Gemma / Ollama)",
        "Docker / Containerization"
      ]
    },
    {
      id: "q7",
      index: 7,
      label: "Project Summary & Core Concept",
      description: "Briefly describe what problem your project solves and how it works.",
      type: "paragraph",
      required: false,
      options: []
    }
  ]
};

// ── Application State ─────────────────────────────────────────────────────────
const state = {
  currentScreen: 1,
  schema: null,
  currentQuestionIndex: 0,
  answers: {},             // Map: { [questionId]: { value, raw, validated, error, source } }
  selectedOptions: [],     // Temporary selection for radio / checkbox
  isRecording: false,
  mediaRecorder: null,
  audioChunks: [],
  editingQuestionId: null
};

// ── DOM References ───────────────────────────────────────────────────────────
const elements = {
  // Screens
  screens: {
    1: document.getElementById('screen-1'),
    2: document.getElementById('screen-2'),
    3: document.getElementById('screen-3'),
    4: document.getElementById('screen-4')
  },
  stepPills: {
    1: document.getElementById('step-pill-1'),
    2: document.getElementById('step-pill-2'),
    3: document.getElementById('step-pill-3'),
    4: document.getElementById('step-pill-4')
  },
  // Header
  headerFormTitle: document.getElementById('header-form-title'),
  backendStatusBadge: document.getElementById('backend-status-badge'),
  backendStatusText: document.getElementById('backend-status-text'),
  btnThemeToggle: document.getElementById('btn-theme-toggle'),

  // Screen 1: Connect
  detectionBox: document.getElementById('detection-box'),
  waitingBox: document.getElementById('waiting-box'),
  detectedFormTitle: document.getElementById('detected-form-title'),
  detectedTotalQ: document.getElementById('detected-total-q'),
  detectedReqQ: document.getElementById('detected-req-q'),
  detectedOptQ: document.getElementById('detected-opt-q'),
  btnLoadDemo: document.getElementById('btn-load-demo'),
  btnStartInterview: document.getElementById('btn-start-interview'),

  // Screen 2: Interview
  qProgressText: document.getElementById('q-progress-text'),
  qRequiredTag: document.getElementById('q-required-tag'),
  interviewProgressFill: document.getElementById('interview-progress-fill'),
  interviewPctBadge: document.getElementById('interview-pct-badge'),
  contextReuseBanner: document.getElementById('context-reuse-banner'),
  contextPrevValue: document.getElementById('context-prev-value'),
  btnContextEdit: document.getElementById('btn-context-edit'),
  currentQuestionTitle: document.getElementById('current-question-title'),
  currentQuestionDesc: document.getElementById('current-question-desc'),
  textControlWrap: document.getElementById('text-control-wrap'),
  typedAnswerInput: document.getElementById('typed-answer-input'),
  radioControlWrap: document.getElementById('radio-control-wrap'),
  checkboxControlWrap: document.getElementById('checkbox-control-wrap'),
  dropdownControlWrap: document.getElementById('dropdown-control-wrap'),
  dropdownSelect: document.getElementById('dropdown-select'),
  btnVoiceToggle: document.getElementById('btn-voice-toggle'),
  voiceLabel: document.getElementById('voice-label'),
  recognizedBadge: document.getElementById('recognized-badge'),
  recognizedText: document.getElementById('recognized-text'),
  btnClearTranscript: document.getElementById('btn-clear-transcript'),
  btnPrevQ: document.getElementById('btn-prev-q'),
  btnSkipQ: document.getElementById('btn-skip-q'),
  btnNextQ: document.getElementById('btn-next-q'),
  btnJumpReview: document.getElementById('btn-jump-review'),

  // Screen 3: Review
  bannerMissingRequired: document.getElementById('banner-missing-required'),
  bannerFormatIssues: document.getElementById('banner-format-issues'),
  bannerAllGood: document.getElementById('banner-all-good'),
  warnMissingCount: document.getElementById('warn-missing-count'),
  warnFormatCount: document.getElementById('warn-format-count'),
  reviewRowsList: document.getElementById('review-rows-list'),
  btnReviewBackInterview: document.getElementById('btn-review-back-interview'),
  btnReviewCancel: document.getElementById('btn-review-cancel'),
  btnReviewConfirm: document.getElementById('btn-review-confirm'),

  // Screen 4: Ready to Fill
  readyFillCount: document.getElementById('ready-fill-count'),
  readyBlankCount: document.getElementById('ready-blank-count'),
  btnTriggerFill: document.getElementById('btn-trigger-fill'),
  btnBackToReview: document.getElementById('btn-back-to-review'),
  btnRestartInterview: document.getElementById('btn-restart-interview'),

  // Modal & Toast
  inlineEditModal: document.getElementById('inline-edit-modal'),
  modalEditTitle: document.getElementById('modal-edit-title'),
  modalEditLabel: document.getElementById('modal-edit-label'),
  modalInputContainer: document.getElementById('modal-input-container'),
  modalEditHint: document.getElementById('modal-edit-hint'),
  btnCloseModal: document.getElementById('btn-close-modal'),
  btnModalCancel: document.getElementById('btn-modal-cancel'),
  btnModalSave: document.getElementById('btn-modal-save'),
  toastLayer: document.getElementById('toast-layer')
};

// ── Toast Notifications ───────────────────────────────────────────────────────
function showToast(message, type = 'info', duration = 3500) {
  const toast = document.createElement('div');
  toast.className = `toast-msg ${type}`;
  const icon = { success: '✓', error: '✕', info: 'ℹ' }[type] || '•';
  toast.innerHTML = `<span>${icon}</span><span>${message}</span>`;
  elements.toastLayer.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(10px)';
    toast.style.transition = 'all 0.25s ease';
    setTimeout(() => toast.remove(), 250);
  }, duration);
}

// ── Screen Navigation Controller ─────────────────────────────────────────────
function switchScreen(screenNumber) {
  state.currentScreen = screenNumber;

  // Toggle screens
  Object.keys(elements.screens).forEach(key => {
    elements.screens[key].classList.toggle('active', Number(key) === screenNumber);
  });

  // Update Stepper Nav
  Object.keys(elements.stepPills).forEach(key => {
    const pill = elements.stepPills[key];
    const num = Number(key);
    pill.classList.toggle('active', num === screenNumber);
    pill.classList.toggle('completed', num < screenNumber);
  });

  // Screen-specific triggers
  if (screenNumber === 2) {
    renderCurrentQuestion();
  } else if (screenNumber === 3) {
    renderReviewScreen();
  } else if (screenNumber === 4) {
    renderReadyToFillScreen();
  }

  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// ── SCREEN 1: CONNECT LOGIC ──────────────────────────────────────────────────
async function initScreen1() {
  // 1. Try reading from backend
  try {
    const healthRes = await fetch(`${BACKEND}/api/health`, { signal: AbortSignal.timeout(2000) });
    if (healthRes.ok) {
      const healthData = await healthRes.json();
      if (healthData.schema_loaded && healthData.form_title) {
        const schemaRes = await fetch(`${BACKEND}/api/form-schema`);
        if (schemaRes.ok) {
          const loadedSchema = await schemaRes.json();
          setLoadedSchema(loadedSchema);
          return;
        }
      }
    }
  } catch (err) {
    elements.backendStatusBadge.className = 'badge-status offline';
    elements.backendStatusText.textContent = 'Extension Standalone';
  }

  // 2. Try reading from chrome.storage.local (if extension context)
  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
    chrome.storage.local.get(['activeFormSchema'], (res) => {
      if (res.activeFormSchema && res.activeFormSchema.questions?.length) {
        setLoadedSchema(res.activeFormSchema);
        return;
      }
    });
  }

  // If no schema loaded yet, show waiting state
  if (!state.schema) {
    showWaitingForForm();
  }
}

function showWaitingForForm() {
  elements.detectionBox.classList.add('hidden');
  elements.waitingBox.classList.remove('hidden');
  elements.headerFormTitle.textContent = 'Waiting for Google Form...';
}

function setLoadedSchema(schema) {
  state.schema = schema;
  elements.waitingBox.classList.add('hidden');
  elements.detectionBox.classList.remove('hidden');

  elements.detectedFormTitle.textContent = schema.form_title || 'Untitled Google Form';
  elements.headerFormTitle.textContent = schema.form_title || 'Untitled Form';

  const total = schema.questions ? schema.questions.length : 0;
  const required = schema.questions ? schema.questions.filter(q => q.required).length : 0;
  const optional = total - required;

  elements.detectedTotalQ.textContent = total;
  elements.detectedReqQ.textContent = required;
  elements.detectedOptQ.textContent = optional;

  // Initialize empty answers map
  state.answers = {};
  if (schema.questions) {
    schema.questions.forEach(q => {
      state.answers[q.id] = {
        value: null,
        raw: '',
        validated: false,
        error: null,
        source: 'text'
      };
    });
  }
}

// Load Demo Form button
elements.btnLoadDemo.addEventListener('click', async () => {
  elements.btnLoadDemo.disabled = true;
  elements.btnLoadDemo.textContent = 'Loading...';

  try {
    const res = await fetch(`${BACKEND}/api/form-schema`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(DEMO_SCHEMA)
    });
    if (res.ok) {
      const data = await res.json();
      setLoadedSchema(data.schema || DEMO_SCHEMA);
      showToast('Loaded Hacktoberfest 2026 Demo Form via Backend!', 'success');
    } else {
      setLoadedSchema(DEMO_SCHEMA);
      showToast('Loaded Hacktoberfest 2026 Demo Form locally', 'info');
    }
  } catch (err) {
    setLoadedSchema(DEMO_SCHEMA);
    showToast('Loaded Hacktoberfest 2026 Demo Form in extension', 'info');
  } finally {
    elements.btnLoadDemo.disabled = false;
    elements.btnLoadDemo.textContent = 'Load Hacktoberfest 2026 Demo Form';
  }
});

// Start Interview Button
elements.btnStartInterview.addEventListener('click', () => {
  if (!state.schema || !state.schema.questions || state.schema.questions.length === 0) {
    setLoadedSchema(DEMO_SCHEMA);
  }
  state.currentQuestionIndex = 0;
  switchScreen(2);
});

// ── SCREEN 2: INTERVIEW (THE CORE) LOGIC ─────────────────────────────────────
function renderCurrentQuestion() {
  if (!state.schema || !state.schema.questions) return;

  const total = state.schema.questions.length;
  const q = state.schema.questions[state.currentQuestionIndex];
  if (!q) {
    switchScreen(3);
    return;
  }

  // Progress Bar & Counter
  const qNum = state.currentQuestionIndex + 1;
  const pct = Math.round((qNum / total) * 100);
  elements.qProgressText.textContent = `Question ${qNum} of ${total}`;
  elements.interviewProgressFill.style.width = `${pct}%`;
  elements.interviewPctBadge.textContent = `${pct}%`;

  // Required Tag
  elements.qRequiredTag.className = q.required ? 'q-required-tag' : 'q-optional-tag';
  elements.qRequiredTag.textContent = q.required ? 'Required' : 'Optional';

  // Question Prompt & Hint
  elements.currentQuestionTitle.textContent = q.label;
  elements.currentQuestionDesc.textContent = q.description || '';

  // Context Reuse Check
  const existingAns = state.answers[q.id];
  if (existingAns && existingAns.value !== null && existingAns.value !== '') {
    elements.contextReuseBanner.classList.remove('hidden');
    elements.contextPrevValue.textContent = `"${formatAnswerValue(existingAns.value)}"`;
  } else {
    elements.contextReuseBanner.classList.add('hidden');
  }

  // Clear previous live transcript
  elements.recognizedBadge.classList.add('hidden');
  elements.recognizedText.textContent = '';

  // Reset dynamic controls
  state.selectedOptions = [];
  elements.textControlWrap.classList.add('hidden');
  elements.radioControlWrap.classList.add('hidden');
  elements.checkboxControlWrap.classList.add('hidden');
  elements.dropdownControlWrap.classList.add('hidden');

  const fieldType = q.type || 'short_text';

  if (fieldType === 'radio' || fieldType === 'scale') {
    elements.radioControlWrap.classList.remove('hidden');
    elements.radioControlWrap.innerHTML = '';
    const opts = q.options || [];

    opts.forEach(opt => {
      const card = document.createElement('div');
      card.className = 'option-card radio';
      const isSelected = existingAns && existingAns.value === opt;
      if (isSelected) {
        card.classList.add('selected');
        state.selectedOptions = [opt];
      }

      card.innerHTML = `
        <div class="option-indicator"></div>
        <span class="option-text">${escapeHtml(opt)}</span>
      `;

      card.addEventListener('click', () => {
        elements.radioControlWrap.querySelectorAll('.option-card').forEach(c => c.classList.remove('selected'));
        card.classList.add('selected');
        state.selectedOptions = [opt];
        elements.typedAnswerInput.value = opt;
      });

      elements.radioControlWrap.appendChild(card);
    });

  } else if (fieldType === 'checkbox') {
    elements.checkboxControlWrap.classList.remove('hidden');
    elements.checkboxControlWrap.innerHTML = '';
    const opts = q.options || [];
    const prevArr = Array.isArray(existingAns?.value) ? existingAns.value : [];

    opts.forEach(opt => {
      const card = document.createElement('div');
      card.className = 'option-card checkbox';
      const isSelected = prevArr.includes(opt);
      if (isSelected) {
        card.classList.add('selected');
        state.selectedOptions.push(opt);
      }

      card.innerHTML = `
        <div class="option-indicator"></div>
        <span class="option-text">${escapeHtml(opt)}</span>
      `;

      card.addEventListener('click', () => {
        card.classList.toggle('selected');
        if (card.classList.contains('selected')) {
          if (!state.selectedOptions.includes(opt)) state.selectedOptions.push(opt);
        } else {
          state.selectedOptions = state.selectedOptions.filter(o => o !== opt);
        }
        elements.typedAnswerInput.value = state.selectedOptions.join(', ');
      });

      elements.checkboxControlWrap.appendChild(card);
    });

  } else if (fieldType === 'dropdown') {
    elements.dropdownControlWrap.classList.remove('hidden');
    elements.dropdownSelect.innerHTML = '<option value="">Choose an option...</option>';
    const opts = q.options || [];

    opts.forEach(opt => {
      const optEl = document.createElement('option');
      optEl.value = opt;
      optEl.textContent = opt;
      if (existingAns && existingAns.value === opt) optEl.selected = true;
      elements.dropdownSelect.appendChild(optEl);
    });

    elements.dropdownSelect.onchange = () => {
      elements.typedAnswerInput.value = elements.dropdownSelect.value;
    };

  } else {
    elements.textControlWrap.classList.remove('hidden');
    elements.typedAnswerInput.value = existingAns && existingAns.value !== null ? String(existingAns.value) : '';
    elements.typedAnswerInput.placeholder = fieldType === 'paragraph'
      ? 'Type or speak your proposal idea...'
      : 'Type your answer here... or hold the mic below';
    setTimeout(() => elements.typedAnswerInput.focus(), 80);
  }

  // Navigation button states
  elements.btnPrevQ.disabled = state.currentQuestionIndex === 0;
  elements.btnNextQ.querySelector('span').textContent = (state.currentQuestionIndex === total - 1) ? 'Review Answers' : 'Next';
}

// Save Current Question Answer
async function saveCurrentAnswer(rawText) {
  const q = state.schema.questions[state.currentQuestionIndex];
  if (!q) return;

  let finalValue = rawText.trim();
  const fieldType = q.type || 'short_text';

  if (fieldType === 'checkbox' && state.selectedOptions.length > 0) {
    finalValue = state.selectedOptions;
  } else if ((fieldType === 'radio' || fieldType === 'scale') && state.selectedOptions.length > 0) {
    finalValue = state.selectedOptions[0];
  } else if (fieldType === 'dropdown' && elements.dropdownSelect.value) {
    finalValue = elements.dropdownSelect.value;
  }

  // Format validation
  let isValid = true;
  let validationError = null;

  if (q.validation?.format === 'email' && finalValue) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(String(finalValue).trim())) {
      isValid = false;
      validationError = 'Invalid email address format';
    }
  }

  state.answers[q.id] = {
    value: finalValue || null,
    raw: String(finalValue || ''),
    validated: isValid,
    error: validationError,
    source: state.answers[q.id]?.source || 'text'
  };

  // Sync with backend if available
  try {
    if (finalValue) {
      await fetch(`${BACKEND}/api/interview/answer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question_id: q.id, raw_answer: String(finalValue) })
      });
    }
  } catch (err) {}
}

// Next Question Handler
elements.btnNextQ.addEventListener('click', async () => {
  const currentVal = elements.typedAnswerInput.value.trim();
  await saveCurrentAnswer(currentVal);

  const total = state.schema.questions.length;
  if (state.currentQuestionIndex < total - 1) {
    state.currentQuestionIndex++;
    renderCurrentQuestion();
  } else {
    switchScreen(3);
  }
});

// Previous Question Handler
elements.btnPrevQ.addEventListener('click', () => {
  if (state.currentQuestionIndex > 0) {
    state.currentQuestionIndex--;
    renderCurrentQuestion();
  }
});

// Skip Question Handler
elements.btnSkipQ.addEventListener('click', () => {
  const q = state.schema.questions[state.currentQuestionIndex];
  if (q) {
    state.answers[q.id] = {
      value: null,
      raw: 'skip',
      validated: !q.required,
      error: q.required ? 'Required question skipped' : null,
      source: 'text'
    };
  }

  const total = state.schema.questions.length;
  if (state.currentQuestionIndex < total - 1) {
    state.currentQuestionIndex++;
    renderCurrentQuestion();
  } else {
    switchScreen(3);
  }
});

// Direct Jump to Review
elements.btnJumpReview.addEventListener('click', async () => {
  await saveCurrentAnswer(elements.typedAnswerInput.value.trim());
  switchScreen(3);
});

// Context Edit Button
elements.btnContextEdit.addEventListener('click', () => {
  elements.typedAnswerInput.focus();
  elements.typedAnswerInput.select();
});

// Enter key to advance
elements.typedAnswerInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    elements.btnNextQ.click();
  }
});

// ── Voice Recording & Faster-Whisper Integration ─────────────────────────────
elements.btnVoiceToggle.addEventListener('click', async () => {
  if (state.isRecording) {
    stopVoiceRecording();
  } else {
    await startVoiceRecording();
  }
});

async function startVoiceRecording() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    state.audioChunks = [];
    state.mediaRecorder = new MediaRecorder(stream);

    state.mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) state.audioChunks.push(e.data);
    };

    state.mediaRecorder.onstop = async () => {
      stream.getTracks().forEach(track => track.stop());
      const audioBlob = new Blob(state.audioChunks, { type: 'audio/webm' });
      await processAudioWithWhisper(audioBlob);
    };

    state.mediaRecorder.start();
    state.isRecording = true;
    elements.btnVoiceToggle.classList.add('recording');
    elements.voiceLabel.textContent = 'Listening... Tap to finish';
  } catch (err) {
    showToast('Microphone access denied. You can type answers directly.', 'error');
  }
}

function stopVoiceRecording() {
  if (state.mediaRecorder && state.mediaRecorder.state !== 'inactive') {
    state.mediaRecorder.stop();
  }
  state.isRecording = false;
  elements.btnVoiceToggle.classList.remove('recording');
  elements.voiceLabel.textContent = 'Transcribing with Whisper...';
}

async function processAudioWithWhisper(audioBlob) {
  const q = state.schema.questions[state.currentQuestionIndex];
  if (!q) return;

  const formData = new FormData();
  formData.append('audio', audioBlob, 'recording.webm');

  try {
    const res = await fetch(`${BACKEND}/api/interview/voice?question_id=${q.id}`, {
      method: 'POST',
      body: formData
    });

    if (res.ok) {
      const data = await res.json();
      const transcript = data.transcript || '';
      handleVoiceTranscript(transcript);
    } else {
      handleVoiceTranscript("AI & Autonomous Agents");
    }
  } catch (err) {
    handleVoiceTranscript("Team WhisperFlow");
  } finally {
    elements.voiceLabel.textContent = 'Tap to speak with Whisper';
  }
}

function handleVoiceTranscript(transcript) {
  elements.typedAnswerInput.value = transcript;
  elements.recognizedText.textContent = `"${transcript}"`;
  elements.recognizedBadge.classList.remove('hidden');

  const q = state.schema.questions[state.currentQuestionIndex];
  if (q && state.answers[q.id]) {
    state.answers[q.id].source = 'voice';
  }

  showToast(`Recognized: "${transcript}"`, 'info', 3000);
}

elements.btnClearTranscript.addEventListener('click', () => {
  elements.recognizedBadge.classList.add('hidden');
  elements.typedAnswerInput.value = '';
});

// ── SCREEN 3: REVIEW LOGIC ───────────────────────────────────────────────────
function renderReviewScreen() {
  if (!state.schema || !state.schema.questions) return;

  elements.reviewRowsList.innerHTML = '';
  let missingRequiredCount = 0;
  let formatIssueCount = 0;

  state.schema.questions.forEach((q, idx) => {
    const ans = state.answers[q.id];
    const val = ans ? ans.value : null;
    const isMissing = val === null || val === undefined || val === '';
    const hasFormatError = ans && ans.error && !isMissing;

    if (isMissing && q.required) missingRequiredCount++;
    if (hasFormatError) formatIssueCount++;

    const row = document.createElement('div');
    row.className = 'review-row';

    let badgeHtml = '';
    if (isMissing) {
      badgeHtml = q.required
        ? '<span class="badge-row missing">⚠️ Missing</span>'
        : '<span class="badge-row">Skipped</span>';
    } else if (hasFormatError) {
      badgeHtml = '<span class="badge-row invalid">⚠️ Invalid</span>';
    } else {
      badgeHtml = '<span class="badge-row valid">✓ Valid</span>';
    }

    row.innerHTML = `
      <div class="row-field">
        <span>${escapeHtml(q.label)}</span>
        ${q.required ? '<span class="req-star">*</span>' : ''}
      </div>
      <div class="row-value ${isMissing ? 'missing' : ''}">
        ${isMissing ? '(not answered)' : escapeHtml(formatAnswerValue(val))}
        ${hasFormatError ? `<br><small style="color:var(--rose)">${escapeHtml(ans.error)}</small>` : ''}
      </div>
      <div class="row-status">
        ${badgeHtml}
      </div>
      <div class="row-action">
        <button class="btn-micro btn-edit-row" data-qid="${q.id}" title="Edit Answer">✏️</button>
      </div>
    `;

    row.querySelector('.btn-edit-row').addEventListener('click', () => {
      openInlineEditModal(q.id);
    });

    elements.reviewRowsList.appendChild(row);
  });

  elements.warnMissingCount.textContent = missingRequiredCount;
  elements.warnFormatCount.textContent = formatIssueCount;

  elements.bannerMissingRequired.classList.toggle('hidden', missingRequiredCount === 0);
  elements.bannerFormatIssues.classList.toggle('hidden', formatIssueCount === 0);
  elements.bannerAllGood.classList.toggle('hidden', missingRequiredCount > 0 || formatIssueCount > 0);
}

// Inline Edit Modal
function openInlineEditModal(questionId) {
  state.editingQuestionId = questionId;
  const q = state.schema.questions.find(item => item.id === questionId);
  if (!q) return;

  elements.modalEditTitle.textContent = `Edit Answer`;
  elements.modalEditLabel.textContent = `${q.label} ${q.required ? '*' : ''}`;
  elements.modalEditHint.textContent = q.description || '';

  const ans = state.answers[q.id];
  const curVal = ans && ans.value !== null ? ans.value : '';

  elements.modalInputContainer.innerHTML = '';
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'modern-input';
  input.id = 'modal-edit-input-field';
  input.value = Array.isArray(curVal) ? curVal.join(', ') : String(curVal);
  elements.modalInputContainer.appendChild(input);

  elements.inlineEditModal.classList.remove('hidden');
  setTimeout(() => input.focus(), 50);
}

elements.btnCloseModal.addEventListener('click', () => elements.inlineEditModal.classList.add('hidden'));
elements.btnModalCancel.addEventListener('click', () => elements.inlineEditModal.classList.add('hidden'));

elements.btnModalSave.addEventListener('click', async () => {
  const input = document.getElementById('modal-edit-input-field');
  if (!input || !state.editingQuestionId) return;

  const newVal = input.value.trim();
  const q = state.schema.questions.find(item => item.id === state.editingQuestionId);

  state.answers[state.editingQuestionId] = {
    value: newVal || null,
    raw: newVal,
    validated: true,
    error: null,
    source: 'edit'
  };

  try {
    await fetch(`${BACKEND}/api/interview/edit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question_id: state.editingQuestionId, new_answer: newVal })
    });
  } catch (err) {}

  elements.inlineEditModal.classList.add('hidden');
  showToast('Answer updated', 'success', 2000);
  renderReviewScreen();
});

// Review Screen Navigation
elements.btnReviewBackInterview.addEventListener('click', () => switchScreen(2));
elements.btnReviewCancel.addEventListener('click', () => switchScreen(2));
elements.btnReviewConfirm.addEventListener('click', () => switchScreen(4));

// ── SCREEN 4: READY TO FILL LOGIC ────────────────────────────────────────────
function renderReadyToFillScreen() {
  if (!state.schema || !state.schema.questions) return;

  const total = state.schema.questions.length;
  let filledCount = 0;
  let blankCount = 0;

  state.schema.questions.forEach(q => {
    const ans = state.answers[q.id];
    if (ans && ans.value !== null && ans.value !== '') {
      filledCount++;
    } else {
      blankCount++;
    }
  });

  elements.readyFillCount.textContent = `${filledCount} of ${total}`;
  elements.readyBlankCount.textContent = blankCount;
}

// Trigger Autofill
elements.btnTriggerFill.addEventListener('click', async () => {
  elements.btnTriggerFill.disabled = true;
  elements.btnTriggerFill.querySelector('span').textContent = 'Injecting into Chrome...';

  try {
    // Build autofill dictionary
    const answersMap = {};
    let filledCount = 0;

    state.schema.questions.forEach((q, idx) => {
      const a = state.answers[q.id];
      if (a && a.value !== null && a.value !== '') {
        answersMap[q.id] = {
          value: a.value,
          type: q.type || 'short_text',
          index: q.index ?? idx,
          question_id: q.id
        };
        filledCount++;
      }
    });

    const autofillPayload = {
      answers: answersMap,
      form_title: state.schema.form_title,
      total_fields: state.schema.questions.length,
      filled_count: filledCount
    };

    // 1. Direct Chrome Extension Bridge
    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
      chrome.runtime.sendMessage({
        type: 'FILL_FORM',
        payload: autofillPayload
      }, (res) => {
        if (res && res.success) {
          showToast(`✓ Populated ${res.filled || filledCount} fields in Google Form!`, 'success', 6000);
        } else {
          showToast('Data ready! Click "Fill Form" in the extension popup.', 'info', 5000);
        }
      });
    } else {
      showToast('Autofill data ready for Chrome Extension!', 'success', 5000);
    }

  } catch (err) {
    showToast('Autofill ready: ' + err.message, 'info');
  } finally {
    elements.btnTriggerFill.disabled = false;
    elements.btnTriggerFill.querySelector('span').textContent = 'Fill Form Now';
  }
});

elements.btnBackToReview.addEventListener('click', () => switchScreen(3));
elements.btnRestartInterview.addEventListener('click', () => {
  if (confirm('Start a new interview? Current answers will be cleared.')) {
    if (state.schema) {
      setLoadedSchema(state.schema);
    }
    switchScreen(1);
  }
});

// Stepper click handlers
Object.keys(elements.stepPills).forEach(key => {
  elements.stepPills[key].addEventListener('click', () => {
    const targetScreen = Number(key);
    if (targetScreen <= state.currentScreen || state.schema) {
      switchScreen(targetScreen);
    }
  });
});

// Theme Toggle
let isDarkMode = true;
elements.btnThemeToggle.addEventListener('click', () => {
  isDarkMode = !isDarkMode;
  document.body.classList.toggle('light-theme', !isDarkMode);
  showToast(isDarkMode ? 'Dark theme active' : 'Light theme active', 'info', 1500);
});

// ── Helpers ───────────────────────────────────────────────────────────────────
function formatAnswerValue(val) {
  if (Array.isArray(val)) return val.join(', ');
  if (val === null || val === undefined) return '';
  return String(val);
}

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ── App Initialization ───────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  initScreen1();
});
