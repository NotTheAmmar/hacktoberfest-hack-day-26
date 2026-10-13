# Technology Stack

## Overview

| Layer | Technology | Purpose |
|---|---|---|
| Browser Integration | Chrome Extension (Manifest V3) | Tab URL extraction, audio capture via MediaRecorder, DOM autofill & prefill URL generation |
| Speech Recognition | Whisper Large-v3-Turbo (CTranslate2) | High-accuracy speech-to-text running on Kaggle GPU |
| Language Model | **Gemma-2-2B-IT** (HuggingFace Transformers) | Instruction-following entity extraction & Google Form field mapping |
| Backend Server | FastAPI & Uvicorn (Python 3.13) | Asynchronous REST API running inside Kaggle notebook (`reference notebook.ipynb`) |
| Tunneling & Exposure | pyngrok | Exposing Kaggle GPU notebook API via HTTPS (`*.ngrok-free.dev` / `*.ngrok-free.app`) |
| Form Targeting System | Google Forms `entry.<id>` selectors | Robust DOM targeting via `document.querySelector('[name="entry.XXXX"]')` and URL parameters |

---

## Detailed Decisions

### Chrome Extension (Manifest V3)
- **Permissions:** `activeTab`, `scripting`, `storage`
- **Host Permissions:** `https://*.ngrok-free.dev/*`, `https://*.ngrok-free.app/*`, `https://docs.google.com/*`, `https://forms.gle/*`, `http://localhost/*`
- **Custom Header:** Includes `ngrok-skip-browser-warning: true` on all fetch calls to bypass ngrok free tier warning pages.
- **MediaRecorder API:** Captures WebM/WAV audio blobs natively with a $\ge$ 1 KB minimum duration guard.

### Kaggle GPU Backend (`artifacts/reference notebook.ipynb`)
- **Whisper Large-v3-Turbo:** Loaded via `faster-whisper` on CUDA with `float16` precision for fast, low-latency audio transcription.
- **google/gemma-2-2b-it:** Loaded via `transformers` with `bfloat16` precision on CUDA for zero-shot JSON entity mapping.
- **Endpoints:**
  - `POST /api/v1/parse-fields`
  - `POST /api/v1/process-audio`

### Autofill Mechanisms
- **Option A (URL Pre-fill Redirection):** Generates clean `viewform?entry.XXXX=value` query strings for native Google Forms form prefill.
- **Option B (Direct DOM Autofill):** Uses `filler.js` to set values on form controls and dispatches synthetic `input`, `change`, and `blur` events so Google Forms registers user entries.
