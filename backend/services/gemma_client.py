"""
services/gemma_client.py — HTTP client for Gemma 4 hosted on Kaggle via ngrok.

Supports:
  1. OpenAI-compatible: POST /v1/chat/completions (model: gemma4)
  2. Custom generate:   POST /generate
  3. Direct mapping from audio transcript to entry.XXXX fields
"""

from __future__ import annotations

import os
import json
import logging
from typing import Any, Optional

import httpx
from dotenv import load_dotenv

load_dotenv()
logger = logging.getLogger("lwp.gemma4")

GEMMA_API_URL    = os.getenv("GEMMA_API_URL", "").rstrip("/")
GEMMA_ENDPOINT   = os.getenv("GEMMA_ENDPOINT", "/v1/chat/completions")
REQUEST_TIMEOUT  = 60.0  # seconds


# ── Prompt Templates ──────────────────────────────────────────────────────────

def _system_prompt() -> str:
    return (
        "You are an AI assistant powered by Gemma 4 guiding a user through filling an online form. "
        "Extract precise answers and return clean JSON without extra conversational text."
    )


def build_question_prompt(
    field_label: str,
    field_type: str,
    options: Optional[list[str]],
    description: Optional[str],
    context: dict,
) -> str:
    ctx_lines = "\n".join(f"  - {k}: {v}" for k, v in context.items()) or "  (none yet)"
    opts_line = f"\nThe available options are: {', '.join(options)}." if options else ""

    return f"""You are helping a user fill out a form field.

Field label: "{field_label}"
Field type: {field_type}{opts_line}
{'Field instructions: ' + description if description else ''}

Information already collected:
{ctx_lines}

Generate a short, friendly question to ask the user for this field.
Do NOT repeat questions for information already collected.
Only output the question itself — no preamble, no explanation."""


def build_interpret_prompt(
    field_label: str,
    field_type: str,
    options: Optional[list[str]],
    raw_answer: str,
) -> str:
    opts_line = f"\nValid options: {', '.join(options)}." if options else ""
    type_hint = {
        "radio":    "Return exactly one of the listed options.",
        "checkbox": "Return a JSON array of matching option strings.",
        "dropdown": "Return exactly one of the listed options.",
        "date":     "Return the date as YYYY-MM-DD.",
        "time":     "Return the time as HH:MM (24-hour).",
    }.get(field_type, "Return the exact value to put in the form field.")

    return f"""Extract the answer for this form field from the user's response.

Field: "{field_label}" (type: {field_type}){opts_line}
User said: "{raw_answer}"

{type_hint}
If the user said "N/A", "skip", or similar — return exactly: N/A
If you cannot determine a value, return: UNCLEAR
Output only the value — no explanation, no quotes (unless it's a JSON array)."""


def build_mapping_prompt(fields: list[dict], transcript: str) -> str:
    fields_str = json.dumps(fields, indent=2)
    return f"""<start_of_turn>user
You are an accurate automated data-entry assistant.
Task: Map the spoken transcript into the provided form fields.

Target Form Fields:
{fields_str}

Spoken Transcript:
"{transcript}"

Requirements:
1. Output ONLY a valid JSON dictionary where each key is the exact field 'id' (e.g., "entry.123456789").
2. Format values by field type:
   - "short_text" / "paragraph": plain text string
   - "date": output as "YYYY-MM-DD" (e.g., "2024-10-13")
   - "time": output as "HH:MM" in 24-hour format (e.g., "14:30" for 2:30 PM)
   - "radio" / "dropdown": output the EXACT matching option text from the options list
   - "checkbox": output comma-separated matching option texts (e.g., "Option A, Option C")
   - "linear_scale": output a single number string (e.g., "3")
3. If a field was not mentioned, omit it or set its value to "".
4. Do not include markdown code blocks. Return the raw JSON object only.<end_of_turn>
<start_of_turn>model
"""


# ── HTTP Caller ───────────────────────────────────────────────────────────────

async def _call_gemma(prompt: str) -> str:
    """Send a prompt to the Gemma endpoint and return the response text."""
    if not GEMMA_API_URL:
        logger.warning("GEMMA_API_URL not set — returning mock response")
        return "[Gemma not configured — please set GEMMA_API_URL in .env]"

    url = GEMMA_API_URL + GEMMA_ENDPOINT
    is_openai_compat = "/chat/completions" in GEMMA_ENDPOINT

    if is_openai_compat:
        body = {
            "model": "gemma-2-2b-it",
            "messages": [
                {"role": "system", "content": _system_prompt()},
                {"role": "user",   "content": prompt},
            ],
            "max_tokens": 512,
            "temperature": 0.1,
        }
    else:
        body = {
            "prompt": f"<system>{_system_prompt()}</system>\n\n{prompt}",
            "max_tokens": 512,
            "temperature": 0.1,
        }

    async with httpx.AsyncClient(timeout=REQUEST_TIMEOUT) as client:
        try:
            resp = await client.post(
                url,
                json=body,
                headers={
                    "Content-Type": "application/json",
                    "ngrok-skip-browser-warning": "true",
                },
            )
            resp.raise_for_status()
            data = resp.json()
        except httpx.TimeoutException:
            raise RuntimeError("Gemma request timed out. Check your ngrok tunnel.")
        except httpx.HTTPStatusError as e:
            raise RuntimeError(f"Gemma API error {e.response.status_code}: {e.response.text[:200]}")

    if is_openai_compat:
        try:
            return data["choices"][0]["message"]["content"].strip()
        except (KeyError, IndexError):
            raise RuntimeError(f"Unexpected OpenAI response format: {data}")
    else:
        for key in ("response", "text", "generated_text", "content", "output"):
            if key in data:
                return str(data[key]).strip()
        raise RuntimeError(f"Cannot parse Gemma 4 response: {list(data.keys())}")


# ── Public API ────────────────────────────────────────────────────────────────

async def generate_question(
    field_label: str,
    field_type: str,
    options: Optional[list[str]],
    description: Optional[str],
    context: dict,
) -> str:
    prompt = build_question_prompt(field_label, field_type, options, description, context)
    return await _call_gemma(prompt)


async def interpret_answer(
    field_label: str,
    field_type: str,
    options: Optional[list[str]],
    raw_answer: str,
) -> str:
    prompt = build_interpret_prompt(field_label, field_type, options, raw_answer)
    result = await _call_gemma(prompt)

    if field_type == "checkbox":
        try:
            parsed = json.loads(result)
            if isinstance(parsed, list):
                return parsed
        except (json.JSONDecodeError, ValueError):
            pass

    return result


def fallback_interview_prompt(f: dict) -> str:
    label = f.get("label", "this question").strip().rstrip("?:*")
    options = f.get("options", [])
    ftype = f.get("type", "short_text")
    if options and ftype in ("radio", "dropdown", "checkbox"):
        if len(options) <= 4:
            opts_text = ", ".join(options[:-1]) + (" or " if len(options) > 1 else "") + options[-1]
            return f"Which {label.lower()} are you with: {opts_text}?"
        else:
            opts_text = ", ".join(options[:3]) + f", or {len(options) - 3} other options"
            return f"For {label.lower()}, please choose: {opts_text}."
    elif ftype == "date":
        return f"What is the date for {label.lower()}?"
    elif ftype == "time":
        return f"What time for {label.lower()}?"
    elif ftype == "paragraph":
        return f"Please describe your {label.lower()}."
    return f"What is your {label.lower()}?" if not label.endswith("?") else label


async def generate_interview_prompts(fields: list[dict]) -> list[dict]:
    """
    Analyzes form questions and generates structured, conversational interview_prompt
    for each question, explicitly detailing options in short for choice fields.
    """
    fields_copy = [dict(f) for f in fields]
    
    # Pre-populate with intelligent fallbacks
    for f in fields_copy:
        f["interview_prompt"] = fallback_interview_prompt(f)

    if not GEMMA_API_URL:
        return fields_copy

    try:
        fields_json_str = json.dumps([{
            "id": f.get("id"),
            "label": f.get("label"),
            "type": f.get("type"),
            "options": f.get("options", [])
        } for f in fields_copy], indent=2)

        prompt = f"""<start_of_turn>user
You are an expert AI interviewer helping a user complete an online form.
For each form field, generate a friendly, clear, concise interview question ('interview_prompt') to ask the user by voice.

Rules:
1. For text/paragraph/date/time fields: keep it natural and direct (e.g. "What is your full legal name?").
2. For radio, dropdown, or checkbox fields with options: you MUST include the options in short in the prompt so the user knows what choices exist (e.g. "Which department are you with: Engineering, Product Design, or Human Resources?").
3. Return ONLY a valid JSON list of objects matching the input fields with the added 'interview_prompt' string key.
4. No preamble or markdown code blocks.

Fields:
{fields_json_str}
<end_of_turn>
<start_of_turn>model
"""
        resp = await _call_gemma(prompt)
        cleaned = resp.strip()
        if cleaned.startswith("```json"):
            cleaned = cleaned[7:]
        if cleaned.startswith("```"):
            cleaned = cleaned[3:]
        if cleaned.endswith("```"):
            cleaned = cleaned[:-3]
        parsed = json.loads(cleaned.strip())
        if isinstance(parsed, list):
            prompt_map = {item.get("id"): item.get("interview_prompt") for item in parsed if item.get("id")}
            for f in fields_copy:
                if prompt_map.get(f.get("id")):
                    f["interview_prompt"] = prompt_map[f.get("id")]
    except Exception as exc:
        logger.warning("Gemma prompt generation failed, using intelligent fallbacks: %s", exc)

    return fields_copy


async def format_single_answer(transcript: str, field_meta: dict) -> str:
    """
    Extracts and formats a single answer from spoken transcript into the form field value.
    """
    raw = transcript.strip().rstrip(".,!?")
    options = field_meta.get("options", [])
    ftype = field_meta.get("type", "short_text")

    # Fast heuristic for options match
    if options:
        lower_raw = raw.lower()
        for opt in options:
            if opt.lower() == lower_raw or opt.lower() in lower_raw:
                return opt

    if not GEMMA_API_URL:
        return raw

    try:
        opts_hint = f"\nValid options: {json.dumps(options)}" if options else ""
        prompt = f"""<start_of_turn>user
You are an automated data entry assistant.
Field Label: "{field_meta.get('label')}"
Field Type: {ftype}{opts_hint}
Interview Question: "{field_meta.get('interview_prompt', field_meta.get('label'))}"
User's Spoken Answer: "{transcript}"

Task: Extract the exact formatted value for this field.
Requirements:
1. If field type is radio or dropdown, output the EXACT matching option string.
2. If checkbox, output comma-separated matching options.
3. If date, output YYYY-MM-DD format.
4. If time, output HH:MM format.
5. If short text or paragraph, clean up speech filler words (e.g. "uh", "um", "please") and output clean text.
6. Output ONLY the raw value string with no quotes, no markdown, and no explanation.
<end_of_turn>
<start_of_turn>model
"""
        formatted = await _call_gemma(prompt)
        return formatted.strip().strip('"\'')
    except Exception as exc:
        logger.warning("Gemma single answer format failed, returning raw transcript: %s", exc)
        return raw


async def map_fields_from_transcript(fields: list[dict], transcript: str) -> dict[str, str]:
    """Uses Gemma 4 to map transcript text directly into { "entry.XXXX": "value" }."""
    prompt = build_mapping_prompt(fields, transcript)
    response_text = await _call_gemma(prompt)

    # Clean potential markdown fences
    cleaned = response_text.strip()
    if cleaned.startswith("```json"):
        cleaned = cleaned[7:]
    if cleaned.startswith("```"):
        cleaned = cleaned[3:]
    if cleaned.endswith("```"):
        cleaned = cleaned[:-3]
    cleaned = cleaned.strip()

    try:
        return json.loads(cleaned)
    except Exception as exc:
        logger.warning("Failed to parse JSON mapping from Gemma 4: %s (Raw: %r)", exc, response_text)
        # Fallback dictionary
        res = {}
        for f in fields:
            fid = f.get("id")
            if fid:
                res[fid] = transcript
        return res

