"""
models/form_schema.py — Pydantic models for Google Form structure.
"""

from __future__ import annotations

from enum import Enum
from typing import Any, Optional
from pydantic import BaseModel, Field


class FieldType(str, Enum):
    short_text = "short_text"
    paragraph  = "paragraph"
    radio      = "radio"
    checkbox   = "checkbox"
    dropdown   = "dropdown"
    date       = "date"
    time       = "time"
    scale      = "scale"
    grid       = "grid"
    unknown    = "unknown"


class ValidationRule(BaseModel):
    max_length: Optional[int] = None
    min_length: Optional[int] = None
    format: Optional[str] = None        # "email", "phone", "url", etc.
    pattern: Optional[str] = None       # regex pattern
    min_value: Optional[float] = None   # for scale fields
    max_value: Optional[float] = None


class FormQuestion(BaseModel):
    id: str                                     # e.g. "q0", "q1"
    index: int                                  # 0-based position in form
    label: str                                  # question text
    description: Optional[str] = None          # help text / instructions
    type: FieldType = FieldType.short_text
    required: bool = False
    options: Optional[list[str]] = None        # for radio/checkbox/dropdown
    validation: Optional[ValidationRule] = None


class FormSchema(BaseModel):
    form_title: str = "Untitled Form"
    form_description: Optional[str] = None
    form_url: Optional[str] = None
    extracted_at: Optional[str] = None
    questions: list[FormQuestion] = Field(default_factory=list)
