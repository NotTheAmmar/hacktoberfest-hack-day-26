# Setup, Installation & Testing Guide

This guide walks you through setting up and testing the **Local Whisper Paperwork** extension with the **Kaggle GPU Backend (Whisper Large-v3-Turbo + Gemma-2-2B-IT)** via ngrok.

> [!NOTE]
> The reference Kaggle implementation is available in [`artifacts/reference notebook.ipynb`](./reference%20notebook.ipynb).

---

## Prerequisites

1. **Operating System:** Linux, macOS, or Windows 11.
2. **Google Chrome:** Latest version.
3. **Microphone:** For recording voice intake.
4. **Kaggle Notebook with GPU:** Running the FastAPI backend (see [`artifacts/reference notebook.ipynb`](./reference%20notebook.ipynb)) exposed via ngrok.

---

## Part 1: Kaggle Backend API Contract & Schema

### Base Configuration
- **Base URL:** `https://<YOUR-NGROK-SUBDOMAIN>.ngrok-free.dev` (or `.ngrok-free.app`)
- **Critical Header for Free ngrok:**
  ```http
  ngrok-skip-browser-warning: true
  ```
  *(Always include this header in fetch calls from the browser/extension to bypass ngrok's interstitial warning page).*

---

### Endpoint 1: Parse Form Fields
Scrapes question labels, Google Form `entry.<id>` identifiers, field types, and possible choices.

- **Method:** `POST`
- **Path:** `/api/v1/parse-fields`
- **Headers:**
  ```http
  Content-Type: application/json
  ngrok-skip-browser-warning: true
  ```
- **Request Body:**
  ```json
  {
    "url": "https://docs.google.com/forms/d/e/1FAIpQLSc.../viewform"
  }
  ```
- **Response Body (200 OK):**
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

#### Supported Field Types
- `"short_text"`, `"paragraph"`, `"radio"`, `"dropdown"`, `"checkbox"`
- `"linear_scale"`, `"grid"`, `"date"`, `"time"`, `"file_upload"`
*(The `options` array is present on choice types: `"radio"`, `"dropdown"`, `"checkbox"`).*

---

### Endpoint 2: Process Audio & Map Form
Accepts recorded audio along with the `fields` array from Endpoint 1, transcribes it with Whisper Large-v3-Turbo, and maps the extracted entities to `entry.<id>` keys via Gemma-2-2B-IT.

- **Method:** `POST`
- **Path:** `/api/v1/process-audio`
- **Headers:**
  ```http
  Content-Type: multipart/form-data
  ngrok-skip-browser-warning: true
  ```
- **Request Payload (`FormData`):**
  | Key | Type | Description |
  |---|---|---|
  | `audio_file` | File / Blob | WebM or WAV recording (**must be $\ge$ 1 KB / ~2+ seconds long**). |
  | `fields_json` | string | The exact `fields` array from Endpoint 1 serialized with `JSON.stringify(fields)`. |

- **Response Body (200 OK):**
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

### Quick cURL Test
```bash
# 1. Test parsing fields
curl -X POST https://<YOUR-NGROK-SUBDOMAIN>.ngrok-free.dev/api/v1/parse-fields \
  -H "Content-Type: application/json" \
  -H "ngrok-skip-browser-warning: true" \
  -d '{"url": "https://docs.google.com/forms/d/e/YOUR_FORM_ID/viewform"}'

# 2. Test processing audio
curl -X POST https://<YOUR-NGROK-SUBDOMAIN>.ngrok-free.dev/api/v1/process-audio \
  -H "ngrok-skip-browser-warning: true" \
  -F "audio_file=@/path/to/recording.webm" \
  -F 'fields_json=[{"id":"entry.184920482","label":"Full Name","type":"short_text"}]'
```

---

## Part 2: Installing the Chrome Extension

1. Open Google Chrome and navigate to:
   ```text
   chrome://extensions/
   ```
2. Enable the **Developer mode** toggle in the top-right corner.
3. Click the **Load unpacked** button.
4. Select the `extension` folder:
   `/home/ammar/Programs/hacktoberfest-hack-day-26/extension`
5. Pin the extension to your toolbar by clicking Chrome's puzzle icon 🧩 and clicking the pin icon next to **Local Whisper Paperwork**.

---

## Part 3: Running the End-to-End Workflow

```
┌────────────────────┐      ┌─────────────────────┐      ┌──────────────────────┐      ┌────────────────────┐
│ 1. Open Google Form│ ───► │ 2. Parse Fields     │ ───► │ 3. Record Voice      │ ───► │ 4. Autofill Form   │
│    Active Tab      │      │    POST /parse-field│      │    Whisper + Gemma   │      │    Direct / Pre-fill│
└────────────────────┘      └─────────────────────┘      └──────────────────────┘      └────────────────────┘
```

### Step 1: Open Form & Configure Backend URL
1. In Chrome, open any Google Form tab (e.g. `https://docs.google.com/forms/d/e/.../viewform`).
2. Click the **Local Whisper Paperwork** icon in the toolbar.
3. In the **Backend URL** input, enter your Kaggle ngrok URL:
   ```text
   https://<YOUR-NGROK-SUBDOMAIN>.ngrok-free.dev
   ```
   *(Or `http://localhost:8000` if running the local Python mock backend)*.
4. Click the 💾 (Save) button. The status dot will turn green.

### Step 2: Parse Form Fields
1. Click **1. Parse Form Fields**.
2. The extension requests `/api/v1/parse-fields` using the current tab URL.
3. The badge updates with the detected field count (e.g., `3 fields`).

### Step 3: Record Voice Response
1. Click **2. Record Audio Response** (grant microphone permission if prompted).
2. Speak your answers clearly for at least 2 seconds (e.g., *"My name is Vishvambar and I work in Engineering. The incident date was 2026-10-13."*).
3. Click the button again to stop.
4. The extension sends the audio file to `/api/v1/process-audio` with the `ngrok-skip-browser-warning: true` header.
5. Whisper transcribes the voice note and Gemma maps the answers to their respective `entry.<id>` keys.
6. The transcript and mapped JSON entries are displayed in the preview card!

### Step 4: Autofill the Form
You have two autofill options:

#### Option A: Direct DOM Autofill (Step 3A)
- Click **Fill Form Directly**.
- The extension automatically populates inputs, textareas, radios, checkboxes, and dropdowns right inside your open tab.

#### Option B: Pre-filled URL Redirection (Step 3B)
- Click **Open Prefilled Form URL**.
- Opens a new tab with the URL parameters appended (`?entry.184920482=Vishvambar&...`), allowing Google Forms to pre-fill the form natively.

---

## Part 4: (Optional) Running the Local Python Mock Backend

You can run the included Python FastAPI backend locally:

```bash
cd backend
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
python main.py
```

The local backend mirrors the exact `/api/v1/parse-fields` and `/api/v1/process-audio` endpoints at `http://localhost:8000`.
