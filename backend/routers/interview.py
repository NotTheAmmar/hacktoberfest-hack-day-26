"""routers/interview.py — Interview Q&A endpoints."""

import logging
from fastapi import APIRouter, HTTPException, UploadFile, File
from models.interview import AnswerSource, EditRequest, AnswerSubmission
from services.schema_manager import schema_manager
from services.interview_engine import interview_engine
from services.stt import stt_service

router = APIRouter(prefix="/api/interview", tags=["interview"])
logger = logging.getLogger("lwp.router.interview")


@router.get("/next")
async def get_next_question():
    """
    Return the next interview question.
    Returns 204 (no content) when the interview is complete.
    """
    if not schema_manager.has_schema():
        raise HTTPException(status_code=400, detail="No form schema loaded. Extract a form first.")

    question = await interview_engine.get_next_question()

    if question is None:
        return {"complete": True, "question": None}

    return {"complete": False, "question": question.model_dump()}


@router.post("/answer")
async def submit_text_answer(payload: AnswerSubmission):
    """Submit a typed text answer for a question."""
    if not schema_manager.has_schema():
        raise HTTPException(status_code=400, detail="No form schema loaded.")

    if not payload.raw_answer.strip():
        raise HTTPException(status_code=422, detail="Answer cannot be empty. Use 'skip' to skip.")

    try:
        stored = await interview_engine.submit_answer(
            question_id=payload.question_id,
            raw_answer=payload.raw_answer,
            source=AnswerSource.text,
        )
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))

    return {
        "success": True,
        "answer": stored.model_dump(),
        "status": interview_engine.get_status(),
    }


@router.post("/voice")
async def submit_voice_answer(
    question_id: str,
    audio: UploadFile = File(...),
):
    """
    Accept a voice recording, transcribe it locally with Faster-Whisper,
    and process it as an answer.
    """
    if not schema_manager.has_schema():
        raise HTTPException(status_code=400, detail="No form schema loaded.")

    if not stt_service.is_ready:
        raise HTTPException(
            status_code=503,
            detail="Speech recognition model is not loaded. Check backend logs.",
        )

    audio_bytes = await audio.read()
    if not audio_bytes:
        raise HTTPException(status_code=422, detail="Empty audio file.")

    # Transcribe locally
    transcript = await stt_service.transcribe(audio_bytes)
    if not transcript:
        raise HTTPException(status_code=422, detail="Could not transcribe audio. Please try again or type your answer.")

    logger.info("Voice answer for %s: %r", question_id, transcript)

    try:
        stored = await interview_engine.submit_answer(
            question_id=question_id,
            raw_answer=transcript,
            source=AnswerSource.voice,
        )
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))

    return {
        "success": True,
        "transcript": transcript,
        "answer": stored.model_dump(),
        "status": interview_engine.get_status(),
    }


@router.get("/status")
async def get_interview_status():
    """Return the current interview progress and all answers."""
    if not schema_manager.has_schema():
        raise HTTPException(status_code=400, detail="No form schema loaded.")

    return {
        **interview_engine.get_status(),
        "answers": interview_engine.get_all_answers(),
    }


@router.post("/edit")
async def edit_answer(payload: EditRequest):
    """Edit a previously submitted answer."""
    if not schema_manager.has_schema():
        raise HTTPException(status_code=400, detail="No form schema loaded.")

    try:
        stored = await interview_engine.edit_answer(
            question_id=payload.question_id,
            new_answer=payload.new_answer,
        )
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))

    return {
        "success": True,
        "answer": stored.model_dump(),
    }


@router.post("/reset")
async def reset_interview():
    """Reset the interview session (keeps the schema, clears all answers)."""
    interview_engine.reset()
    return {"success": True, "message": "Interview reset."}
