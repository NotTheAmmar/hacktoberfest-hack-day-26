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
    fields_desc = "\n".join(f"- {f.get('id')}: {f.get('label')}" for f in fields)
    return f"""Given the following Google Form fields:
{fields_desc}

And the user's speech transcript:
"{transcript}"

Map the information from the transcript to the appropriate entry IDs.
Return ONLY a valid JSON object where keys are the field IDs (e.g. "entry.123456789") and values are the extracted values.
Do not wrap in markdown quotes if possible, output only valid JSON.
Example output:
{{
  "entry.123456789": "Ammar",
  "entry.987654321": "fever and headache"
}}"""


# ── HTTP Caller ───────────────────────────────────────────────────────────────

async def _call_gemma(prompt: str) -> str:
    """Send a prompt to the Gemma 4 endpoint and return the response text."""
    if not GEMMA_API_URL:
        logger.warning("GEMMA_API_URL not set — returning mock response")
        return "[Gemma 4 not configured — please set GEMMA_API_URL in .env]"

    url = GEMMA_API_URL + GEMMA_ENDPOINT
    is_openai_compat = "/chat/completions" in GEMMA_ENDPOINT

    if is_openai_compat:
        body = {
            "model": "gemma4",
            "messages": [
                {"role": "system", "content": _system_prompt()},
                {"role": "user",   "content": prompt},
            ],
            "max_tokens": 400,
            "temperature": 0.2,
        }
    else:
        body = {
            "prompt": f"<system>{_system_prompt()}</system>\n\n{prompt}",
            "max_tokens": 400,
            "temperature": 0.2,
        }

    async with httpx.AsyncClient(timeout=REQUEST_TIMEOUT) as client:
        try:
            resp = await client.post(
                url,
                json=body,
                headers={"Content-Type": "application/json"},
            )
            resp.raise_for_status()
            data = resp.json()
        except httpx.TimeoutException:
            raise RuntimeError("Gemma 4 request timed out. Check your ngrok tunnel.")
        except httpx.HTTPStatusError as e:
            raise RuntimeError(f"Gemma 4 API error {e.response.status_code}: {e.response.text[:200]}")

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
