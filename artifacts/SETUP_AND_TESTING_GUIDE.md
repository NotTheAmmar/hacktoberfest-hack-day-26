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
┌────────────────────┐      ┌─────────────────────────────┐      ┌──────────────────────┐      ┌────────────────────┐
│ 1. Open Google Form│ ───► │ 2. Auto-Detects & Parses    │ ───► │ 3. Tap to Record     │ ───► │ 4. Autofill Form   │
│    Active Tab      │      │    /api/v1/parse-fields     │      │    Whisper + Gemma 2 │      │    Direct / Pre-fill│
└────────────────────┘      └─────────────────────────────┘      └──────────────────────┘      └────────────────────┘
```

### Step 1: Open Form & Verify Backend URL
1. In Chrome, open any Google Form tab (e.g. `https://docs.google.com/forms/d/e/.../viewform`).
2. Click the **Local Whisper Paperwork** icon in the Chrome toolbar.
3. Verify your Kaggle ngrok URL at the top:
   ```text
   https://<YOUR-NGROK-SUBDOMAIN>.ngrok-free.dev
   ```
   *(The default placeholder is `https://rewrite-climatic-shredder.ngrok-free.dev` from the reference notebook)*.
4. Click **Connect** (or press Enter). The status indicator turns green (🟢 Connected: `<domain>`).

### Step 2: Automatic Form Detection & Field Scraping
1. The extension automatically detects the Google Form tab and calls `/api/v1/parse-fields` in the background.
2. The detected questions are displayed as badges/chips (e.g. `Full Name`, `Department`, `Incident Date`).
3. *(Fallback: If the form is private or requires sign-in, the extension automatically extracts the questions and `entry.<id>` fields directly from the browser tab DOM).*

### Step 3: Record Voice Response (Hero Action)
1. Tap the central **Tap to Speak Answers** button.
2. Speak your answers naturally (grant microphone permission if prompted).
   - *Example:* "My name is John Doe and I work in Engineering. The incident date was 2026-10-13."
3. Watch the live recording timer. Ensure you speak for at least **2 seconds** (Kaggle backend requires $\ge 1\text{ KB}$ audio).
4. Tap the button again when finished.
5. The extension uploads the audio to `/api/v1/process-audio` with the header `ngrok-skip-browser-warning: true`.
6. Whisper transcribes your voice, and Gemma 2 maps the answers to the exact Google Form entry IDs.
7. The transcript and mapped fields are rendered immediately in the results card!

### Step 4: Autofill the Form
Choose either method:

#### Option A: Direct DOM Autofill (Primary)
- Click **⚡ Autofill Form**.
- The extension automatically injects text, selects radio options, checks checkboxes, and chooses dropdown values right inside the active tab.

#### Option B: Pre-filled URL Redirection (Secondary)
- Click **🔗 Prefilled URL**.
- Opens a new tab with the URL parameters appended (`?entry.184920482=John+Doe&...`), leveraging Google Forms' native prefill mechanism.

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
