# Local Whisper Paperwork

> **Voice-guided AI form-filling assistant — local-first, privacy-focused, interview-driven.**

## Elevator Pitch

Local Whisper Paperwork is an AI assistant that **reads an online form, interviews you about the required information, validates your answers, and fills the form automatically** — powered by **Whisper Large-v3-Turbo** for voice recognition and **Gemma-2-2B-IT** for natural language understanding and field mapping.

Instead of manually typing into dozens of fields, you provide a voice response or converse with the assistant. The AI understands the form so you don't have to.

## The Problem

Online forms are tedious:
- Dozens of fields with confusing labels and instructions
- Repeated questions across sections
- Strict format requirements (dates, phone numbers, IDs)
- Easy to miss required fields or make typos

Existing voice dictation tools can transcribe speech, but they **cannot understand a form's structure**, conduct a guided interview, validate responses, or map answers to the correct `entry.<id>` fields.

## The Solution

A streamlined pipeline that turns form-filling into voice-guided automation:

```
Active Google Form
    → Form Fields Extraction via POST /api/v1/parse-fields
    → Speech Audio Input via Extension Popup or In-Page Panel
    → Whisper STT + Gemma Field Mapping via POST /api/v1/process-audio
    → Structured Field Mapping ({ "entry.184920482": "Vishvambar", ... })
    → Autofill: Option A (Pre-filled URL) OR Option B (Direct DOM Autofill)
    → User reviews and submits manually
```

## Core Principles

| Principle | Implementation |
|---|---|
| **AI understands the form** | **Gemma-2-2B-IT** interprets questions, instructions, and maps user speech to form entry IDs |
| **User answers naturally** | Voice-first with text fallback, single-note or interview format |
| **Privacy by default** | Open-source Whisper STT + dedicated Gemma Kaggle runtime |
| **User stays in control** | Preview transcripts and mapped entries before autofill; manual submission only |
| **Existing browser session** | Chrome extension works directly in the active Google Forms tab |

## Key Features

- 🎙️ Voice-first interaction using Whisper Large-v3-Turbo speech recognition
- 📋 Direct extraction of form `entry.<id>` IDs, field types, and options
- 🤖 **Gemma-2-2B-IT** intelligence for context understanding and answer extraction
- ⚡ 1-click audio processing and mapping via Kaggle ngrok API (`ngrok-skip-browser-warning: true`)
- 📝 Both Direct DOM Autofill and Pre-filled URL redirection supported
- 🌐 In-page floating interview panel or lightweight popup interface
- 🚫 Never submits a form automatically — user verifies and submits

## Target Demo

**Hacktoberfest 2026 Team Registration Form** — demonstrating audio recording, Whisper transcription, Gemma mapping, and completed autofill in the user's active Chrome tab.

---

*Built for Hacktoberfest Hack Day 2026*
