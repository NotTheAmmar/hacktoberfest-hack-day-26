"""routers/autofill.py — Autofill data endpoint for the Chrome extension."""

from fastapi import APIRouter, HTTPException
from services.schema_manager import schema_manager
from services.interview_engine import interview_engine

router = APIRouter(prefix="/api", tags=["autofill"])


@router.get("/autofill-data")
async def get_autofill_data():
    """
    Return the validated answer map for the Chrome extension to autofill the form.
    Only returns when at least some answers have been collected.
    """
    if not schema_manager.has_schema():
        raise HTTPException(status_code=404, detail="No form schema loaded.")

    status = interview_engine.get_status()
    if status["answered"] == 0:
        raise HTTPException(
            status_code=400,
            detail="No answers collected yet. Complete the interview first.",
        )

    data = interview_engine.build_autofill_data()
    return data.model_dump()
