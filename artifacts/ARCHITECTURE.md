# System Architecture

## High-Level Architecture

```
┌────────────────────────────────────────────────────────────────────────┐
│                        USER'S BROWSER (Chrome)                        │
│  ┌─────────────────────────┐     ┌──────────────────────────────────┐  │
│  │   Google Form           │     │   Chrome Extension (MV3)         │  │
│  │   (Active Tab)          │◄───►│   - Content Script (filler/DOM)  │  │
│  │   https://docs.google...│     │   - Extension Popup (Audio Rec)  │  │
│  └─────────────────────────┘     └──────────────┬───────────────────┘  │
│                                                 │                      │
└─────────────────────────────────────────────────│──────────────────────┘
                                                  │
                      Direct ngrok API / Local    │
                      (Configurable in popup)     │
                                                  ▼
┌────────────────────────────────────────────────────────────────────────┐
│              KAGGLE BACKEND / LOCAL BACKEND (FastAPI)                  │
│                                                                        │
│   POST /api/v1/parse-fields                                            │
│   ├─ Scrapes active Google Form URL                                    │
│   └─ Returns fields: [{ id: "entry.123", label: "Full Name" }]         │
│                                                                        │
│   POST /api/v1/process-audio                                           │
│   ├─ Accepts audio_file + fields_json                                  │
│   ├─ Whisper Speech-to-Text (STT)                                      │
│   ├─ Gemma 4 Field-Mapping LLM                                         │
│   └─ Returns transcript + mapped_entries: { "entry.123": "Value" }     │
│                                                                        │
└────────────────────────────────────────────────────────────────────────┘
```

## Component Breakdown

### 1. Chrome Extension (Manifest V3)

| Component | Responsibility |
|---|---|
| **Extension Popup** | Allows user to input the active Kaggle ngrok URL, triggers `1. Parse Form Fields`, records audio via MediaRecorder, sends to `/api/v1/process-audio`, and triggers `3. Fill Form Fields`. |
| **Content Script (`filler.js`)** | Injected into Google Forms tabs. Directly fills inputs matching `[name="entry.XXXX"]` or container IDs and dispatches standard `input`, `change`, and `blur` events so Google Forms registers the answers. |
| **Service Worker (`service-worker.js`)** | Background coordinator for script execution and tab state management. |

### 2. Kaggle Backend (Gemma 4 + Whisper)

| Endpoint | Method | Request | Response |
|---|---|---|---|
| `/api/v1/parse-fields` | `POST` | `{"url": "https://docs.google.com/forms/..."}` | `{"status": "success", "fields": [{"id": "entry.123", "label": "Full Name"}]}` |
| `/api/v1/process-audio` | `POST` | `multipart/form-data`: `audio_file` + `fields_json` | `{"status": "success", "transcript": "...", "mapped_entries": {"entry.123": "Ammar"}}` |

### 3. Local Python Backend (`backend/`)

Provides a local development server mirroring the Kaggle API contract (`/api/v1/parse-fields` and `/api/v1/process-audio`), plus an optional full-screen conversational interview UI.

## End-to-End Data Flow

```
1. Active Google Form Tab
   → Popup gets tab URL
   → POST /api/v1/parse-fields { url }
   → Receives [{ id: "entry.123456789", label: "Full Name" }, ...]

2. Audio Recording
   → User clicks "Record Audio Response" in extension popup
   → User speaks answers naturally
   → MediaRecorder captures audio blob

3. Whisper + Gemma 4 Processing
   → POST /api/v1/process-audio { audio_file, fields_json }
   → Whisper transcribes audio to text
   → Gemma 4 maps text entities to corresponding entry IDs
   → Returns transcript + { "entry.123456789": "Ammar", ... }

4. Autofill & Review
   → User clicks "Fill Form Fields"
   → filler.js targets document.querySelector(`[name="entry.XXXX"]`)
   → Native DOM events triggered
   → User inspects completed form and submits manually
```
