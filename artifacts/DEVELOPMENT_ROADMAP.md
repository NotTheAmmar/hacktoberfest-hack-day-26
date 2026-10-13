# Development Roadmap

## Phase Overview

| Phase | Name | Dependencies | Est. Effort |
|---|---|---|---|
| 1 | Chrome Extension Foundation | None | ██░░░░ |
| 2 | Form Schema Extraction | Phase 1 | ██░░░░ |
| 3 | Backend + Gemma Integration | Phase 2, ngrok URL | ████░░ |
| 4 | Conversational Interview | Phase 3 | ████░░ |
| 5 | Voice Input (Faster-Whisper) | Phase 4 | ███░░░ |
| 6 | Validation, Review & Autofill | Phase 4-5 | ████░░ |
| 7 | End-to-End Demo | All phases | ██░░░░ |

---

## Phase 1 — Chrome Extension Foundation

**Goal:** A working MV3 extension that detects Google Forms.

### Tasks
- [ ] Create `manifest.json` with Manifest V3 configuration
- [ ] Create service worker (background script)
- [ ] Create extension popup with basic UI
- [ ] Content script that detects if the current page is a Google Form
- [ ] Popup shows "Google Form detected" / "Not a Google Form"
- [ ] Load extension into Chrome in developer mode and test

### Deliverable
Extension installed in Chrome, correctly identifies Google Forms pages.

---

## Phase 2 — Form Schema Extraction

**Goal:** Extract structured form data from a Google Form's DOM.

### Tasks
- [ ] Analyze Google Forms DOM structure (question containers, labels, input types)
- [ ] Content script: extract question labels and descriptions
- [ ] Content script: identify field types (short text, paragraph, radio, checkbox, dropdown)
- [ ] Content script: extract options for multi-choice fields
- [ ] Content script: detect required-field indicators
- [ ] Content script: extract form title and description
- [ ] Build structured JSON from extracted data
- [ ] Add "Extract Form" button in popup that triggers extraction
- [ ] Display extraction results in popup or console
- [ ] Test with a real Google Form

### Deliverable
Clicking "Extract Form" produces a complete JSON schema of the Google Form's questions.

---

## Phase 3 — Backend + Gemma Integration

**Goal:** FastAPI backend that accepts form schemas and communicates with Gemma 2.

### Tasks
- [ ] Initialize Python project with `requirements.txt`
- [ ] Create FastAPI app with CORS middleware for extension
- [ ] Implement `POST /api/form-schema` — accept and store form schema
- [ ] Implement `GET /api/health` — health check
- [ ] Create `.env` file structure for `GEMMA_API_URL`
- [ ] Implement Gemma client (`gemma_client.py`) — send prompts, receive responses
- [ ] Test Gemma connection with a simple prompt
- [ ] Implement prompt templates for:
  - Generating interview questions from schema
  - Interpreting user answers
  - Validating answer format and completeness
- [ ] Connect extension to backend — POST extracted schema on extraction

### Deliverable
Backend running at `localhost:8000`, accepts form schemas, and successfully queries Gemma 2 via ngrok.

---

## Phase 4 — Conversational Interview

**Goal:** One-at-a-time interview flow driven by Gemma 2.

### Tasks
- [ ] Implement interview engine (`interview_engine.py`)
  - Track question queue and answer state
  - Determine next question based on context
  - Store and update answers
- [ ] Implement `GET /api/interview/next` — return next question
- [ ] Implement `POST /api/interview/answer` — submit text answer
- [ ] Implement `GET /api/interview/status` — progress summary
- [ ] Create interview web UI (`static/index.html`)
  - Question display area
  - Text input with send button
  - Answer history sidebar or list
  - Progress indicator (X of Y questions)
- [ ] Gemma generates contextual follow-up questions
- [ ] Gemma interprets free-form answers into structured values
- [ ] Handle "I don't know" / skip responses
- [ ] Context reuse — if user already provided info, don't re-ask
- [ ] Test full interview flow with a sample form schema

### Deliverable
User can complete a text-based interview at `localhost:8000`, answering all form questions one at a time.

---

## Phase 5 — Voice Input (Faster-Whisper)

**Goal:** Accept voice answers via microphone, transcribe locally.

### Tasks
- [ ] Install and configure Faster-Whisper with `base` model
- [ ] Implement STT service (`stt.py`) — accept audio bytes, return text
- [ ] Implement `POST /api/interview/voice` — audio upload endpoint
- [ ] Add microphone recording to interview UI
  - Record button (start/stop)
  - Audio visualization (optional)
  - Send recorded audio to backend
- [ ] Display transcript in UI before submitting as answer
- [ ] Allow user to edit transcript before confirming
- [ ] Test with various accents and background noise levels
- [ ] Optimize: stream audio or use chunked upload if needed

### Deliverable
User can answer interview questions by speaking into their microphone; answers are transcribed locally and submitted.

---

## Phase 6 — Validation, Review & Autofill

**Goal:** Review answers, validate completeness, fill the Google Form.

### Tasks
- [ ] Implement answer validation in interview engine
  - Required field checks
  - Format validation (email, phone, etc.)
  - Option matching for radio/checkbox/dropdown
- [ ] Build review screen in interview UI
  - Show all questions and answers
  - Highlight missing/invalid answers
  - Inline edit capability
- [ ] Implement `POST /api/interview/edit` — edit previous answer
- [ ] Implement `GET /api/autofill-data` — return validated answer map
- [ ] Content script: implement `filler.js`
  - Receive answer map from extension
  - Map answers to correct form fields by question ID
  - Fill text fields, select radio buttons, check checkboxes, select dropdown options
  - Trigger change/input events so Google Forms registers the values
- [ ] Add "Fill Form" button in extension popup
  - Fetch autofill data from backend
  - Send to content script
  - Show fill status
- [ ] Test autofill with a real Google Form
- [ ] Handle edge cases: already-filled fields, disabled fields, conditional sections

### Deliverable
Complete validated answers are automatically filled into the Google Form. User reviews and submits manually.

---

## Phase 7 — End-to-End Demo

**Goal:** Full demo with the Hacktoberfest 2026 Team Registration Form.

### Tasks
- [ ] Identify or create the target demo Google Form
- [ ] Run end-to-end: open form → extract → interview (voice + text) → review → fill
- [ ] Test with multiple Chrome windows/profiles
- [ ] Test missing answers and validation warnings
- [ ] Test dropdowns, conditional sections, long text
- [ ] Record demo video or prepare live demo
- [ ] Final README update with setup instructions
- [ ] Code cleanup and documentation

### Deliverable
Live or recorded demo showing the complete workflow from opening a Google Form to a filled, ready-to-submit form.

---

## Dependency Graph

```
Phase 1 (Extension)
    │
    ▼
Phase 2 (Extraction)
    │
    ├──────────────┐
    ▼              ▼
Phase 3         Phase 5
(Backend +      (Voice — can
 Gemma)          develop in
    │            parallel)
    ▼              │
Phase 4            │
(Interview)◄───────┘
    │
    ▼
Phase 6 (Validation + Autofill)
    │
    ▼
Phase 7 (Demo)
```

> **Note:** Phase 5 (Voice) can be developed in parallel with Phases 3-4, as the STT module is independent of the interview engine. They converge when voice input is added to the interview UI.
