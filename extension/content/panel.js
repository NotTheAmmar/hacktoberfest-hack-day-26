/**
 * panel.js — Floating interview panel injected into the Google Form page.
 *
 * Triggered by the popup via chrome.runtime message { type: 'OPEN_PANEL' }.
 * Builds a 4-screen side panel overlay:
 *   Screen 1 — Connect   (form info + backend status)
 *   Screen 2 — Interview (Q&A one question at a time, voice + text)
 *   Screen 3 — Review    (edit answers, see warnings)
 *   Screen 4 — Fill      (confirm + trigger autofill)
 */

(() => {
  'use strict';

  let BACKEND = 'http://localhost:8000';
  if (typeof chrome !== 'undefined' && chrome?.storage?.local) {
    chrome.storage.local.get(['backendUrl'], (res) => {
      if (res?.backendUrl) BACKEND = res.backendUrl.replace(/\/+$/, '');
    });
  }

  // ── Prevent double-injection ───────────────────────────────────────────────
  if (document.getElementById('lwp-panel')) {
    document.getElementById('lwp-panel').classList.toggle('lwp-open');
    return;
  }

  // ── Inject stylesheet ──────────────────────────────────────────────────────
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = chrome.runtime.getURL('content/panel.css');
  document.head.appendChild(link);

  // ── State ──────────────────────────────────────────────────────────────────
  const state = {
    screen: 1,           // 1..4
    schema: null,        // form schema from backend
    answers: {},         // { questionId: answerValue }
    currentQIndex: 0,    // current question index in interview
    isRecording: false,
    mediaRecorder: null,
    audioChunks: [],
  };

  // ── Build HTML ─────────────────────────────────────────────────────────────
  const panel = document.createElement('div');
  panel.id = 'lwp-panel';
  panel.innerHTML = `
    <!-- Header -->
    <div class="lwp-header">
      <div class="lwp-brand">
        <div class="lwp-brand-icon">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
            <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/>
            <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
            <line x1="12" y1="19" x2="12" y2="22"/>
          </svg>
        </div>
        <div>
          <div class="lwp-brand-name">Whisper Paperwork</div>
          <div class="lwp-brand-sub" id="lwp-form-subtitle">Loading form…</div>
        </div>
      </div>
      <div class="lwp-header-actions">
        <button class="lwp-btn-icon" id="lwp-btn-minimize" title="Minimise">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="5" y1="12" x2="19" y2="12"/></svg>
        </button>
        <button class="lwp-btn-icon" id="lwp-btn-close" title="Close">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>
    </div>

    <!-- Stepper -->
    <div class="lwp-stepper">
      <div class="lwp-step active" id="lwp-step-1">
        <div class="lwp-step-num">1</div><span>Connect</span>
      </div>
      <div class="lwp-step-sep"></div>
      <div class="lwp-step" id="lwp-step-2">
        <div class="lwp-step-num">2</div><span>Interview</span>
      </div>
      <div class="lwp-step-sep"></div>
      <div class="lwp-step" id="lwp-step-3">
        <div class="lwp-step-num">3</div><span>Review</span>
      </div>
      <div class="lwp-step-sep"></div>
      <div class="lwp-step" id="lwp-step-4">
        <div class="lwp-step-num">4</div><span>Fill</span>
      </div>
    </div>

    <!-- Screens -->
    <div class="lwp-screens">

      <!-- Screen 1: Connect -->
      <div class="lwp-screen active" id="lwp-screen-1">
        <div class="lwp-connect-card">
          <div class="lwp-connect-label">Detected Form</div>
          <div class="lwp-connect-title" id="lwp-form-title">Detecting…</div>
          <div style="display:flex;align-items:center;gap:8px;">
            <span class="lwp-q-count" id="lwp-q-count">— questions</span>
            <span class="lwp-connect-meta" id="lwp-form-url"></span>
          </div>
        </div>

        <div class="lwp-connect-card">
          <div class="lwp-connect-label">Backend Status</div>
          <div class="lwp-status-row" id="lwp-backend-row">
            <div class="lwp-dot amber" id="lwp-backend-dot"></div>
            <span id="lwp-backend-text">Checking localhost:8000…</span>
          </div>
        </div>

        <div id="lwp-extract-status" style="font-size:12px;color:#64748b;text-align:center;display:none;"></div>
      </div>

      <!-- Screen 2: Interview -->
      <div class="lwp-screen" id="lwp-screen-2">
        <div class="lwp-progress-wrap">
          <div class="lwp-progress-bar">
            <div class="lwp-progress-fill" id="lwp-progress-fill" style="width:0%"></div>
          </div>
          <span id="lwp-progress-text" style="white-space:nowrap;">0 / 0</span>
        </div>

        <div class="lwp-question-card">
          <div class="lwp-q-label" id="lwp-q-label">Question 1</div>
          <div class="lwp-q-text" id="lwp-q-text">Loading question…</div>
          <div class="lwp-q-hint" id="lwp-q-hint"></div>
        </div>

        <div class="lwp-answer-area" id="lwp-answer-area">
          <!-- Populated dynamically based on question type -->
        </div>

        <div class="lwp-voice-row">
          <button class="lwp-btn-voice" id="lwp-btn-voice">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/></svg>
            Hold to speak
          </button>
          <span class="lwp-voice-status" id="lwp-voice-status"></span>
        </div>
      </div>

      <!-- Screen 3: Review -->
      <div class="lwp-screen" id="lwp-screen-3">
        <div style="font-size:13px;font-weight:600;color:#94a3b8;margin-bottom:4px;">Review your answers</div>
        <div id="lwp-review-list" style="display:flex;flex-direction:column;gap:8px;"></div>
        <div class="lwp-warning-banner" id="lwp-warnings" style="display:none;">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
          <span id="lwp-warnings-text">Some answers may need attention.</span>
        </div>
      </div>

      <!-- Screen 4: Fill -->
      <div class="lwp-screen" id="lwp-screen-4">
        <div class="lwp-ready-card">
          <div class="lwp-ready-icon">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>
          </div>
          <div class="lwp-ready-title">Ready to Fill!</div>
          <div class="lwp-ready-sub" id="lwp-ready-sub">All answers collected. Click below to autofill the form.</div>
        </div>

        <div id="lwp-fill-progress-wrap" style="display:none;flex-direction:column;gap:8px;">
          <div class="lwp-progress-bar">
            <div class="lwp-progress-fill" id="lwp-fill-progress-bar" style="width:0%"></div>
          </div>
          <div style="font-size:12px;color:#64748b;text-align:center;" id="lwp-fill-progress-text">Filling fields…</div>
        </div>

        <div id="lwp-fill-result" style="display:none;padding:12px;border-radius:8px;font-size:13px;text-align:center;"></div>
      </div>
    </div>

    <!-- Footer nav -->
    <div class="lwp-footer" id="lwp-footer">
      <button class="lwp-btn lwp-btn-ghost" id="lwp-btn-back" style="display:none;">← Back</button>
      <button class="lwp-btn lwp-btn-purple" id="lwp-btn-primary">Start Interview →</button>
    </div>
  `;

  document.body.appendChild(panel);

  // Slide in
  requestAnimationFrame(() => panel.classList.add('lwp-open'));

  // ── DOM shortcuts ──────────────────────────────────────────────────────────
  const $ = (id) => panel.querySelector(`#${id}`);

  const btnClose     = $('lwp-btn-close');
  const btnMinimize  = $('lwp-btn-minimize');
  const btnBack      = $('lwp-btn-back');
  const btnPrimary   = $('lwp-btn-primary');
  const formSubtitle = $('lwp-form-subtitle');

  // ── Close / minimise ───────────────────────────────────────────────────────
  btnClose.addEventListener('click', () => {
    panel.classList.remove('lwp-open');
    setTimeout(() => panel.remove(), 380);
  });

  let minimised = false;
  btnMinimize.addEventListener('click', () => {
    minimised = !minimised;
    panel.style.height = minimised ? '52px' : '100vh';
    panel.style.overflow = minimised ? 'hidden' : '';
  });

  // ── Stepper update ─────────────────────────────────────────────────────────
  function setScreen(n) {
    state.screen = n;
    for (let i = 1; i <= 4; i++) {
      const screen = $(`lwp-screen-${i}`);
      const step   = $(`lwp-step-${i}`);
      screen.classList.toggle('active', i === n);
      step.classList.remove('active', 'done');
      if (i === n) step.classList.add('active');
      if (i < n)   step.classList.add('done');
    }
    // Back button
    btnBack.style.display = n > 1 ? 'flex' : 'none';
    // Primary button label
    const labels = { 1: 'Extract & Begin →', 2: 'Skip to Review →', 3: 'Looks Good →', 4: 'Fill Form Now' };
    btnPrimary.textContent = labels[n] || 'Next →';
  }

  // ── Screen 1 init: form detection & backend check ──────────────────────────
  async function initConnect() {
    // Form title from page
    const pageTitle = document.title.replace(/\s*[–-]\s*Google Forms?\s*$/i, '').trim() || 'Untitled Form';
    $('lwp-form-title').textContent = pageTitle;
    $('lwp-form-url').textContent   = location.hostname;
    formSubtitle.textContent        = pageTitle;

    // Try to get question count from extractor
    const q = window.__LWP_extractForm?.();
    if (q?.questions?.length) {
      $('lwp-q-count').textContent = `${q.questions.length} questions`;
    }

    // Backend health
    try {
      const res = await fetch(`${BACKEND}/api/v1/parse-fields`, {
        method: 'OPTIONS',
        headers: { 'ngrok-skip-browser-warning': 'true' },
        signal: AbortSignal.timeout(3500)
      }).catch(() => null);
      if (res && (res.ok || res.status === 200 || res.status === 405)) {
        $('lwp-backend-dot').className  = 'lwp-dot green';
        $('lwp-backend-text').textContent = 'Kaggle backend connected';
      } else {
        throw new Error('Not reachable');
      }
    } catch {
      $('lwp-backend-dot').className  = 'lwp-dot red';
      $('lwp-backend-text').textContent = 'Cannot reach backend';
    }
  }

  // ── Extract form & POST to backend ────────────────────────────────────────
  async function extractAndUpload() {
    const statusEl = $('lwp-extract-status');
    statusEl.style.display = 'block';
    statusEl.textContent   = 'Extracting form…';
    btnPrimary.disabled    = true;

    try {
      let fields = [];
      try {
        const res = await fetch(`${BACKEND}/api/v1/prepare-interview`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'ngrok-skip-browser-warning': 'true',
          },
          body: JSON.stringify({ url: window.location.href }),
          signal: AbortSignal.timeout(12000),
        });
        if (res.ok) {
          const data = await res.json();
          if (Array.isArray(data.fields)) fields = data.fields;
        } else {
          // Fallback to parse-fields
          const alt = await fetch(`${BACKEND}/api/v1/parse-fields`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'ngrok-skip-browser-warning': 'true' },
            body: JSON.stringify({ url: window.location.href }),
            signal: AbortSignal.timeout(8000),
          });
          if (alt.ok) {
            const data = await alt.json();
            if (Array.isArray(data.fields)) fields = data.fields;
          }
        }
      } catch (e) {
        console.warn('[LWP Panel] Remote prepare-interview failed, falling back to local DOM extractor:', e);
      }

      if (!fields.length && window.__LWP_getKaggleFields) {
        fields = window.__LWP_getKaggleFields();
      }

      const schema = window.__LWP_extractForm?.() || { questions: [] };
      if (fields.length) {
        schema.questions = fields.map((f, i) => ({
          id: f.id,
          label: f.interview_prompt || f.label,
          interview_prompt: f.interview_prompt || f.label,
          type: f.type || 'short_text',
          options: f.options,
          index: i
        }));
      }

      if (!schema?.questions?.length) throw new Error('No questions found. Is this a Google Form?');

      state.schema = schema;
      $('lwp-q-count').textContent = `${state.schema.questions.length} questions`;
      statusEl.textContent = '✓ Form extracted successfully';
      statusEl.style.color = '#34d399';

      await new Promise(r => setTimeout(r, 600));
      return true;
    } catch (err) {
      statusEl.textContent = `✗ ${err.message}`;
      statusEl.style.color = '#f87171';
      return false;
    } finally {
      btnPrimary.disabled = false;
    }
  }

  // ── Screen 2: Interview logic ──────────────────────────────────────────────
  function loadQuestion(index) {
    if (!state.schema) return;
    const questions = state.schema.questions;
    if (index >= questions.length) { setScreen(3); buildReview(); return; }

    state.currentQIndex = index;
    const q = questions[index];
    const total = questions.length;

    // Progress
    const pct = Math.round((index / total) * 100);
    $('lwp-progress-fill').style.width = `${pct}%`;
    $('lwp-progress-text').textContent  = `${index + 1} / ${total}`;
    $('lwp-q-label').textContent        = `Question ${index + 1} of ${total}${q.required ? ' *' : ''}`;
    $('lwp-q-text').textContent         = q.title || q.text || `Question ${index + 1}`;
    $('lwp-q-hint').textContent         = q.description || '';

    // Build answer area
    const area = $('lwp-answer-area');
    area.innerHTML = '';

    const qType = (q.type || '').toLowerCase();
    const existing = state.answers[q.id];

    if (['radio', 'multiple_choice', 'dropdown'].includes(qType) && q.options?.length) {
      const opts = document.createElement('div');
      opts.className = 'lwp-options';
      q.options.forEach(opt => {
        const btn = document.createElement('button');
        btn.className = `lwp-option${existing === opt ? ' selected' : ''}`;
        btn.innerHTML = `<div class="lwp-option-dot"></div><span>${opt}</span>`;
        btn.addEventListener('click', () => {
          opts.querySelectorAll('.lwp-option').forEach(b => b.classList.remove('selected'));
          btn.classList.add('selected');
          state.answers[q.id] = opt;
        });
        opts.appendChild(btn);
      });
      area.appendChild(opts);

    } else if (qType === 'checkbox' && q.options?.length) {
      const opts = document.createElement('div');
      opts.className = 'lwp-options';
      const selectedSet = new Set(Array.isArray(existing) ? existing : []);
      q.options.forEach(opt => {
        const btn = document.createElement('button');
        btn.className = `lwp-option${selectedSet.has(opt) ? ' selected' : ''}`;
        btn.style.borderRadius = '6px';
        btn.innerHTML = `<div class="lwp-option-dot" style="border-radius:3px;"></div><span>${opt}</span>`;
        btn.addEventListener('click', () => {
          btn.classList.toggle('selected');
          if (btn.classList.contains('selected')) selectedSet.add(opt);
          else selectedSet.delete(opt);
          state.answers[q.id] = [...selectedSet];
        });
        opts.appendChild(btn);
      });
      area.appendChild(opts);

    } else {
      // Text / date / time / email / number — textarea
      const ta = document.createElement('textarea');
      ta.className = 'lwp-textarea';
      ta.placeholder = qType === 'date' ? 'e.g. 2024-01-15'
        : qType === 'time' ? 'e.g. 14:30'
        : qType === 'email' ? 'your@email.com'
        : qType === 'number' ? 'Enter a number…'
        : 'Type your answer here…';
      ta.value = existing || '';
      ta.addEventListener('input', () => { state.answers[q.id] = ta.value.trim(); });
      area.appendChild(ta);
    }
  }

  // ── Voice recording ────────────────────────────────────────────────────────
  $('lwp-btn-voice').addEventListener('mousedown', startRecording);
  $('lwp-btn-voice').addEventListener('mouseup',   stopRecording);
  $('lwp-btn-voice').addEventListener('mouseleave',stopRecording);

  $('lwp-btn-voice').addEventListener('touchstart', (e) => { e.preventDefault(); startRecording(); });
  $('lwp-btn-voice').addEventListener('touchend',   (e) => { e.preventDefault(); stopRecording();  });

  async function startRecording() {
    if (state.isRecording) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      state.audioChunks = [];
      state.mediaRecorder = new MediaRecorder(stream);
      state.mediaRecorder.ondataavailable = e => { if (e.data.size > 0) state.audioChunks.push(e.data); };
      state.mediaRecorder.start();
      state.isRecording = true;
      $('lwp-btn-voice').classList.add('recording');
      $('lwp-btn-voice').innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="12" r="8"/></svg> Recording…`;
      $('lwp-voice-status').textContent = 'Listening…';
    } catch {
      $('lwp-voice-status').textContent = 'Microphone not available';
    }
  }

  async function stopRecording() {
    if (!state.isRecording || !state.mediaRecorder) return;
    state.isRecording = false;

    await new Promise(resolve => {
      state.mediaRecorder.onstop = resolve;
      state.mediaRecorder.stop();
      state.mediaRecorder.stream.getTracks().forEach(t => t.stop());
    });

    $('lwp-btn-voice').classList.remove('recording');
    $('lwp-btn-voice').innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/></svg> Hold to speak`;
    $('lwp-voice-status').textContent = 'Transcribing…';

    try {
      const blob = new Blob(state.audioChunks, { type: 'audio/webm' });
      if (blob.size < 1000) {
        $('lwp-voice-status').textContent = 'Too short (<2s). Speak longer.';
        return;
      }

      const q = state.schema?.questions?.[state.currentQIndex];
      const form = new FormData();
      form.append('audio_file', blob, 'recording.webm');
      form.append('field_meta_json', JSON.stringify(q || {}));

      let text = '';
      try {
        const res = await fetch(`${BACKEND}/api/v1/process-single-answer`, {
          method: 'POST',
          headers: { 'ngrok-skip-browser-warning': 'true' },
          body: form,
          signal: AbortSignal.timeout(30000),
        });
        if (res.ok) {
          const data = await res.json();
          text = data.formatted_value || data.transcript || '';
        } else {
          throw new Error(`HTTP ${res.status}`);
        }
      } catch (e) {
        // Fallback to process-audio
        const altForm = new FormData();
        altForm.append('audio_file', blob, 'recording.webm');
        altForm.append('fields_json', JSON.stringify([q]));
        const altRes = await fetch(`${BACKEND}/api/v1/process-audio`, {
          method: 'POST',
          headers: { 'ngrok-skip-browser-warning': 'true' },
          body: altForm,
          signal: AbortSignal.timeout(30000),
        });
        const altData = await altRes.json();
        text = (q && altData.mapped_entries?.[q.id]) || altData.transcript || '';
      }

      if (text) {
        if (q) {
          state.answers[q.id] = text;
          const ta = $('lwp-answer-area')?.querySelector('.lwp-textarea');
          if (ta) ta.value = text;
        }
        $('lwp-voice-status').textContent = `✓ "${text.slice(0, 40)}${text.length > 40 ? '…' : ''}"`;
      } else {
        $('lwp-voice-status').textContent = 'Could not map answer';
      }
    } catch (err) {
      $('lwp-voice-status').textContent = `Failed: ${err.message || 'check backend'}`;
    }
  }

  // ── Screen 3: Review ───────────────────────────────────────────────────────
  function buildReview() {
    const list     = $('lwp-review-list');
    const questions = state.schema?.questions || [];
    list.innerHTML  = '';
    let missingRequired = 0;

    questions.forEach((q, i) => {
      const ans = state.answers[q.id];
      const hasAns = ans !== undefined && ans !== '' && !(Array.isArray(ans) && ans.length === 0);
      if (q.required && !hasAns) missingRequired++;

      const item = document.createElement('div');
      item.className = 'lwp-review-item';
      item.innerHTML = `
        <div class="lwp-review-q">Q${i + 1}. ${q.label || q.title || q.text}${q.required ? ' <span style="color:#f87171">*</span>' : ''}</div>
        <div class="lwp-review-a">${hasAns ? (Array.isArray(ans) ? ans.join(', ') : ans) : '<span style="color:#475569;font-style:italic;">No answer</span>'}</div>
        <button class="lwp-review-edit" data-index="${i}">Edit →</button>
      `;
      item.querySelector('.lwp-review-edit').addEventListener('click', () => {
        state.currentQIndex = i;
        setScreen(2);
        loadQuestion(i);
      });
      list.appendChild(item);
    });

    if (missingRequired > 0) {
      $('lwp-warnings').style.display = 'flex';
      $('lwp-warnings-text').textContent = `${missingRequired} required field${missingRequired > 1 ? 's' : ''} still empty.`;
    } else {
      $('lwp-warnings').style.display = 'none';
    }
  }

  // ── Screen 4: Fill ─────────────────────────────────────────────────────────
  async function triggerFill() {
    btnPrimary.disabled = true;
    $('lwp-fill-progress-wrap').style.display = 'flex';
    $('lwp-fill-result').style.display = 'none';

    try {
      const autofillData = { mapped_entries: state.answers, answers: state.answers };
      // Fill using the injected filler
      const result = window.__LWP_fillForm?.(autofillData) ?? { filled: 0, total: 0 };

      $('lwp-fill-progress-bar').style.width = '100%';
      $('lwp-fill-progress-text').textContent = `Filled ${result.filled ?? '?'} / ${result.total ?? '?'} fields`;

      $('lwp-fill-result').style.display = 'block';
      $('lwp-fill-result').style.background = 'rgba(5,46,22,0.5)';
      $('lwp-fill-result').style.color = '#34d399';
      $('lwp-fill-result').textContent = `✓ Form filled! Please review and submit manually.`;

    } catch (err) {
      $('lwp-fill-result').style.display = 'block';
      $('lwp-fill-result').style.background = 'rgba(127,29,29,0.4)';
      $('lwp-fill-result').style.color = '#f87171';
      $('lwp-fill-result').textContent = `✗ Fill error: ${err.message}`;
    } finally {
      btnPrimary.disabled = false;
    }
  }

  // ── Primary button logic (per screen) ─────────────────────────────────────
  btnPrimary.addEventListener('click', async () => {
    if (state.screen === 1) {
      const ok = await extractAndUpload();
      if (ok) { setScreen(2); loadQuestion(0); }

    } else if (state.screen === 2) {
      // Advance to next question, or go to review if at end
      const next = state.currentQIndex + 1;
      if (next < (state.schema?.questions?.length ?? 0)) {
        loadQuestion(next);
      } else {
        setScreen(3);
        buildReview();
      }

    } else if (state.screen === 3) {
      setScreen(4);
      $('lwp-ready-sub').textContent =
        `${Object.values(state.answers).filter(v => v !== '' && v !== undefined).length} answers ready to fill.`;

    } else if (state.screen === 4) {
      await triggerFill();
    }
  });

  // Update primary label on screen 2 to show "Next →" per question
  function updateScreen2Footer() {
    if (state.screen !== 2 || !state.schema) return;
    const isLast = state.currentQIndex >= (state.schema.questions.length - 1);
    btnPrimary.textContent = isLast ? 'Go to Review →' : 'Next →';
  }

  // ── Back button ─────────────────────────────────────────────────────────────
  btnBack.addEventListener('click', () => {
    if (state.screen === 2 && state.currentQIndex > 0) {
      loadQuestion(state.currentQIndex - 1);
    } else if (state.screen > 1) {
      const prev = state.screen - 1;
      setScreen(prev);
      if (prev === 2) loadQuestion(state.currentQIndex);
      if (prev === 3) buildReview();
    }
    updateScreen2Footer();
  });

  // ── Init ───────────────────────────────────────────────────────────────────
  setScreen(1);
  initConnect();

})();
