# Local Whisper Paperwork

> Voice-guided AI form-filling assistant — powered by Whisper + Gemma 4.

## What it does

1. Scrapes a Google Form tab and retrieves all question labels and their internal `entry.XXXX` IDs.
2. Accepts a voice recording through the Chrome extension or web UI.
3. Transcribes speech using Whisper and maps information to form entries using **Gemma 4**.
4. Autofills the Google Form directly using `document.querySelector('[name="entry.XXXX"]')` selectors.
5. You review the completed fields and submit manually.

---

## Kaggle Backend API Integration

Base URL: `https://<YOUR-NGROK-ID>.ngrok-free.app`

### 1. Parse Fields
```http
POST /api/v1/parse-fields
Content-Type: application/json

{ "url": "https://docs.google.com/forms/d/e/.../viewform" }
```
**Response:**
```json
{
  "status": "success",
  "fields": [
    { "id": "entry.123456789", "label": "Full Name" },
    { "id": "entry.987654321", "label": "Symptoms" },
    { "id": "entry.112233445", "label": "Location" }
  ]
}
```

### 2. Process Audio
```http
POST /api/v1/process-audio
Content-Type: multipart/form-data

audio_file: <binary audio file>
fields_json: [{"id": "entry.123456789", "label": "Full Name"}, ...]
```
**Response:**
```json
{
  "status": "success",
  "transcript": "My name is Ammar, I have a fever and headache, I am in Mumbai",
  "mapped_entries": {
    "entry.123456789": "Ammar",
    "entry.987654321": "fever and headache",
    "entry.112233445": "Mumbai"
  }
}
```

---

## Setup & Testing

### 1. Install Chrome Extension
1. Go to `chrome://extensions/` and enable **Developer mode**.
2. Click **Load unpacked** and select the `extension/` directory.
3. Open a Google Form tab.
4. Click the extension icon, enter your Kaggle ngrok URL, and click 💾 Save.
5. Click **1. Parse Form Fields** → **2. Record Audio Response** → **3. Fill Form Fields**!

### 2. Optional: Run Local Backend
```bash
cd backend
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt
python main.py
```

See [artifacts/SETUP_AND_TESTING_GUIDE.md](artifacts/SETUP_AND_TESTING_GUIDE.md) for full instructions.