# System Architecture

## High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        USER'S BROWSER                          │
│  ┌──────────────────┐    ┌──────────────────────────────────┐  │
│  │   Google Form     │    │   Chrome Extension (MV3)         │  │
│  │   (Active Tab)    │◄──►│   - Content Script (DOM access)  │  │
│  │                   │    │   - Service Worker (background)  │  │
│  │                   │    │   - Extension Popup (controls)   │  │
│  └──────────────────┘    └──────────┬───────────────────────┘  │
│                                      │                          │
└──────────────────────────────────────│──────────────────────────┘
                                       │ HTTP (localhost)
                                       ▼
┌──────────────────────────────────────────────────────────────────┐
│                     LOCAL PYTHON BACKEND                         │
│  ┌──────────────────┐  ┌──────────────┐  ┌───────────────────┐  │
│  │  FastAPI Server   │  │  Interview   │  │  Form Schema      │  │
│  │  (localhost:8000) │  │  Engine      │  │  Manager          │  │
│  │  - REST API       │  │  - Q&A flow  │  │  - Parse schema   │  │
│  │  - WebSocket      │  │  - Context   │  │  - Validate       │  │
│  │  - CORS config    │  │  - History   │  │  - Map answers    │  │
│  └────────┬─────────┘  └──────┬───────┘  └───────────────────┘  │
│           │                    │                                  │
│  ┌────────▼─────────┐  ┌──────▼───────┐                         │
│  │  Faster-Whisper   │  │  Gemma 2     │                         │
│  │  (Local STT)      │  │  Client      │                         │
│  │  - Audio → Text   │  │  (via ngrok) │                         │
│  │  - Local model    │  │              │                         │
│  └──────────────────┘  └──────┬───────┘                         │
│                                │                                  │
└────────────────────────────────│──────────────────────────────────┘
                                 │ HTTPS (ngrok tunnel)
                                 ▼
                    ┌──────────────────────┐
                    │   Kaggle Notebook    │
                    │   - Gemma 2 model    │
                    │   - Inference API    │
                    └──────────────────────┘
```

## Component Breakdown

### 1. Chrome Extension (Manifest V3)

| Component | Responsibility |
|---|---|
| **Content Script** | Injected into Google Forms tabs. Reads the DOM to extract form structure (questions, options, types, required indicators). Receives autofill commands and writes values into form fields. |
| **Service Worker** | Background script that manages extension state, coordinates between content script and popup, and communicates with the local backend via HTTP. |
| **Extension Popup** | Simple UI with "Extract Form" and "Fill Form" buttons. Shows extraction status and connection health. |

### 2. Local Python Backend (FastAPI)

| Module | Responsibility |
|---|---|
| **API Server** | Exposes REST endpoints for form schema upload, interview interaction, and autofill data retrieval. Serves the interview web UI. WebSocket for real-time interview updates. |
| **Form Schema Manager** | Parses the extracted form JSON into an internal schema. Identifies field types, validation rules, required fields, and instructions. |
| **Interview Engine** | Orchestrates the one-at-a-time question flow. Maintains conversation context and answer state. Calls Gemma 2 for question generation, answer interpretation, and validation. |
| **STT Module** | Wraps Faster-Whisper for local speech-to-text. Receives audio blobs, returns transcribed text. |
| **Gemma Client** | HTTP client that sends prompts to the Gemma 2 model hosted on Kaggle via ngrok. Handles prompt formatting, response parsing, and error recovery. |

### 3. Interview Web UI

A lightweight local web page (HTML/CSS/JS) served by the backend:
- Displays the current question with context
- Microphone button for voice recording
- Text input fallback
- Answer history and progress indicator
- Review/edit screen before autofill
- "Fill Form" trigger button

### 4. Gemma 2 on Kaggle

- Runs in a Kaggle notebook with GPU
- Exposed via ngrok tunnel
- Provides a simple inference API (prompt in → response out)
- ngrok URL configured via `.env` file in the project

## Data Flow

### Form Extraction Flow
```
Google Form DOM
    → Content Script parses questions, labels, types, options
    → Structured JSON schema
    → Sent to backend via POST /api/form-schema
    → Backend stores and analyzes schema
```

### Interview Flow
```
Backend selects next question (via Gemma 2)
    → Displayed in Interview UI
    → User responds (voice → Faster-Whisper → text, or typed text)
    → Answer sent to backend POST /api/answer
    → Gemma 2 interprets and validates answer
    → Answer stored in structured response map
    → Next question selected
    → Repeat until all required fields answered
```

### Autofill Flow
```
User reviews all answers in review screen
    → User clicks "Fill Form"
    → Backend sends answer map to extension via GET /api/autofill-data
    → Extension service worker forwards to content script
    → Content script maps answers to DOM fields
    → Fields filled programmatically
    → User reviews and submits manually
```

## API Endpoints

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/form-schema` | Upload extracted form schema from extension |
| `GET` | `/api/interview/next` | Get the next interview question |
| `POST` | `/api/interview/answer` | Submit an answer (text) |
| `POST` | `/api/interview/voice` | Submit voice recording for STT + answer |
| `GET` | `/api/interview/status` | Get interview progress and answer summary |
| `GET` | `/api/autofill-data` | Get validated answer map for autofill |
| `POST` | `/api/interview/edit` | Edit a previous answer |
| `GET` | `/api/health` | Health check |
| `WS` | `/ws/interview` | Real-time interview updates (optional) |

## Form Schema Format

```json
{
  "form_title": "Hacktoberfest 2026 Team Registration",
  "form_description": "Register your team for the hackathon...",
  "questions": [
    {
      "id": "q1",
      "label": "Team Name",
      "type": "short_text",
      "required": true,
      "instructions": "Enter your team name (max 50 characters)",
      "options": null,
      "validation": {
        "max_length": 50
      }
    },
    {
      "id": "q2",
      "label": "Competition Track",
      "type": "radio",
      "required": true,
      "instructions": "Select the track you're competing in",
      "options": ["AI/ML", "Web Dev", "Mobile", "Open Innovation"],
      "validation": null
    },
    {
      "id": "q3",
      "label": "Team Members",
      "type": "checkbox",
      "required": false,
      "instructions": "Select all roles present in your team",
      "options": ["Developer", "Designer", "PM", "Other"],
      "validation": null
    }
  ]
}
```

## Answer Map Format

```json
{
  "answers": {
    "q1": {
      "value": "Code Crusaders",
      "confidence": "high",
      "source": "voice",
      "validated": true
    },
    "q2": {
      "value": "AI/ML",
      "confidence": "high",
      "source": "text",
      "validated": true
    }
  },
  "completion": {
    "total_questions": 10,
    "answered": 7,
    "required_remaining": 1,
    "optional_remaining": 2
  }
}
```

## Security Boundaries

```
┌─────────────────────────────────────────────┐
│ TRUSTED ZONE (User's Machine)               │
│                                              │
│  Chrome Extension ←→ localhost:8000 only     │
│  Faster-Whisper (fully local)                │
│  Audio recordings (never leave device)       │
│  Answer data (local until autofill)          │
│                                              │
├─────────────────────────────────────────────┤
│ EXTERNAL (via ngrok)                         │
│                                              │
│  Gemma 2 prompts (form questions + answers)  │
│  Note: No raw audio sent externally          │
│                                              │
├─────────────────────────────────────────────┤
│ GOOGLE (user-initiated)                      │
│                                              │
│  Form submission (manual, by user)           │
│                                              │
└─────────────────────────────────────────────┘
```
