# Technology Stack

## Overview

| Layer | Technology | Purpose |
|---|---|---|
| Browser Integration | Chrome Extension (Manifest V3) | Form detection, extraction, autofill |
| Backend Server | Python + FastAPI | Local API, interview orchestration |
| Speech Recognition | Faster-Whisper | Local speech-to-text |
| Language Model | Gemma 2 (on Kaggle via ngrok) | Question generation, answer interpretation |
| Interview UI | HTML/CSS/JS (vanilla) | Lightweight local web interface |
| Data Format | JSON | Form schemas, answers, API payloads |

---

## Detailed Decisions

### Chrome Extension — Manifest V3

**Why:** Direct DOM access to Google Forms is required for both extraction and autofill. A Chrome extension with content scripts is the only way to interact with the active tab's DOM without requiring the user to copy-paste form URLs or use a separate tool.

**Key Choices:**
- **Manifest V3** (required for new Chrome extensions)
- **Content Script** — injected into `docs.google.com/forms/*` pages
- **Service Worker** — replaces persistent background pages in MV3
- **Popup** — minimal control panel for triggering actions
- **Permissions:** `activeTab`, `scripting` (minimal required permissions)

### Python + FastAPI

**Why:** Python is the natural choice given Faster-Whisper and the Gemma client both have Python SDKs. FastAPI provides async support, automatic OpenAPI docs, and WebSocket capability with minimal boilerplate.

**Key Packages:**
```
fastapi
uvicorn
faster-whisper
httpx          # async HTTP client for Gemma API
python-dotenv  # .env file for ngrok URL
pydantic       # request/response models
python-multipart  # audio file uploads
```

### Faster-Whisper (Local STT)

**Why:** Privacy-first — voice recordings never leave the device. Faster-Whisper uses CTranslate2 for optimized inference, significantly faster than the original OpenAI Whisper implementation.

**Model:** `base` or `small` (balances speed vs accuracy)

**Flow:**
```
Browser mic → audio blob → POST to backend → Faster-Whisper → transcript text
```

### Gemma 2 on Kaggle (via ngrok)

**Why:** Gemma 2 provides strong instruction-following capability for interpreting form questions, generating interview prompts, and validating answers. Hosting on Kaggle provides free GPU access.

**Setup:**
1. Kaggle notebook runs Gemma 2 with a simple HTTP inference server
2. ngrok exposes the notebook's server to a public URL
3. The ngrok URL is stored in `.env` in the project root
4. The backend reads the URL and sends prompts via HTTP

**Configuration:**
```env
# .env
GEMMA_API_URL=https://xxxx-xx-xx-xxx-xxx.ngrok-free.app
```

### Interview Web UI

**Why:** A simple local web page is the most accessible interface. No framework dependencies, instant load, works in any browser.

**Served by:** FastAPI static files (or a simple HTML endpoint)
**Opens at:** `http://localhost:8000` after starting the backend

**Features:**
- Current question display
- Voice recording button (uses browser MediaRecorder API)
- Text input with send button
- Answer history / progress bar
- Review & edit screen
- "Fill Form" action button

---

## Development Environment

| Tool | Version | Purpose |
|---|---|---|
| Python | 3.10+ | Backend runtime |
| Node.js | 18+ (optional) | Extension build tooling if needed |
| Chrome | Latest | Extension testing |
| Git | Latest | Version control |

## File Structure (Planned)

```
hacktoberfest-hack-day-26/
├── artifacts/                # Project documentation
│   ├── PROJECT_SUMMARY.md
│   ├── ARCHITECTURE.md
│   ├── TECH_STACK.md
│   ├── DEVELOPMENT_ROADMAP.md
│   └── PROGRESS.md
├── extension/                # Chrome Extension (MV3)
│   ├── manifest.json
│   ├── popup/
│   │   ├── popup.html
│   │   ├── popup.css
│   │   └── popup.js
│   ├── content/
│   │   ├── extractor.js      # Form question extraction
│   │   └── filler.js         # Form autofill logic
│   ├── background/
│   │   └── service-worker.js
│   └── icons/
├── backend/                  # Python FastAPI backend
│   ├── main.py               # FastAPI app entry point
│   ├── routers/
│   │   ├── form.py           # Form schema endpoints
│   │   ├── interview.py      # Interview Q&A endpoints
│   │   └── autofill.py       # Autofill data endpoint
│   ├── services/
│   │   ├── schema_manager.py # Form schema parsing
│   │   ├── interview_engine.py # Interview orchestration
│   │   ├── stt.py            # Faster-Whisper wrapper
│   │   └── gemma_client.py   # Gemma 2 API client
│   ├── models/
│   │   ├── form_schema.py    # Pydantic models for form
│   │   └── interview.py      # Pydantic models for interview
│   ├── static/               # Interview web UI
│   │   ├── index.html
│   │   ├── style.css
│   │   └── app.js
│   ├── requirements.txt
│   └── .env                  # GEMMA_API_URL=...
├── .gitignore
├── LICENSE
└── README.md
```
