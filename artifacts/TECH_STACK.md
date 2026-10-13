# Technology Stack

## Overview

| Layer | Technology | Purpose |
|---|---|---|
| Browser Integration | Chrome Extension (Manifest V3) | Tab URL extraction, audio capture via MediaRecorder, DOM autofill |
| Speech Recognition | Whisper (OpenAI / Faster-Whisper) | Audio transcription to text |
| Language Model | **Gemma 4** (hosted on Kaggle via ngrok) | Form field understanding, entity extraction & field mapping |
| Backend Server | FastAPI / Python | Local testing server and/or Kaggle inference API |
| Form Selector System | Google Forms `entry.XXXX` selectors | Reliable DOM targeting via `document.querySelector('[name="entry.XXXX"]')` |
| Tunnels & Exposure | ngrok | Exposing Kaggle GPU notebook API to public HTTPS |

---

## Detailed Decisions

### Chrome Extension (Manifest V3)
- **Permissions:** `activeTab`, `scripting`, `storage`
- **Host Permissions:** `https://*.ngrok-free.app/*`, `https://docs.google.com/*`, `https://forms.gle/*`, `http://localhost/*`
- Uses browser `MediaRecorder` API directly in the extension popup for low-latency recording.

### Gemma 4 on Kaggle (via ngrok)
- **Why Gemma 4:** State-of-the-art instruction-following and structured output generation. Maps natural conversational speech into accurate `{ "entry.XXXX": "value" }` JSON dictionaries matching scraped form fields.
- **Inference Runtime:** Kaggle notebook with GPU acceleration, tunneled through ngrok.

### Whisper Speech Recognition
- Transcribes arbitrary audio formats (`webm`, `mp3`, `wav`, `ogg`) into clean text transcripts before passing to Gemma 4.

### Autofill Strategy: Google Form Entry IDs
Google Forms links each question to an HTML form element with a `name="entry.XXXX"` attribute. Targeting these entry IDs directly ensures robust, reliable autofill even when CSS class names vary between Google Form themes.
