"""
routers/kaggle_api.py — Implements the exact Kaggle API contract locally.

Matches the Kaggle notebook specification in artifacts/reference notebook.ipynb:
  - POST /api/v1/parse-fields
  - POST /api/v1/process-audio
"""

from __future__ import annotations

import json
import logging
import os
import re
import subprocess
import tempfile
from typing import Optional

import httpx
from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from pydantic import BaseModel

from services.stt import stt_service
import services.gemma_client as gemma

logger = logging.getLogger("lwp.kaggle_api")

router = APIRouter(prefix="/api/v1", tags=["kaggle_v1"])

FIELD_TYPE_MAP = {
    0: "short_text",
    1: "paragraph",
    2: "radio",
    3: "dropdown",
    4: "checkbox",
    5: "linear_scale",
    7: "grid",
    9: "date",
    10: "time",
    13: "file_upload",
}


def extract_form_fields_from_html(html: str) -> list[dict]:
    """Scrapes entry IDs, labels, types, and options from Google Forms HTML."""
    match = re.search(r'var FB_PUBLIC_LOAD_DATA_ = (\[.*?\]);\n', html, re.DOTALL)
    if not match:
        match = re.search(r'FB_PUBLIC_LOAD_DATA_\s*=\s*(\[.*?\]);', html, re.DOTALL)
    if not match:
        raise ValueError("Could not find form metadata.")

    raw_data = json.loads(match.group(1))
    questions = raw_data[1][1]
    fields = []
    for q in questions:
        if q and len(q) > 4 and q[4]:
            label = q[1]
            type_code = q[3]
            field_type = FIELD_TYPE_MAP.get(type_code, "short_text")
            entry_id = f"entry.{q[4][0][0]}"
            field_info = {"id": entry_id, "label": label, "type": field_type}

            # Extract options for choice-based fields safely
            if type_code in [2, 3, 4] and len(q[4][0]) > 1 and q[4][0][1]:
                field_info["options"] = [opt[0] for opt in q[4][0][1] if opt and opt[0]]

            fields.append(field_info)
    return fields


class ParseFieldsRequest(BaseModel):
    url: str


@router.post("/parse-fields")
async def parse_fields(payload: ParseFieldsRequest):
    """
    Scrapes question labels, Google Form entry.<id> identifiers, field types, and options.
    """
    google_form_url = payload.url.strip().replace("/edit", "/viewform")
    if not google_form_url.startswith("http"):
        raise HTTPException(status_code=400, detail="Invalid URL provided.")

    logger.info("Scraping Google Form fields from: %s", google_form_url)

    try:
        async with httpx.AsyncClient(follow_redirects=True, timeout=12.0) as client:
            resp = await client.get(google_form_url, headers={
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
            })
            if resp.status_code != 200:
                raise HTTPException(status_code=400, detail=f"Failed to fetch form: HTTP {resp.status_code}")
            html = resp.text

        fields = extract_form_fields_from_html(html)
        return {"status": "success", "fields": fields}
    except Exception as e:
        logger.warning("Scrape error: %s", e)
        # Fallback to regex if FB_PUBLIC_LOAD_DATA_ format varied
        entry_matches = re.findall(r'name=["\'](entry\.\d+)["\']', html) if 'html' in locals() else []
        if entry_matches:
            unique_entries = list(dict.fromkeys(entry_matches))
            fields = [{"id": eid, "label": f"Field {i + 1}", "type": "short_text"} for i, eid in enumerate(unique_entries)]
            return {"status": "success", "fields": fields}

        raise HTTPException(status_code=400, detail=f"Failed to scrape form: {str(e)}")


@router.post("/process-audio")
async def process_audio(
    audio_file: UploadFile = File(...),
    fields_json: str = Form(...),
):
    """
    Accepts recorded audio + scraped fields. Runs Whisper STT + Gemma mapping.
    Returns transcript and mapped_entries: { "entry.184920482": "Vishvambar" }
    """
    try:
        fields = json.loads(fields_json)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid fields_json format")

    audio_bytes = await audio_file.read()

    # Guard: minimum 1000 bytes (~2 seconds)
    if len(audio_bytes) < 1000:
        raise HTTPException(
            status_code=400,
            detail="Audio file too short or empty. Speak for at least 2 seconds."
        )

    # 1. Transcribe with Whisper
    transcript = ""
    if stt_service.is_ready:
        transcript = await stt_service.transcribe(audio_bytes)

    if not transcript:
        raise HTTPException(status_code=400, detail="No speech detected in audio.")

    logger.info("Transcribed audio: %r", transcript)

    # 2. Map entries via Gemma
    mapped_data = {}
    try:
        mapped_data = await gemma.map_fields_from_transcript(fields, transcript)
    except Exception as e:
        logger.warning("Gemma mapping error, fallback heuristic: %s", e)
        for f in fields:
            mapped_data[f["id"]] = transcript

    return {
        "status": "success",
        "transcript": transcript,
        "mapped_entries": mapped_data,
    }
