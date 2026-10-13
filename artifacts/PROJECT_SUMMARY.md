# Local Whisper Paperwork

> **Voice-guided AI form-filling assistant — local-first, privacy-focused, interview-driven.**

## Elevator Pitch

Local Whisper Paperwork is an AI assistant that **reads an online form, interviews you about the required information, validates your answers, and fills the form automatically** — all running locally on your machine.

Instead of manually typing into dozens of fields, you have a natural conversation. The AI understands the form so you don't have to.

## The Problem

Online forms are tedious:
- Dozens of fields with confusing labels and instructions
- Repeated questions across sections
- Strict format requirements (dates, phone numbers, IDs)
- Easy to miss required fields or make typos

Existing voice dictation tools can transcribe speech, but they **cannot understand a form's structure**, conduct a guided interview, validate responses, or map answers to the correct fields.

## The Solution

A six-stage pipeline that turns form-filling into a conversation:

```
Active Google Form
    → Question extraction (Chrome Extension)
    → Structured form schema (JSON)
    → AI-guided interview (Gemma 2 via Kaggle/ngrok)
    → Voice/text answers (Faster-Whisper local STT)
    → Validation & review
    → Chrome autofill
    → Manual submission by user
```

## Core Principles

| Principle | Implementation |
|---|---|
| **AI understands the form** | Gemma 2 interprets questions, instructions, and field types |
| **User answers naturally** | Voice-first with text fallback, one question at a time |
| **Privacy by default** | Local STT, local processing, no external AI APIs |
| **User stays in control** | Review screen before autofill, manual submission only |
| **Existing browser session** | Chrome extension works in the user's active tab |

## Key Features

- 🎙️ Voice-first and text-based interaction
- 📋 Automatic extraction of form questions and instructions
- 💬 One-question-at-a-time conversational interview
- 🧠 Context-aware — reuses previously supplied answers
- 🔒 Local speech transcription (Faster-Whisper)
- 🤖 Gemma 2 inference (hosted on Kaggle, accessed via ngrok)
- ✅ Structured answer validation and missing-field warnings
- 📝 Editable review screen before autofill
- 🌐 Works with the user's existing Chrome session
- 🚫 Never submits a form automatically

## Target Demo

**Hacktoberfest 2026 Team Registration Form** — demonstrating voice interview through to a completed, manually submitted Google Form.

---

*Built for Hacktoberfest Hack Day 2026*
