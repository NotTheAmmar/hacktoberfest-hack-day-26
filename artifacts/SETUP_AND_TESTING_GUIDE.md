# Setup, Installation & Testing Guide

This guide walks you through setting up and testing the **Local Whisper Paperwork** extension with the **Kaggle Backend (Whisper + Gemma 4)** via ngrok.

---

## Prerequisites

1. **Operating System:** Linux, macOS, or Windows 11.
2. **Google Chrome:** Latest version.
3. **Microphone:** For recording voice input.
4. **Kaggle Notebook with GPU:** Running the FastAPI backend (with Whisper & Gemma 4) exposed via ngrok.

---

## Part 1: Kaggle Backend API Specification

Your Kaggle notebook exposes two primary endpoints:

```
Base URL: https://<YOUR-NGROK-ID>.ngrok-free.app
```

### Endpoint 1: Parse Form Fields
- **Method:** `POST`
- **Path:** `/api/v1/parse-fields`
- **Request Body:**
  ```json
  {
    "url": "https://docs.google.com/forms/d/e/FORM_ID/viewform"
  }
  ```
- **Response:**
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

### Endpoint 2: Process Audio
- **Method:** `POST`
- **Path:** `/api/v1/process-audio`
- **Headers:** `Content-Type: multipart/form-data`
- **Form Data:**
  - `audio_file`: Binary audio (`webm`, `mp3`, `wav`, `ogg`)
  - `fields_json`: JSON string of the fields array from `/parse-fields`
- **Response:**
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

### Quick cURL Verification
```bash
# 1. Test parsing fields
curl -X POST https://<YOUR-NGROK-ID>.ngrok-free.app/api/v1/parse-fields \
  -H "Content-Type: application/json" \
  -d '{"url": "https://docs.google.com/forms/d/e/YOUR_FORM_ID/viewform"}'

# 2. Test processing audio
curl -X POST https://<YOUR-NGROK-ID>.ngrok-free.app/api/v1/process-audio \
  -F "audio_file=@/path/to/sample.webm" \
  -F 'fields_json=[{"id":"entry.123456789","label":"Full Name"}]'
```

---

## Part 2: Installing the Chrome Extension

1. Open Chrome and navigate to:
   ```text
   chrome://extensions/
   ```
2. Enable the **Developer mode** toggle in the top-right corner.
3. Click the **Load unpacked** button in the top-left corner.
4. Select the `extension` folder:
   `/home/ammar/Programs/hacktoberfest-hack-day-26/extension`
5. Pin the extension to your toolbar by clicking Chrome's puzzle icon 🧩 and clicking the pin icon next to **Local Whisper Paperwork**.

---

## Part 3: Running the End-to-End Workflow

Follow these steps when testing with any Google Form:

### Step 1: Open Google Form & Configure Backend URL
1. In Chrome, open a Google Form tab (e.g. `https://docs.google.com/forms/d/e/.../viewform`).
2. Click the **Local Whisper Paperwork** extension icon in your toolbar.
3. In the **Backend URL** input, enter your Kaggle ngrok URL:
   ```text
   https://<YOUR-NGROK-ID>.ngrok-free.app
   ```
   *(If testing locally with the Python server, leave it as `http://localhost:8000`)*.
4. Click the 💾 (Save) button. The status will verify the connection.

### Step 2: Parse Form Fields
1. With the Google Form tab open, click **1. Parse Form Fields**.
2. The extension sends the URL to `/api/v1/parse-fields`.
3. The badge will update to show the number of detected fields (e.g., `3 fields`).

### Step 3: Record Voice Answers
1. Click **2. Record Audio Response** (grant microphone permission if prompted).
2. Speak your answers naturally (for example: *"My name is John Doe, my email is john@example.com, and I am applying for the AI track."*).
3. Click the button again to stop recording.
4. The audio is sent to `/api/v1/process-audio`. Whisper transcribes the voice note, and **Gemma 4** maps each entity to its corresponding `entry.XXXX` ID.
5. The extension displays the generated transcript and mapped entries preview!

### Step 4: Autofill Form Fields
1. Click **3. Fill Form Fields**.
2. The content script automatically populates the form using `name="entry.XXXX"` selectors.
3. Observe the Google Form: the fields are filled and form events are triggered.
4. Review the inputs and click **Submit** manually.

---

## Part 4: (Optional) Running the Local Python Backend

If you wish to run a local mock/bridge server for testing offline:

```bash
cd backend
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
python main.py
```

The local backend implements the exact same `/api/v1/parse-fields` and `/api/v1/process-audio` endpoints at `http://localhost:8000`.
