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

### Endpoint 1: Setup the Interview (Structure Form Questions)
Scrapes the Google Form and uses Gemma 2 to generate short, structured conversational questions (`interview_prompt`). For choice-based fields (`radio`, `dropdown`, `checkbox`), options are explicitly incorporated in short into the prompt.

- **Method:** `POST`
- **Path:** `/api/v1/prepare-interview`
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
        "type": "short_text",
        "interview_prompt": "What is your full legal name?"
      },
      {
        "id": "entry.943180411",
        "label": "Department",
        "type": "radio",
        "options": ["Engineering", "Product Design", "Human Resources"],
        "interview_prompt": "Which department are you with: Engineering, Product Design, or Human Resources?"
      }
    ]
  }
  ```

---

### Endpoint 2: Process Single Question Answer
Accepts the single audio blob recorded for a specific question along with that question's metadata (`field_meta_json`). Runs Whisper STT and formats the answer with Gemma into `formatted_value`.

- **Method:** `POST`
- **Path:** `/api/v1/process-single-answer`
- **Headers:**
  ```http
  Content-Type: multipart/form-data
  ngrok-skip-browser-warning: true
  ```
- **Request Payload (`FormData`):**
  | Key | Type | Description |
  |---|---|---|
  | `audio_file` | File / Blob | Audio recording for this single question. |
  | `field_meta_json` | string | The current field object serialized: `JSON.stringify(fields[currentIndex])`. |

- **Response Body (200 OK):**
  ```json
  {
    "status": "success",
    "id": "entry.943180411",
    "transcript": "uh engineering please",
    "formatted_value": "Engineering"
  }
  ```

---

### Step 3: Complete the Form & Prefill
The extension stores each result in an accumulator:
```javascript
allAnswers[id] = formatted_value;
```
Once all questions are answered, the pre-filled URL is generated:
```javascript
const finalUrl = new URL(formUrl.replace("/edit", "/viewform"));
Object.entries(allAnswers).forEach(([entryId, val]) => {
  if (val) finalUrl.searchParams.append(entryId, val);
});
window.open(finalUrl.toString(), "_blank");
```

---

### Legacy / Backward-Compatible Endpoints
- `POST /api/v1/parse-fields`: Scrapes form fields without generating LLM prompts.
- `POST /api/v1/process-audio`: Accepts a single long recording for all fields at once.
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
