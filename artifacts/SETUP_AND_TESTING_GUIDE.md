# Setup, Installation & Testing Guide

This guide walks you through setting up the backend, installing the Chrome Extension, configuring the Gemma 2 endpoint via ngrok, and running through end-to-end testing with Google Forms.

---

## Prerequisites

1. **Operating System:** Linux, macOS, or Windows 11.
2. **Python:** Python 3.10 or higher.
3. **Google Chrome:** Latest stable version.
4. **Microphone:** Built-in or external mic (for voice input testing).
5. **Kaggle Notebook with GPU:** Running Gemma 2 and exposed via ngrok (optional for fallback testing, but required for full AI question-generation and interpretation).

---

## Part 1: Backend Setup & Running

The backend serves the local API, runs Faster-Whisper for Speech-to-Text (STT), orchestrates the interview, and serves the interview Web UI at `http://localhost:8000`.

### 1. Navigate to the backend directory
```bash
cd backend
```

### 2. Create and activate a Python virtual environment
**On Linux / macOS:**
```bash
python3 -m venv venv
source venv/bin/activate
```

**On Windows (PowerShell / Command Prompt):**
```powershell
python -m venv venv
venv\Scripts\activate
```

### 3. Install dependencies
```bash
pip install -r requirements.txt
```

> [!NOTE]
> `faster-whisper` downloads the Whisper model weights on first start. The default model size is `base` (~140MB), which runs quickly on standard CPUs.

### 4. Configure environment variables
Create your `.env` file from `.env.example`:
```bash
cp .env.example .env
```

Open `.env` and set your configuration:
```ini
# Kaggle ngrok tunnel URL (provide your active ngrok public URL)
GEMMA_API_URL=https://your-active-ngrok-url.ngrok-free.app

# API format configured on your Kaggle notebook
# Use /v1/chat/completions (OpenAI-compatible) or /generate
GEMMA_ENDPOINT=/v1/chat/completions

# Local Whisper settings
WHISPER_MODEL=base
WHISPER_DEVICE=cpu
WHISPER_COMPUTE_TYPE=int8

# Server Port
PORT=8000
```

> [!TIP]
> If your Kaggle notebook is not running yet, you can still test! The backend includes built-in fallbacks that use question field labels directly if the Gemma API is unreachable.

### 5. Start the backend server
```bash
python main.py
```
Or with uvicorn directly:
```bash
uvicorn main:app --reload --port 8000
```

Verify it is running:
- **API Health Check:** Open [http://localhost:8000/api/health](http://localhost:8000/api/health) in your browser.
- **Interactive API Docs:** Open [http://localhost:8000/docs](http://localhost:8000/docs).
- **Interview Web UI:** Open [http://localhost:8000/](http://localhost:8000/).

---

## Part 2: Chrome Extension Installation

The extension extracts questions from an active Google Form and autofills validated responses back into the DOM.

### 1. Open Chrome Extensions Manager
In your Chrome address bar, navigate to:
```text
chrome://extensions/
```

### 2. Enable Developer Mode
Turn on the **Developer mode** toggle switch in the top-right corner.

### 3. Load the Extension
1. Click the **Load unpacked** button in the top-left corner.
2. In the file picker dialog, select the `extension` folder inside this repository:
   `/home/ammar/Programs/hacktoberfest-hack-day-26/extension`
3. Click **Select Folder** / **Open**.

### 4. Pin the Extension
1. Click the **Extensions puzzle icon** in Chrome's top toolbar.
2. Find **Local Whisper Paperwork** and click the **Pin** icon to keep it visible on your toolbar.

---

## Part 3: Kaggle Notebook & ngrok Setup (Gemma 2)

To enable Gemma-guided interview conversations:

1. **Launch a Kaggle Notebook** with GPU accelerator (T4 x2 or P100).
2. **Install Inference Stack:** Install your inference runner (e.g., `vllm`, `ollama`, or a lightweight FastAPI wrapper with HuggingFace `transformers`).
3. **Expose with pyngrok:**
   ```python
   !pip install pyngrok uvicorn fastapi
   from pyngrok import ngrok

   # Authenticate ngrok
   ngrok.set_auth_token("YOUR_NGROK_AUTHTOKEN")

   # Open tunnel to your Kaggle server port (e.g., 8000)
   public_url = ngrok.connect(8000)
   print("Public ngrok URL:", public_url)
   ```
4. **Copy the URL** into your `backend/.env`:
   ```ini
   GEMMA_API_URL=https://xxxx-xx-xx-xxx.ngrok-free.app
   ```
5. Restart your local backend to load the updated `.env`.

---

## Part 4: End-to-End Testing Workflow

Follow these steps to run a full test from form extraction to autofill:

```
┌────────────────┐      ┌─────────────────┐      ┌────────────────┐      ┌────────────────┐
│ 1. Open Google │ ───► │ 2. Extract via  │ ───► │ 3. Interview   │ ───► │ 4. Autofill &  │
│    Form Tab    │      │    Extension    │      │    (Voice/Text)│      │    Submit      │
└────────────────┘      └─────────────────┘      └────────────────┘      └────────────────┘
```

### Step 1: Open a Google Form
1. Open any Google Form in a Chrome tab (e.g., your hackathon team registration form or a test form with text fields, radios, checkboxes, and dropdowns).
2. Ensure you are on the form view page (`https://docs.google.com/forms/d/e/.../viewform`).

### Step 2: Extract the Form
1. Click the **Local Whisper Paperwork** extension icon in your Chrome toolbar.
2. The popup should show:
   - Status: **Google Form detected** (green indicator)
   - Backend: **Backend ready** (green indicator)
3. Click **Extract Form**.
4. The log will show: `Extracted X questions`.
5. The extracted schema is automatically saved into the local backend.

### Step 3: Conduct the Interview
1. Click **Open Interview** in the popup (or navigate to `http://localhost:8000`).
2. You will see the active form title, progress ring, and Question 1.
3. Provide answers using either mode:
   - **Voice Input:** Click **Tap to speak** (grant microphone permissions if prompted). Speak your answer clearly, then click again to stop. Faster-Whisper transcribes it locally, displays the transcript, and advances to the next question.
   - **Text Input:** Type your answer into the text box and press `Enter` or click **Send ↵**.
   - **Option Chips:** For radio buttons or checkboxes, click the matching chips directly or speak the option name.
   - **Skipping:** Type or say `skip` to skip optional questions.

### Step 4: Review & Edit Answers
1. At any time (or once all questions are completed), click **Review All** on the left sidebar.
2. The overlay displays all questions, values, and validation badges (`Valid`, `Needs review`, `Required`).
3. If an answer needs correction, edit the value in the input box and click **Save**.

### Step 5: Autofill the Form
1. Go back to your active Google Form tab in Chrome.
2. Click the extension icon.
3. Click **Fill Form**.
4. The progress bar will indicate filled fields (`Filled X / Y fields`).
5. Observe the Google Form:
   - Text and paragraph inputs are filled.
   - Radio buttons and checkboxes are selected.
   - Dropdown options are set.
6. **Manual Verification & Submission:** Inspect the completed form fields in Chrome, make any final adjustments, and click **Submit** yourself.

---

## Part 5: Troubleshooting & FAQ

### Backend shows `Cannot reach localhost:8000` in the extension popup
- Ensure your Python backend is active in your terminal (`python main.py`).
- Check if port 8000 is occupied by another application. If changed, update the URL in `popup.js` and `service-worker.js`.
- Click the retry icon (↺) in the extension popup.

### Microphone input is not working in the Web UI
- Ensure your browser has permission to access your microphone on `http://localhost:8000`.
- Look for the microphone permission icon in Chrome's address bar and set it to **Allow**.

### "Extractor returned no data"
- Confirm you are on the live form response page (`/viewform`), not the form builder edit mode (`/edit`).
- Refresh the Google Form tab and retry extraction.

### Reloading the Extension after Code Changes
- If you edit files in `extension/`, navigate to `chrome://extensions/` and click the **Reload (circular arrow)** button on the Local Whisper Paperwork card.
- Refresh any open Google Form tabs so updated content scripts are injected.
