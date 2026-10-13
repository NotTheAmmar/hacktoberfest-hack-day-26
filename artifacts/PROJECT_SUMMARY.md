# Local Whisper Paperwork

> **Voice-guided AI form-filling assistant — local-first, privacy-focused, interview-driven.**

## Elevator Pitch

Local Whisper Paperwork is an AI assistant that **reads an online form, interviews you about the required information, validates your answers, and fills the form automatically** — powered by Whisper for voice recognition and **Gemma 4** for natural language understanding and field mapping.

Instead of manually typing into dozens of fields, you have a natural conversation or provide a single voice note. The AI understands the form so you don't have to.

## The Problem

Online forms are tedious:
- Dozens of fields with confusing labels and instructions
- Repeated questions across sections
- Strict format requirements (dates, phone numbers, IDs)
- Easy to miss required fields or make typos

Existing voice dictation tools can transcribe speech, but they **cannot understand a form's structure**, conduct a guided interview, validate responses, or map answers to the correct `entry.XXXX` fields.

## The Solution

A streamlined pipeline that turns form-filling into voice-guided automation:

```
Active Google Form
    → Form Fields Extraction via Chrome Extension or POST /api/v1/parse-fields
    → Speech Audio Input via Extension or Local Interface
    → Whisper STT + Gemma 4 Field Mapping (POST /api/v1/process-audio)
    → Structured Field Mapping ({ "entry.XXXX": "value" })
    → Autofill directly into Google Form DOM
    → Manual submission by user
```

## Core Principles

| Principle | Implementation |
|---|---|
| **AI understands the form** | **Gemma 4** interprets questions, instructions, and maps user speech to form entry IDs |
| **User answers naturally** | Voice-first with text fallback, single-note or interview format |
| **Privacy by default** | Open-source Whisper STT + dedicated Gemma 4 Kaggle runtime |
| **User stays in control** | Preview transcripts and mapped entries before autofill; manual submission only |
| **Existing browser session** | Chrome extension works directly in the active Google Forms tab |

## Key Features

- 🎙️ Voice-first interaction using Whisper speech recognition
- 📋 Direct extraction of form `entry.XXXX` IDs and questions
- 🤖 **Gemma 4** intelligence for context understanding and answer extraction
- ⚡ 1-click audio processing and mapping via Kaggle ngrok API
- 📝 Editable review screen before autofill
- 🌐 Native Google Forms DOM filling with input and event dispatching
- 🚫 Never submits a form automatically — user verifies and submits

## Target Demo

**Hacktoberfest 2026 Team Registration Form** — demonstrating audio recording, Whisper transcription, Gemma 4 mapping, and completed autofill in the user's active Chrome tab.

---

*Built for Hacktoberfest Hack Day 2026*
