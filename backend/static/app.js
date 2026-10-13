/**
 * app.js — Interview UI controller
 *
 * Handles:
 *  - Fetching the next question from the backend
 *  - Rendering questions (text, radio chips, checkbox chips)
 *  - Submitting typed and voice (MediaRecorder) answers
 *  - Updating the sidebar progress ring and answer history
 *  - Review overlay with inline editing
 *  - Triggering autofill via the Chrome extension message
 */

'use strict';

const API = '';  // Same origin — backend serves this file

// ── State ─────────────────────────────────────────────────────────────────────
let currentQuestion = null;
let selectedOptions = [];    // For radio/checkbox chips
let mediaRecorder   = null;
let audioChunks     = [];
let isRecording     = false;

// ── DOM refs ──────────────────────────────────────────────────────────────────
const stateNoSchema  = document.getElementById('state-no-schema');
const stateInterview = document.getElementById('state-interview');
const stateComplete  = document.getElementById('state-complete');

const formTitleDisplay = document.getElementById('form-title-display');
const ringFill         = document.getElementById('ring-fill');
const pctText          = document.getElementById('pct-text');
const statAnswered     = document.getElementById('stat-answered');
const statRemaining    = document.getElementById('stat-remaining');
const statTotal        = document.getElementById('stat-total');
const answerList       = document.getElementById('answer-list');

const qBadge       = document.getElementById('q-badge');
const questionText = document.getElementById('question-text');
const questionHint = document.getElementById('question-hint');
const optionsList  = document.getElementById('options-list');

const btnMic           = document.getElementById('btn-mic');
const micLabel         = document.getElementById('mic-label');
const transcriptPreview= document.getElementById('transcript-preview');
const transcriptText   = document.getElementById('transcript-text');
const answerInput      = document.getElementById('answer-input');
const btnSend          = document.getElementById('btn-send');

const reviewOverlay    = document.getElementById('review-overlay');
const reviewList       = document.getElementById('review-list');

// ── Toast ─────────────────────────────────────────────────────────────────────
function toast(msg, type = 'info', duration = 3500) {
  const container = document.getElementById('toast-container');
  const el = document.createElement('div');
  el.className = `toast ${type}`;

  const icon = { success: '✅', error: '❌', info: 'ℹ️' }[type] || '';
  el.innerHTML = `<span>${icon}</span><span>${msg}</span>`;
  container.appendChild(el);

  setTimeout(() => {
    el.style.opacity = '0';
    el.style.transition = 'opacity 0.3s';
    setTimeout(() => el.remove(), 300);
  }, duration);
}

// ── State display ─────────────────────────────────────────────────────────────
function showState(state) {
  stateNoSchema.classList.add('hidden');
  stateInterview.classList.add('hidden');
  stateComplete.classList.add('hidden');
  state.classList.remove('hidden');
}

// ── Progress ring ─────────────────────────────────────────────────────────────
function updateProgress(status) {
  const CIRCUMFERENCE = 125.66; // 2π × 20
  const pct = status.completion_percent ?? 0;
  const offset = CIRCUMFERENCE - (pct / 100) * CIRCUMFERENCE;

  ringFill.style.strokeDashoffset = offset;
  pctText.textContent = `${Math.round(pct)}%`;
  statAnswered.textContent  = status.answered ?? 0;
  statRemaining.textContent = (status.required_remaining ?? 0) + (status.optional_remaining ?? 0);
  statTotal.textContent     = status.total_questions ?? 0;
}

// ── Sidebar answer list ───────────────────────────────────────────────────────
function updateAnswerList(answers) {
  if (!answers?.length) return;

  const filled = answers.filter(a => a.answered);
  if (!filled.length) return;

  answerList.innerHTML = '';
  filled.forEach(a => {
    const div = document.createElement('div');
    div.className = 'answer-item';
    div.onclick = () => openEditInline(a.question_id);
    div.innerHTML = `
      <div class="answer-item-label">
        <div class="dot ${a.validated ? '' : 'invalid'}"></div>
        <span>${escHtml(a.label)}</span>
      </div>
      <div class="answer-item-value">${escHtml(formatValue(a.value))}</div>
    `;
    answerList.appendChild(div);
  });
}

// ── Load next question ────────────────────────────────────────────────────────
async function loadNextQuestion() {
  try {
    const res = await fetch(`${API}/api/interview/next`);
    if (!res.ok) {
      const err = await res.json();
      if (res.status === 400 && err.detail?.includes('No form schema')) {
        showState(stateNoSchema);
        return;
      }
      throw new Error(err.detail ?? 'Failed to load question');
    }

    const data = await res.json();

    if (data.complete) {
      showState(stateComplete);
      await refreshStatus();
      return;
    }

    currentQuestion = data.question;
    selectedOptions = [];
    renderQuestion(currentQuestion);
    showState(stateInterview);
    await refreshStatus();

  } catch (err) {
    toast(err.message, 'error');
    console.error(err);
  }
}

// ── Render question ───────────────────────────────────────────────────────────
function renderQuestion(q) {
  qBadge.textContent = `Q${(q.question_id || '').replace('q', '') | 0 + 1} · ${q.required ? 'Required' : 'Optional'}`;
  questionText.textContent = q.question_text;
  questionHint.textContent = q.hint || '';
  answerInput.value = '';
  answerInput.placeholder = 'Type your answer… (or use mic above)';
  transcriptPreview.classList.add('hidden');

  // Render option chips for choice fields
  optionsList.innerHTML = '';
  if (q.options?.length) {
    q.options.forEach(opt => {
      const chip = document.createElement('button');
      chip.className = 'option-chip';
      chip.textContent = opt;
      chip.onclick = () => {
        if (q.field_type === 'checkbox') {
          chip.classList.toggle('selected');
          selectedOptions = Array.from(optionsList.querySelectorAll('.option-chip.selected'))
            .map(c => c.textContent);
        } else {
          optionsList.querySelectorAll('.option-chip').forEach(c => c.classList.remove('selected'));
          chip.classList.add('selected');
          selectedOptions = [opt];
          answerInput.value = opt;
        }
      };
      optionsList.appendChild(chip);
    });
  }

  // Focus input after render
  setTimeout(() => answerInput.focus(), 100);
}

// ── Submit answer ─────────────────────────────────────────────────────────────
async function submitAnswer(rawAnswer) {
  if (!currentQuestion) return;

  const questionId = currentQuestion.question_id;

  // For checkbox: join selected options if chips were used
  const finalAnswer = (selectedOptions.length && currentQuestion.field_type === 'checkbox')
    ? selectedOptions.join(', ')
    : rawAnswer;

  if (!finalAnswer.trim()) {
    toast('Please type an answer or say "skip" to skip.', 'info');
    return;
  }

  btnSend.disabled = true;

  try {
    const res = await fetch(`${API}/api/interview/answer`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question_id: questionId, raw_answer: finalAnswer }),
    });

    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.detail ?? 'Failed to submit answer');
    }

    if (!data.answer.validated && data.answer.validation_error) {
      toast(`⚠️ ${data.answer.validation_error}`, 'error', 5000);
    } else {
      toast('Answer saved', 'success', 1500);
    }

    updateProgress(data.status);
    await loadNextQuestion();

  } catch (err) {
    toast(err.message, 'error');
  } finally {
    btnSend.disabled = false;
  }
}

// ── Voice recording ───────────────────────────────────────────────────────────
btnMic.addEventListener('click', async () => {
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
    mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });

    mediaRecorder.ondataavailable = e => {
      if (e.data.size > 0) audioChunks.push(e.data);
    };

    mediaRecorder.onstop = async () => {
      stream.getTracks().forEach(t => t.stop());
      const blob = new Blob(audioChunks, { type: 'audio/webm' });
      await sendVoice(blob);
    };

    mediaRecorder.start(100);
    isRecording = true;
    btnMic.classList.add('recording');
    micLabel.textContent = 'Recording… tap to stop';

  } catch (err) {
    toast('Microphone access denied. Please check your browser permissions.', 'error');
  }
}

function stopRecording() {
  if (mediaRecorder?.state !== 'inactive') {
    mediaRecorder.stop();
  }
  isRecording = false;
  btnMic.classList.remove('recording');
  btnMic.classList.add('processing');
  micLabel.textContent = 'Transcribing…';
}

async function sendVoice(blob) {
  if (!currentQuestion) return;

  const formData = new FormData();
  formData.append('audio', blob, 'recording.webm');

  try {
    const res = await fetch(
      `${API}/api/interview/voice?question_id=${currentQuestion.question_id}`,
      { method: 'POST', body: formData }
    );

    const data = await res.json();

    if (!res.ok) throw new Error(data.detail ?? 'Voice processing failed');

    // Show transcript for review
    transcriptText.textContent = data.transcript;
    transcriptPreview.classList.remove('hidden');
    answerInput.value = data.transcript;

    toast(`Transcribed: "${data.transcript}"`, 'info', 4000);

    updateProgress(data.status);
    await loadNextQuestion();

  } catch (err) {
    toast(err.message, 'error');
  } finally {
    btnMic.classList.remove('processing');
    micLabel.textContent = 'Tap to speak';
  }
}

function clearTranscript() {
  transcriptPreview.classList.add('hidden');
  answerInput.value = '';
}

// ── Send button / Enter key ───────────────────────────────────────────────────
btnSend.addEventListener('click', () => submitAnswer(answerInput.value.trim()));

answerInput.addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    submitAnswer(answerInput.value.trim());
  }
});

// ── Refresh status ────────────────────────────────────────────────────────────
async function refreshStatus() {
  try {
    const res = await fetch(`${API}/api/interview/status`);
    if (!res.ok) return;
    const data = await res.json();

    updateProgress(data);
    updateAnswerList(data.answers);

    // Update form title
    try {
      const sr = await fetch(`${API}/api/form-schema`);
      if (sr.ok) {
        const schema = await sr.json();
        formTitleDisplay.textContent = schema.form_title || 'Untitled Form';
      }
    } catch {}

  } catch { /* silent */ }
}

// ── Review overlay ────────────────────────────────────────────────────────────
async function showReview() {
  reviewList.innerHTML = '<div style="padding:20px;text-align:center;color:var(--text-sub)">Loading…</div>';
  reviewOverlay.classList.remove('hidden');

  try {
    const res = await fetch(`${API}/api/interview/status`);
    const data = await res.json();
    renderReview(data.answers);
  } catch (err) {
    reviewList.innerHTML = `<div style="padding:20px;color:var(--error)">${err.message}</div>`;
  }
}

function hideReview() {
  reviewOverlay.classList.add('hidden');
}

function renderReview(answers) {
  reviewList.innerHTML = '';
  answers.forEach(a => {
    const div = document.createElement('div');
    div.className = 'review-entry';
    div.id = `review-${a.question_id}`;

    const statusClass = !a.answered ? 'badge-missing'
      : a.validated ? 'badge-ok' : 'badge-invalid';
    const statusText = !a.answered ? (a.required ? '⚠ Required' : 'Skipped')
      : a.validated ? 'Valid' : 'Needs review';

    div.innerHTML = `
      <div class="review-entry-label">
        <span class="review-label-text">${escHtml(a.label)}${a.required ? ' *' : ''}</span>
        <span class="review-status-badge ${statusClass}">${statusText}</span>
      </div>
      <div class="review-value ${!a.answered ? 'empty' : ''}">
        ${a.value !== null && a.value !== undefined ? escHtml(formatValue(a.value)) : '(not answered)'}
      </div>
      ${a.error ? `<div class="review-error">${escHtml(a.error)}</div>` : ''}
      <div class="review-edit-row">
        <input type="text" class="review-edit-input" id="edit-input-${a.question_id}"
               placeholder="Edit answer…" value="${a.value !== null && a.value !== undefined ? escHtml(String(a.value)) : ''}" />
        <button class="btn-outline btn-sm" onclick="saveEdit('${a.question_id}')">Save</button>
      </div>
    `;
    reviewList.appendChild(div);
  });
}

async function saveEdit(questionId) {
  const input = document.getElementById(`edit-input-${questionId}`);
  const newAnswer = input.value.trim();

  try {
    const res = await fetch(`${API}/api/interview/edit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question_id: questionId, new_answer: newAnswer }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail);
    toast('Answer updated', 'success', 1500);
    await showReview(); // re-render review
    await refreshStatus();
  } catch (err) {
    toast(err.message, 'error');
  }
}

function openEditInline(questionId) {
  showReview();
  setTimeout(() => {
    const entry = document.getElementById(`review-${questionId}`);
    if (entry) entry.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, 200);
}

// ── Fill form (send signal to extension) ──────────────────────────────────────
async function fillForm() {
  toast('Sending fill command to the Chrome extension…', 'info');
  // The actual fill is triggered by the extension popup's "Fill Form" button
  // which calls GET /api/autofill-data. Here we just confirm data is ready.
  try {
    const res = await fetch(`${API}/api/autofill-data`);
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.detail ?? 'Autofill data not ready');
    }
    toast('✅ Data ready! Click "Fill Form" in the extension popup.', 'success', 6000);
    hideReview();
  } catch (err) {
    toast(err.message, 'error');
  }
}

// ── Reset interview ───────────────────────────────────────────────────────────
async function resetInterview() {
  if (!confirm('Reset the interview? All answers will be cleared.')) return;
  await fetch(`${API}/api/interview/reset`, { method: 'POST' });
  toast('Interview reset', 'info');
  selectedOptions = [];
  answerList.innerHTML = '<div class="answer-list-empty">Answers will appear here as you go.</div>';
  await loadNextQuestion();
}

// ── Check status (for no-schema state button) ─────────────────────────────────
async function checkStatus() {
  await loadNextQuestion();
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function escHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatValue(val) {
  if (Array.isArray(val)) return val.join(', ');
  if (val === null || val === undefined) return '';
  return String(val);
}

// ── Init ──────────────────────────────────────────────────────────────────────
(async () => {
  await loadNextQuestion();
})();
