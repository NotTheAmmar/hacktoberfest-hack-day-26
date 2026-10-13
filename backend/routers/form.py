"""routers/form.py — Form schema upload and retrieval endpoints."""

from fastapi import APIRouter, HTTPException
from models.form_schema import FormSchema
from services.schema_manager import schema_manager
from services.interview_engine import interview_engine

router = APIRouter(prefix="/api", tags=["form"])


@router.post("/form-schema")
async def upload_form_schema(schema: FormSchema):
    """
    Accept an extracted form schema from the Chrome extension.
    Resets the interview session for the new form.
    """
    if not schema.questions:
        raise HTTPException(status_code=400, detail="Schema contains no questions.")

    schema_manager.set_schema(schema)
    interview_engine.reset()

    return {
        "success": True,
        "message": f"Schema loaded: {schema.form_title} ({len(schema.questions)} questions)",
        "schema": schema.model_dump(),
    }


@router.get("/form-schema")
async def get_form_schema():
    """Return the currently loaded form schema."""
    if not schema_manager.has_schema():
        raise HTTPException(status_code=404, detail="No form schema loaded yet.")
    return schema_manager.schema.model_dump()


@router.delete("/form-schema")
async def clear_form_schema():
    """Clear the current schema and reset the interview."""
    schema_manager.clear()
    interview_engine.reset()
    return {"success": True, "message": "Schema cleared."}
