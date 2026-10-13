"""
main.py — FastAPI application entry point for Local Whisper Paperwork backend.

Startup sequence:
  1. Load environment variables from .env
  2. Load Faster-Whisper model
  3. Start FastAPI with CORS for extension + localhost origins
  4. Mount API routers

Note: The interview UI lives in extension/ui/ and is served by the Chrome
extension directly — the backend only exposes the REST API.

Run with:
  uvicorn main:app --reload --port 8000
"""

from __future__ import annotations

import logging
import os
from contextlib import asynccontextmanager

from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

# Load .env before anything else
load_dotenv()

from routers import form as form_router
from routers import interview as interview_router
from routers import autofill as autofill_router
from routers import kaggle_api as kaggle_router
from services.stt import stt_service

# ── Logging ───────────────────────────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(name)s] %(levelname)s: %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger("lwp")


# ── Lifespan ──────────────────────────────────────────────────────────────────
@asynccontextmanager
async def lifespan(app: FastAPI):
    """Load resources on startup, clean up on shutdown."""
    logger.info("=" * 60)
    logger.info("  Local Whisper Paperwork — Backend Starting")
    logger.info("=" * 60)

    # Load Faster-Whisper model (blocking, happens once)
    stt_service.load()

    gemma_url = os.getenv("GEMMA_API_URL", "NOT SET")
    logger.info("Gemma API URL: %s", gemma_url)
    logger.info("Backend ready at http://localhost:%s", os.getenv("PORT", "8000"))
    logger.info("API docs: http://localhost:%s/docs", os.getenv("PORT", "8000"))
    logger.info("Interview UI: load extension/ui/index.html via the Chrome extension")

    yield

    logger.info("Backend shutting down.")


# ── App ───────────────────────────────────────────────────────────────────────
app = FastAPI(
    title="Local Whisper Paperwork",
    description="Voice-guided AI form-filling assistant — local backend API",
    version="0.1.0",
    lifespan=lifespan,
)

# ── CORS ──────────────────────────────────────────────────────────────────────
# Allow the Chrome extension and any localhost origin
ALLOWED_ORIGINS = [
    "http://localhost",
    "http://localhost:3000",
    "http://localhost:8000",
    "http://127.0.0.1",
    "http://127.0.0.1:8000",
    # Chrome extensions use chrome-extension:// scheme
    # We allow all origins for hackathon purposes; restrict in production
    "*",
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── API Routers ───────────────────────────────────────────────────────────────
app.include_router(form_router.router)
app.include_router(interview_router.router)
app.include_router(autofill_router.router)
app.include_router(kaggle_router.router)

# ── Health check ──────────────────────────────────────────────────────────────
@app.get("/api/health", tags=["system"])
async def health_check():
    from services.schema_manager import schema_manager
    from services.interview_engine import interview_engine

    schema = schema_manager.schema
    status = interview_engine.get_status() if schema_manager.has_schema() else None

    return {
        "status": "ok",
        "whisper_ready": stt_service.is_ready,
        "whisper_model": os.getenv("WHISPER_MODEL", "base"),
        "gemma_url": os.getenv("GEMMA_API_URL", "not set"),
        "schema_loaded": schema_manager.has_schema(),
        "form_title": schema.form_title if schema else None,
        "interview_status": status,
    }

# ── Root route ────────────────────────────────────────────────────────────────
# The interview UI is served by the Chrome extension (extension/ui/index.html).
# The backend only exposes REST API endpoints under /api/*.
@app.get("/", include_in_schema=False)
async def root():
    return JSONResponse({
        "service": "Local Whisper Paperwork — Backend API",
        "docs": "/docs",
        "health": "/api/health",
        "note": "Interview UI is served by the Chrome extension (extension/ui/index.html)",
    })


if __name__ == "__main__":
    import uvicorn
    port = int(os.getenv("PORT", "8000"))
    uvicorn.run("main:app", host="0.0.0.0", port=port, reload=True)
