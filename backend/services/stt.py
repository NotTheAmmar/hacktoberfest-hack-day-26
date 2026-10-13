"""
services/stt.py — Local speech-to-text using Faster-Whisper.

Loads the Whisper model once on startup and exposes a transcribe() function.
Audio bytes (webm/wav/ogg from the browser's MediaRecorder) are written
to a temp file, transcribed, and the temp file is deleted immediately.
"""

from __future__ import annotations

import io
import logging
import os
import tempfile
from pathlib import Path
from typing import Optional

from dotenv import load_dotenv

load_dotenv()
logger = logging.getLogger("lwp.stt")

WHISPER_MODEL        = os.getenv("WHISPER_MODEL", "base")
WHISPER_DEVICE       = os.getenv("WHISPER_DEVICE", "cpu")
WHISPER_COMPUTE_TYPE = os.getenv("WHISPER_COMPUTE_TYPE", "int8")


class STTService:
    """Wraps Faster-Whisper for on-demand transcription."""

    def __init__(self) -> None:
        self._model = None

    def load(self) -> None:
        """Load the Whisper model. Call this once at app startup."""
        try:
            from faster_whisper import WhisperModel
            logger.info(
                "Loading Whisper model '%s' on %s (%s)…",
                WHISPER_MODEL, WHISPER_DEVICE, WHISPER_COMPUTE_TYPE,
            )
            self._model = WhisperModel(
                WHISPER_MODEL,
                device=WHISPER_DEVICE,
                compute_type=WHISPER_COMPUTE_TYPE,
            )
            logger.info("Whisper model loaded successfully.")
        except Exception as exc:
            logger.error("Failed to load Whisper model: %s", exc)
            self._model = None

    @property
    def is_ready(self) -> bool:
        return self._model is not None

    async def transcribe(
        self,
        audio_bytes: bytes,
        language: Optional[str] = None,
    ) -> str:
        """
        Transcribe audio bytes to text.

        Args:
            audio_bytes: Raw audio data (webm, wav, ogg, mp3).
            language:    ISO 639-1 language code (e.g. 'en'). None = auto-detect.

        Returns:
            Transcribed text string, or "" on failure.
        """
        if not self.is_ready:
            logger.error("STT model not loaded — cannot transcribe.")
            return ""

        # Write audio to a temporary file (Whisper needs a file path)
        suffix = _detect_suffix(audio_bytes)
        with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
            tmp.write(audio_bytes)
            tmp_path = tmp.name

        try:
            kwargs: dict = {"beam_size": 5}
            if language:
                kwargs["language"] = language

            segments, info = self._model.transcribe(tmp_path, **kwargs)
            transcript = " ".join(seg.text.strip() for seg in segments).strip()

            logger.info(
                "Transcribed %.1fs of audio (lang=%s): %r",
                info.duration, info.language, transcript[:80],
            )
            return transcript

        except Exception as exc:
            logger.error("Transcription error: %s", exc)
            return ""

        finally:
            try:
                Path(tmp_path).unlink()
            except OSError:
                pass


def _detect_suffix(data: bytes) -> str:
    """Detect audio format from magic bytes."""
    if data[:4] == b"RIFF":
        return ".wav"
    if data[:4] == b"OggS":
        return ".ogg"
    if data[:3] == b"ID3" or data[:2] == b"\xff\xfb":
        return ".mp3"
    # Default: webm (MediaRecorder default in Chrome)
    return ".webm"


# ── Singleton ─────────────────────────────────────────────────────────────────
stt_service = STTService()
