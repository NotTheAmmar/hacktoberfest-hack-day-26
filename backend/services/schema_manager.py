"""
services/schema_manager.py — Manages the extracted form schema in memory.

Acts as the single source of truth for the current form being processed.
Thread-safe via asyncio (FastAPI is single-threaded async).
"""

from __future__ import annotations

from typing import Optional
from models.form_schema import FormSchema, FormQuestion, FieldType


class SchemaManager:
    """Holds and provides query methods for the active form schema."""

    def __init__(self) -> None:
        self._schema: Optional[FormSchema] = None

    # ── Lifecycle ──────────────────────────────────────────────────────────────

    def set_schema(self, schema: FormSchema) -> None:
        self._schema = schema

    def clear(self) -> None:
        self._schema = None

    def has_schema(self) -> bool:
        return self._schema is not None

    # ── Accessors ──────────────────────────────────────────────────────────────

    @property
    def schema(self) -> Optional[FormSchema]:
        return self._schema

    def get_question(self, question_id: str) -> Optional[FormQuestion]:
        if not self._schema:
            return None
        return next((q for q in self._schema.questions if q.id == question_id), None)

    def get_question_by_index(self, index: int) -> Optional[FormQuestion]:
        if not self._schema:
            return None
        qs = self._schema.questions
        return qs[index] if 0 <= index < len(qs) else None

    def all_questions(self) -> list[FormQuestion]:
        return self._schema.questions if self._schema else []

    def required_questions(self) -> list[FormQuestion]:
        return [q for q in self.all_questions() if q.required]

    def optional_questions(self) -> list[FormQuestion]:
        return [q for q in self.all_questions() if not q.required]

    def total_count(self) -> int:
        return len(self.all_questions())

    # ── Helpers ───────────────────────────────────────────────────────────────

    def is_choice_type(self, question: FormQuestion) -> bool:
        return question.type in (FieldType.radio, FieldType.checkbox, FieldType.dropdown)

    def validate_answer_for_question(
        self,
        question: FormQuestion,
        value: object,
    ) -> tuple[bool, Optional[str]]:
        """
        Basic structural validation of an answer value against a question's rules.
        Returns (is_valid, error_message_or_None).
        """
        if value is None or value == "":
            if question.required:
                return False, f"'{question.label}' is required."
            return True, None

        str_value = str(value)

        # Choice field: check option membership
        if self.is_choice_type(question) and question.options:
            if question.type == FieldType.checkbox:
                # value may be a list
                items = value if isinstance(value, list) else [value]
                for item in items:
                    match = any(
                        opt.lower() == str(item).lower()
                        for opt in question.options
                    )
                    if not match:
                        return False, f"'{item}' is not a valid option for '{question.label}'."
            else:
                match = any(opt.lower() == str_value.lower() for opt in question.options)
                if not match:
                    return False, f"'{value}' is not a valid option for '{question.label}'."

        # Validation rules
        if question.validation:
            v = question.validation
            if v.max_length and len(str_value) > v.max_length:
                return False, f"Answer exceeds maximum length of {v.max_length} characters."
            if v.min_length and len(str_value) < v.min_length:
                return False, f"Answer must be at least {v.min_length} characters."
            if v.format == "email" and "@" not in str_value:
                return False, "Please provide a valid email address."
            if v.format == "phone":
                digits = "".join(c for c in str_value if c.isdigit())
                if len(digits) < 7:
                    return False, "Please provide a valid phone number."

        return True, None


# ── Singleton instance shared across the application ──────────────────────────
schema_manager = SchemaManager()
