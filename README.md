# Local Whisper Paperwork

> Voice-guided AI form-filling assistant — powered by Whisper Large-v3-Turbo + Gemma-2-2B-IT.

## What it does

1. Scrapes a Google Form tab and retrieves all question labels, internal `entry.<id>` identifiers, field types, and options.
2. Accepts a voice recording through the Chrome extension popup or floating in-page panel.
3. Transcribes speech using Whisper and maps information to form entries using **Gemma-2-2B-IT**.
4. Autofills the Google Form directly or opens a prefilled URL.
5. You review the completed fields and submit manually.

---

## Kaggle Backend API Integration

> **Reference Notebook:** See [`artifacts/reference notebook.ipynb`](artifacts/reference%20notebook.ipynb) for the exact Kaggle notebook code running FastAPI, Whisper, and Gemma.

**Base URL:** `https://<YOUR-NGROK-SUBDOMAIN>.ngrok-free.dev`

**Critical Header (Free ngrok):**
```http
ngrok-skip-browser-warning: true
```

### 1. Parse Fields
```http
POST /api/v1/parse-fields
Content-Type: application/json
ngrok-skip-browser-warning: true

{ "url": "https://docs.google.com/forms/d/e/.../viewform" }
```
**Response (200 OK):**
```json
{
  "status": "success",
  "fields": [
    {
      "id": "entry.184920482",
      "label": "Full Name",
      "type": "short_text"
    },
    {
      "id": "entry.943180411",
      "label": "Department",
      "type": "radio",
      "options": ["Engineering", "Design", "Marketing"]
    },
    {
      "id": "entry.552194812",
      "label": "Incident Date",
      "type": "date"
    }
  ]
}
```

### 2. Process Audio
```http
POST /api/v1/process-audio
Content-Type: multipart/form-data
ngrok-skip-browser-warning: true

audio_file: <binary audio file, >= 1 KB / ~2+ seconds>
fields_json: [{"id": "entry.184920482", "label": "Full Name", "type": "short_text"}, ...]
```
**Response (200 OK):**
```json
{
  "status": "success",
  "transcript": "My name is Vishvambar and I work in Engineering. The incident occurred on 2026-10-13.",
  "mapped_entries": {
    "entry.184920482": "Vishvambar",
    "entry.943180411": "Engineering",
    "entry.552194812": "2026-10-13"
  }
}
```

---

## Setup & Testing

### 1. Install Chrome Extension
1. Go to `chrome://extensions/` and enable **Developer mode**.
2. Click **Load unpacked** and select the `extension/` directory.
3. Open a Google Form tab in Chrome.
4. Click the extension icon, enter your Kaggle ngrok URL, and click 💾 Save.
5. Click **Parse Form Fields** → **Record Audio Response** → Choose **Fill Form Directly** or **Open Prefilled Form URL**!

### 2. Optional: Run Local Backend
```bash
cd backend
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt
python main.py
```

See [`artifacts/SETUP_AND_TESTING_GUIDE.md`](artifacts/SETUP_AND_TESTING_GUIDE.md) for full instructions.