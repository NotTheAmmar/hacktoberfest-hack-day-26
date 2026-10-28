# Local Whisper Paperwork

> **Voice-guided AI form-filling assistant — powered by Whisper Large-v3-Turbo + Gemma-2-2B-IT.**

[![Manifest V3](https://img.shields.io/badge/Chrome%20Extension-Manifest%20V3-blue?logo=googlechrome)](extension/manifest.json)
[![FastAPI](https://img.shields.io/badge/Backend-FastAPI-009688?logo=fastapi)](backend/main.py)
[![Whisper](https://img.shields.io/badge/STT-Whisper%20Large--v3--Turbo-412991)](artifacts/reference%20notebook.ipynb)
[![Gemma 2](https://img.shields.io/badge/LLM-Gemma--2--2B--IT-orange)](artifacts/reference%20notebook.ipynb)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

---

## 💡 Overview

**Local Whisper Paperwork** transforms tedious form-filling into a seamless, voice-driven conversation. Instead of squinting at dozens of small input boxes, dropdowns, and radio buttons, an AI assistant inspects the Google Form, conducts a short conversational interview, and automatically fills in all matching fields.

### ✨ Key Capabilities

- 📋 **Zero-Effort Form Inspection**: Detects active Google Forms tabs and extracts hidden internal `entry.<id>` identifiers, field types, and choice options directly from `FB_PUBLIC_LOAD_DATA_` or rendered DOM nodes.
- 🎙️ **Voice-First Intake**: High-accuracy speech transcription powered by **Whisper Large-v3-Turbo** running on CUDA (`faster-whisper`, float16).
- 🤖 **Natural Language Understanding**: Powered by **Gemma-2-2B-IT** (bfloat16) to formulate natural questions, interpret colloquial responses, and map entities to exact form choices.
- ⚡ **Minimal 2–3 Question Semantic Interview**: Automatically bundles 10+ granular form fields into 2–3 thematic interview questions (e.g. *Company & Contact Info*, *Physical Address & Location*, *Additional Details*), reducing user speaking time by over 70%.
- 🔘 **Interactive Choice Chips**: Options for radio buttons, checkboxes, and dropdowns appear directly beneath the microphone button — users can speak or tap to select.
- 🪄 **Dual Autofill Strategies**:
  - **Option A — Direct DOM Autofill**: Injects values into inputs and clicks options in-place, simulating physical user actions and dispatching synthetic event cascades (`focus`, `keydown`, `input`, `change`, `blur`) to bypass Google Closure/React state traps.
  - **Option B — Prefilled URL Redirection**: Generates a native `viewform?entry.XXXX=val&...` URL to open prefilled in a new browser tab.
- 🛡️ **Human-in-the-Loop & Privacy**: Open-source models running in a dedicated GPU environment or locally; the extension **never auto-submits forms** without explicit human review.
- 🖥️ **Dual Interfaces**: Choose between the popup interface or the in-page floating drawer panel overlaying the Google Form.

---

## 🏛️ System Architecture

```
┌────────────────────────────────────────────────────────────────────────┐
│                        USER'S BROWSER (Chrome)                        │
│  ┌─────────────────────────┐     ┌──────────────────────────────────┐  │
│  │   Google Form           │     │   Chrome Extension (MV3)         │  │
│  │   (Active Tab)          │◄───►│   - Extractor (extractor.js)     │  │
│  │   https://docs.google...│     │   - Filler (filler.js)           │  │
│  │                         │     │   - Popup (popup.js & Audio Rec) │  │
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
│   POST /api/v1/prepare-interview                                       │
│   ├─ Accepts URL or client-extracted DOM fields                        │
│   ├─ Bundles fields into conversational interview prompts              │
│   └─ Returns fields with 'interview_prompt' and short options          │
│                                                                        │
│   POST /api/v1/process-single-answer                                   │
│   ├─ Accepts audio_file (WebM/WAV) + field/group metadata              │
│   ├─ Transcodes via FFmpeg (16kHz mono PCM WAV)                        │
│   ├─ Transcribes with Whisper Large-v3-Turbo                           │
│   ├─ Formats/maps with Gemma-2-2B-IT                                   │
│   └─ Returns { id, transcript, formatted_value, mapped_entries }      │
│                                                                        │
│   Backward Compatibility Endpoints:                                    │
│   ├─ POST /api/v1/parse-fields                                         │
│   └─ POST /api/v1/process-audio                                        │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 🚀 Kaggle Backend API Integration

The inference backend is designed to run in a free Kaggle GPU notebook (T4/P100) and expose REST endpoints over HTTPS via `pyngrok`.

> 📓 **Reference Notebook:** See [`artifacts/reference notebook.ipynb`](artifacts/reference%20notebook.ipynb) for the exact, battle-tested Kaggle notebook code running FastAPI, Whisper Large-v3-Turbo, and Gemma-2-2B-IT.

**Base URL:** `https://<YOUR-NGROK-SUBDOMAIN>.ngrok-free.dev` (or `.ngrok-free.app`)

**Critical Header (Free ngrok):**
```http
ngrok-skip-browser-warning: true
```
*(Always included in all extension fetch requests to bypass the ngrok free-tier HTML warning page).*

---

### 1. Setup the Interview: `POST /api/v1/prepare-interview`

Structures form fields into conversational questions with explicit choice options. Supports passing pre-extracted fields directly (for air-gapped notebook environments) or a public form URL.

**Request:**
```http
POST /api/v1/prepare-interview
Content-Type: application/json
ngrok-skip-browser-warning: true

{
  "url": "https://docs.google.com/forms/d/e/.../viewform",
  "fields": [
    { "id": "entry.184920482", "label": "Full Name", "type": "short_text" },
    { "id": "entry.943180411", "label": "Department", "type": "radio", "options": ["Engineering", "Design", "Marketing"] }
  ]
}
```

**Response (`200 OK`):**
```json
{
  "status": "success",
  "fields": [
    {
      "id": "entry.184920482",
      "label": "Full Name",
      "type": "short_text",
      "interview_prompt": "What is your full legal name?"
    },
    {
      "id": "entry.943180411",
      "label": "Department",
      "type": "radio",
      "options": ["Engineering", "Design", "Marketing"],
      "interview_prompt": "Which department are you with: Engineering, Design, or Marketing?"
    }
  ]
}
```

---

### 2. Process Answer: `POST /api/v1/process-single-answer`

Accepts a single voice recording for a question or question group, transcribes it via Whisper, and formats/maps it via Gemma into normalized values.

**Request (`multipart/form-data`):**
```http
POST /api/v1/process-single-answer
ngrok-skip-browser-warning: true

audio_file: <binary audio blob (WebM/WAV), >= 500 bytes>
field_meta_json: {"id": "entry.943180411", "label": "Department", "type": "radio", "options": ["Engineering", "Design", "Marketing"]}
group_meta_json: {"label": "Company & Contact Info", "target_fields": [...]}
```

**Response (`200 OK`):**
```json
{
  "status": "success",
  "id": "entry.943180411",
  "transcript": "uh engineering please",
  "formatted_value": "Engineering",
  "mapped_entries": {
    "entry.943180411": "Engineering"
  }
}
```

---

### 3. Legacy / Backward-Compatible Endpoints

- **`POST /api/v1/parse-fields`**: Scrapes question labels, internal `entry.<id>` identifiers, field types, and options from a Google Form URL.
- **`POST /api/v1/process-audio`**: Accepts a single continuous audio recording for the entire form and maps all entities to a complete JSON dictionary (`{ "entry.XXXX": "value" }`).

---

## 🛠️ Setup & Installation

### Step 1: Install Chrome Extension (Manifest V3)

1. Open Google Chrome and navigate to `chrome://extensions/`.
2. Toggle on **Developer mode** in the top-right corner.
3. Click **Load unpacked** and select the [`extension/`](extension/) directory from this repository.
4. The **Local Whisper Paperwork** extension icon will appear in your Chrome toolbar. Pin it for quick access!

---

### Step 2: Run Backend on Kaggle GPU (Recommended)

1. Create a new notebook on [Kaggle](https://www.kaggle.com/) with **GPU enabled** (e.g. T4 x2 or P100).
2. Upload and run the cells from [`artifacts/reference notebook.ipynb`](artifacts/reference%20notebook.ipynb).
3. The notebook will:
   - Install dependencies (`faster-whisper`, `transformers`, `pyngrok`, `fastapi`, `uvicorn`).
   - Load **Whisper Large-v3-Turbo** into GPU VRAM (float16).
   - Load **google/gemma-2-2b-it** into GPU VRAM (bfloat16).
   - Start Uvicorn and print your public ngrok tunnel URL:
     ```text
     ============================================================
     PUBLIC BACKEND API URL: https://xxxx-xx-xx-xxx-xxx.ngrok-free.dev
     ============================================================
     ```
4. Click the extension icon in Chrome, paste your ngrok URL into the **Kaggle Backend (ngrok URL)** field, and click **Connect**.

---

### Step 3: Run Local Backend (Optional)

If you have a local machine with Python 3.10+ and a CUDA GPU or fast CPU:

```bash
cd backend
python3 -m venv venv
source venv/bin/activate    # On Windows: venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env
python main.py
```

The local FastAPI development server will start on `http://localhost:8000`. Swagger API documentation is available at `http://localhost:8000/docs`.

---

## 🎯 How to Use the Extension

1. **Open a Google Form**: Navigate to any public or internal Google Form tab in Chrome (`docs.google.com/forms/...`).
2. **Launch Popup**: Click the extension icon. The extension automatically detects the form, checks backend connectivity, and prepares the interview questions.
3. **Voice Interview**:
   - The active question banner displays Gemma's conversational prompt.
   - For choice fields, click an option chip directly or speak your answer naturally.
   - Tap **Tap to Speak Answer**, speak your response, and tap again to finish.
   - Whisper transcribes your voice, and Gemma extracts the values into the accumulated answer map.
4. **Complete & Autofill**:
   - Click **Autofill Form** to fill all fields directly inside the active tab.
   - Or click **Prefilled URL** to generate and launch a prefilled Google Form in a new tab.
5. **Review & Submit**: Verify that all fields are populated correctly and click Google Form's native **Submit** button manually.

---

## 📂 Project Directory Structure

```text
hacktoberfest-hack-day-26/
├── extension/                     # Chrome Extension (Manifest V3)
│   ├── manifest.json              # Extension metadata, permissions & host matches
│   ├── config.js                  # Default backend ngrok configuration
│   ├── background/
│   │   └── service-worker.js      # Message router & scripting executor
│   ├── content/
│   │   ├── extractor.js           # Google Forms FB_PUBLIC_LOAD_DATA_ & DOM scraper
│   │   ├── filler.js              # DOM prototype autofill & prefilled URL builder
│   │   ├── panel.js               # In-page floating interview drawer wizard
│   │   └── panel.css              # Styling for in-page floating panel
│   ├── popup/
│   │   ├── popup.html             # Main extension popup interface
│   │   ├── popup.css              # Premium dark-mode styling with micro-animations
│   │   └── popup.js               # Question-by-question & semantic interview controller
│   └── icons/                     # Extension icons (16, 32, 48, 128 px)
│
├── backend/                       # Local FastAPI Development Backend
│   ├── main.py                    # Server entrypoint, CORS & lifespan loader
│   ├── requirements.txt           # Python package dependencies
│   ├── .env.example               # Environment configuration template
│   ├── models/
│   │   ├── form_schema.py         # Pydantic models for extracted form structure
│   │   └── interview.py           # Pydantic models for interview Q&A and autofill
│   ├── routers/
│   │   ├── kaggle_api.py          # Mirror of Kaggle /api/v1/* contracts
│   │   ├── form.py                # Schema upload and retrieval endpoints
│   │   ├── interview.py           # Stateful sequential interview Q&A
│   │   └── autofill.py            # Autofill data payload generator
│   └── services/
│       ├── stt.py                 # Faster-Whisper wrapper with auto-format detection
│       ├── gemma_client.py        # Gemma prompt templates & client with fallbacks
│       ├── interview_engine.py    # State management & question scheduling
│       └── schema_manager.py      # In-memory form schema singleton
│
└── artifacts/                     # Reference Material & Design Specs
    ├── reference notebook.ipynb   # Complete runnable Kaggle GPU reference notebook
    ├── ARCHITECTURE.md            # In-depth architectural specification
    ├── SETUP_AND_TESTING_GUIDE.md # Detailed testing & verification guide
    ├── TECH_STACK.md              # Technology stack details and trade-offs
    ├── DEVELOPMENT_ROADMAP.md     # Milestones and feature roadmap
    ├── PROGRESS.md                # Engineering decision log and phase status
    └── PROJECT_SUMMARY.md         # Problem, solution, and elevator pitch
```

---

## 📚 Deep Documentation Links

- 🏛️ [System Architecture Specification](artifacts/ARCHITECTURE.md)
- 🧪 [Setup, Installation & Testing Guide](artifacts/SETUP_AND_TESTING_GUIDE.md)
- ⚡ [Technology Stack & Rationale](artifacts/TECH_STACK.md)
- 📓 [Kaggle Reference Notebook](artifacts/reference%20notebook.ipynb)
- 📈 [Development Roadmap](artifacts/DEVELOPMENT_ROADMAP.md)

---

## 📄 License

This project is licensed under the [MIT License](LICENSE).