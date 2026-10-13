# System Architecture

## High-Level Architecture

```
┌────────────────────────────────────────────────────────────────────────┐
│                        USER'S BROWSER (Chrome)                        │
│  ┌─────────────────────────┐     ┌──────────────────────────────────┐  │
│  │   Google Form           │     │   Chrome Extension (MV3)         │  │
│  │   (Active Tab)          │◄───►│   - Content Script (filler.js)   │  │
│  │   https://docs.google...│     │   - Popup (popup.js & Audio Rec) │  │
│  │                         │     │   - Floating Panel (panel.js)    │  │
│  └─────────────────────────┘     └──────────────┬───────────────────┘  │
│                                                 │                      │
└─────────────────────────────────────────────────│──────────────────────┘
                                                  │
                      Direct ngrok API / Local    │ (Headers:
                      (Configured in popup)       │  ngrok-skip-browser-warning: true)
                                                  ▼
┌────────────────────────────────────────────────────────────────────────┐
│              KAGGLE GPU BACKEND / LOCAL BACKEND (FastAPI)              │
│       Reference: artifacts/reference notebook.ipynb                    │
│                                                                        │
│   POST /api/v1/parse-fields                                            │
│   ├─ Scrapes active Google Form metadata                               │
│   ├─ Extracts field types: short_text, radio, dropdown, checkbox, etc. │
│   └─ Returns fields: [{ id: "entry.184920482", label, type, options }]│
│                                                                        │
│   POST /api/v1/process-audio                                           │
│   ├─ Accepts audio_file (WebM/WAV >= 1 KB) + fields_json               │
│   ├─ Transcodes via ffmpeg (16kHz mono PCM)                            │
│   ├─ Whisper Large-v3-Turbo Speech-to-Text (STT)                       │
│   ├─ Gemma-2-2B-IT Entity-to-Field Mapping                             │
│   └─ Returns transcript + mapped_entries: { "entry.184920482": "..." } │
│                                                                        │
└────────────────────────────────────────────────────────────────────────┘
```

## Component Breakdown

### 1. Chrome Extension (Manifest V3)

| Component | Responsibility |
|---|---|
| **Extension Popup (`popup/`)** | Configures ngrok URL, sends `/api/v1/parse-fields`, records microphone input via MediaRecorder API, calls `/api/v1/process-audio`, previews transcript + mapped JSON, and triggers autofill. |
| **Content Script (`filler.js`)** | Injected on Google Form tabs. Supports **Direct DOM Autofill** (sets values on inputs/textareas, clicks radios/checkboxes/dropdowns, dispatches change/input events) and **URL Pre-fill Redirection** (`viewform?entry.XXXX=val&...`). |
| **Floating Panel (`panel.js` & `panel.css`)** | In-page interactive interview panel that can be launched directly over the Google Form. |
| **Service Worker (`service-worker.js`)** | Handles cross-context coordination and script execution permissions. |

### 2. Kaggle Backend (Whisper Large-v3-Turbo + Gemma-2-2B-IT)

The backend runs as a FastAPI server inside a Kaggle GPU notebook (see [`artifacts/reference notebook.ipynb`](./reference%20notebook.ipynb)) exposed via `pyngrok`:

| Endpoint | Method | Request Payload | Response (200 OK) |
|---|---|---|---|
| `/api/v1/parse-fields` | `POST` | `{"url": "https://docs.google.com/forms/..."}` | `{"status": "success", "fields": [{"id": "entry.184920482", "label": "Full Name", "type": "short_text"}]}` |
| `/api/v1/process-audio` | `POST` | `audio_file` (Blob $\ge$ 1 KB) + `fields_json` (string) | `{"status": "success", "transcript": "...", "mapped_entries": {"entry.184920482": "Vishvambar"}}` |

### 3. Local Python Server (`backend/`)
Provides a local development server mirroring `/api/v1/parse-fields` and `/api/v1/process-audio` on `http://localhost:8000`.

---

## Data Flow Pipeline

```
1. Detect Form
   → Popup gets current tab URL (docs.google.com/forms/...)
   → POST /api/v1/parse-fields (header: ngrok-skip-browser-warning: true)
   → Kaggle parses FB_PUBLIC_LOAD_DATA_
   → Returns fields: [ { id: "entry.184920482", label: "Full Name", type: "short_text" }, ... ]

2. Voice Recording
   → User clicks Record in popup or panel
   → MediaRecorder captures WebM/WAV stream (guarded for >= 1 KB / ~2s)
   → POST /api/v1/process-audio (header: ngrok-skip-browser-warning: true)

3. Whisper STT + Gemma-2-2B-IT Mapping
   → ffmpeg converts audio to 16kHz mono WAV
   → Whisper Large-v3-Turbo transcribes speech to text
   → Gemma-2-2B-IT extracts entities and maps to entry IDs based on field types
   → Returns { status: "success", transcript: "...", mapped_entries: { "entry.184920482": "Vishvambar" } }

4. Autofill Execution
   → Option A (Direct DOM): filler.js populates matching elements and triggers synthetic events
   → Option B (URL Pre-fill): Extension opens prefilled URL ?entry.184920482=Vishvambar
   → User reviews filled form and clicks Submit manually
```
