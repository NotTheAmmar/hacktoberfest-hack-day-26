"""
services/gemma_client.py — HTTP client for Gemma 2 hosted on Kaggle via ngrok.

Supports two API modes (configured via GEMMA_ENDPOINT env var):
  1. OpenAI-compatible: POST /v1/chat/completions  (recommended)
  2. Custom generate:   POST /generate

Prompt templates are defined here; callers pass structured context
and receive plain-text responses.
"""

from __future__ import annotations

import os
import json
import logging
from typing import Optional

import httpx
from dotenv import load_dotenv

load_dotenv()
logger = logging.getLogger("lwp.gemma")

GEMMA_API_URL    = os.getenv("GEMMA_API_URL", "").rstrip("/")
GEMMA_ENDPOINT   = os.getenv("GEMMA_ENDPOINT", "/v1/chat/completions")
REQUEST_TIMEOUT  = 60.0  # seconds


# ── Prompt Templates ──────────────────────────────────────────────────────────

def _system_prompt() -> str:
    return (
        "You are a helpful assistant guiding a user through filling out an online form. "
        "Be concise, clear, and friendly. Ask one thing at a time. "
        "When interpreting answers, extract only the specific value needed — do not add extra words."
    )


def build_question_prompt(
    field_label: str,
    field_type: str,
    options: Optional[list[str]],
    description: Optional[str],
    context: dict,
) -> str:
    """
    Generate a natural-language interview question for a form field.
    context: dict of {label: value} for answers already collected.
    """
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
    """
    Interpret a user's free-form answer into the exact value needed by the form.
    """
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


def build_validation_prompt(
    field_label: str,
    field_type: str,
    value: str,
    rules: Optional[dict],
) -> str:
    """Ask Gemma to validate a value against field rules."""
    rules_str = json.dumps(rules) if rules else "none"
    return f"""Does this value satisfy the form field requirements?

Field: "{field_label}" (type: {field_type})
Value: "{value}"
Validation rules: {rules_str}

Reply with either:
  VALID
  INVALID: <brief reason>"""


# ── HTTP Caller ───────────────────────────────────────────────────────────────

async def _call_gemma(prompt: str) -> str:
    """
    Send a prompt to the Gemma 2 endpoint and return the response text.
    Supports OpenAI-compatible and custom /generate endpoints.
    """
    if not GEMMA_API_URL:
        logger.warning("GEMMA_API_URL not set — returning mock response")
        return "[Gemma not configured — please set GEMMA_API_URL in .env]"

    url = GEMMA_API_URL + GEMMA_ENDPOINT

    # ── Build request body ────────────────────────────────────────────────────
    is_openai_compat = "/chat/completions" in GEMMA_ENDPOINT

    if is_openai_compat:
        body = {
            "model": "gemma2",          # model name on your Kaggle server
            "messages": [
                {"role": "system", "content": _system_prompt()},
                {"role": "user",   "content": prompt},
            ],
            "max_tokens": 300,
            "temperature": 0.3,
        }
    else:
        # Simple /generate style (e.g. llama.cpp server, Ollama, etc.)
        body = {
            "prompt": f"<system>{_system_prompt()}</system>\n\n{prompt}",
            "max_tokens": 300,
            "temperature": 0.3,
        }

    # ── Send request ──────────────────────────────────────────────────────────
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
            raise RuntimeError("Gemma request timed out. Check your ngrok tunnel.")
        except httpx.HTTPStatusError as e:
            raise RuntimeError(f"Gemma API error {e.response.status_code}: {e.response.text[:200]}")

    # ── Parse response ────────────────────────────────────────────────────────
    if is_openai_compat:
        # OpenAI format: choices[0].message.content
        try:
            return data["choices"][0]["message"]["content"].strip()
        except (KeyError, IndexError):
            raise RuntimeError(f"Unexpected OpenAI response format: {data}")
    else:
        # Common alternatives: response, text, generated_text, content
        for key in ("response", "text", "generated_text", "content", "output"):
            if key in data:
                return str(data[key]).strip()
        raise RuntimeError(f"Cannot parse Gemma response: {list(data.keys())}")


# ── Public API ────────────────────────────────────────────────────────────────

async def generate_question(
    field_label: str,
    field_type: str,
    options: Optional[list[str]],
    description: Optional[str],
    context: dict,
) -> str:
    """Generate a natural-language question for the given form field."""
    prompt = build_question_prompt(field_label, field_type, options, description, context)
    return await _call_gemma(prompt)


async def interpret_answer(
    field_label: str,
    field_type: str,
    options: Optional[list[str]],
    raw_answer: str,
) -> str:
    """Interpret a raw user answer into a form-ready value."""
    prompt = build_interpret_prompt(field_label, field_type, options, raw_answer)
    result = await _call_gemma(prompt)

    # Parse JSON arrays for checkbox fields
    if field_type == "checkbox":
        try:
            parsed = json.loads(result)
            if isinstance(parsed, list):
                return parsed
        except (json.JSONDecodeError, ValueError):
            pass

    return result


async def validate_answer(
    field_label: str,
    field_type: str,
    value: str,
    rules: Optional[dict],
) -> tuple[bool, Optional[str]]:
    """
    Ask Gemma to validate a value. Returns (is_valid, error_or_None).
    Used as a secondary validation after structural checks.
    """
    prompt = build_validation_prompt(field_label, field_type, value, rules)
    response = await _call_gemma(prompt)

    if response.upper().startswith("VALID"):
        return True, None
    elif response.upper().startswith("INVALID"):
        reason = response[len("INVALID:"):].strip() if ":" in response else response
        return False, reason
    else:
        # If Gemma is uncertain, trust structural validation
        return True, None
