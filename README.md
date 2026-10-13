# Local Whisper Paperwork

> Voice-guided AI form-filling assistant — local-first, privacy-focused.

## What it does

Opens a Google Form → extracts questions → interviews you by voice or text → validates answers → fills the form automatically. You review and submit manually.

## Project Structure

```
├── extension/          Chrome Extension (Manifest V3)
│   ├── manifest.json
│   ├── popup/          Extension popup UI
│   ├── content/        Content scripts (extractor + filler)
│   └── background/     Service worker
├── backend/            Python FastAPI backend
│   ├── main.py         App entry point
│   ├── routers/        API route handlers
│   ├── services/       Core logic (STT, Gemma, interview engine)
│   ├── models/         Pydantic data models
│   ├── static/         Interview web UI (HTML/CSS/JS)
│   └── requirements.txt
└── artifacts/          Project documentation
```

## Setup

### 1. Backend

```bash
cd backend

# Copy and fill in environment variables
cp .env.example .env
# Edit .env: set GEMMA_API_URL to your Kaggle ngrok URL

# Create a virtual environment (recommended)
python -m venv venv
source venv/bin/activate      # Windows: venv\Scripts\activate

# Install dependencies
pip install -r requirements.txt

# Start the server
python main.py
# → http://localhost:8000
```

### 2. Chrome Extension

1. Open Chrome → `chrome://extensions/`
2. Enable **Developer mode** (top right toggle)
3. Click **Load unpacked**
4. Select the `extension/` folder in this project
5. The 🎙️ icon appears in your toolbar

### 3. Usage

1. Open a Google Form in Chrome
2. Click the extension icon → click **Extract Form**
3. Click **Open Interview** (opens `localhost:8000`)
4. Answer questions by voice 🎙️ or typing ⌨️
5. Review all answers → click **Fill Form** in the extension popup
6. Check the filled form → **submit manually**

## Environment Variables

See [`backend/.env.example`](backend/.env.example) for all options.

| Variable | Description |
|---|---|
| `GEMMA_API_URL` | ngrok URL of your Kaggle Gemma 2 notebook |
| `GEMMA_ENDPOINT` | API path (default: `/v1/chat/completions`) |
| `WHISPER_MODEL` | Whisper model size: `tiny`, `base`, `small` |
| `WHISPER_DEVICE` | `cpu` or `cuda` |

## Tech Stack

- **Chrome Extension**: Manifest V3, JavaScript
- **Backend**: Python 3.10+, FastAPI, uvicorn
- **STT**: Faster-Whisper (local)
- **LLM**: Gemma 2 on Kaggle, exposed via ngrok
- **UI**: Vanilla HTML/CSS/JS

## Privacy

Voice recordings are transcribed **locally** by Faster-Whisper. Audio never leaves your machine.  
Only text prompts are sent to Gemma 2 (via your Kaggle ngrok tunnel).  
The form is never submitted automatically — you always click Submit.

---

*Built for Hacktoberfest Hack Day 2026*