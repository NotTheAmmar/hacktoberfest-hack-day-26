"""
services/interview_engine.py — Core interview orchestration.

Manages the stateful Q&A session:
  - Tracks which questions have been answered
  - Generates natural-language questions via Gemma
  - Interprets and validates user answers via Gemma
  - Maintains conversation context for smart question generation
  - Builds the final autofill data map
"""

from __future__ import annotations

import json
import logging
from typing import Any, Optional

from models.form_schema import FormQuestion, FieldType
from models.interview import (
    AnswerConfidence, AnswerSource, AutofillData, AutofillEntry,
    InterviewQuestion, StoredAnswer,
)
from services.schema_manager import schema_manager
import services.gemma_client as gemma

logger = logging.getLogger("lwp.interview")


class InterviewEngine:
    """
    Stateful interview session. One instance per server lifetime
    (reset when a new form schema is loaded).
    """

    def __init__(self) -> None:
        self._answers: dict[str, StoredAnswer] = {}
        self._current_question_id: Optional[str] = None

    # ── Reset ─────────────────────────────────────────────────────────────────

    def reset(self) -> None:
        """Clear all answers and restart the interview."""
        self._answers = {}
        self._current_question_id = None
        logger.info("Interview session reset.")

    # ── Context helpers ───────────────────────────────────────────────────────

    def _answered_ids(self) -> set[str]:
        return set(self._answers.keys())

    def _context_for_gemma(self) -> dict[str, Any]:
        """Build a label→value dict of answers already collected."""
        ctx = {}
        for qid, ans in self._answers.items():
            q = schema_manager.get_question(qid)
            if q:
                ctx[q.label] = ans.interpreted_value
        return ctx

    def _next_unanswered_question(self) -> Optional[FormQuestion]:
        """Return the next unanswered question (required first, then optional)."""
        all_qs = schema_manager.all_questions()
        answered = self._answered_ids()

        # Required first
        for q in all_qs:
            if q.id not in answered and q.required:
                return q
        # Then optional
        for q in all_qs:
            if q.id not in answered and not q.required:
                return q
        return None

    # ── Get next question ─────────────────────────────────────────────────────

    async def get_next_question(self) -> Optional[InterviewQuestion]:
        """
        Determine and return the next question to ask.
        Uses Gemma to generate a natural-language version of the form field prompt.
        Returns None when all required questions are answered.
        """
        if not schema_manager.has_schema():
            return None

        form_q = self._next_unanswered_question()
        if form_q is None:
            return None  # Interview complete

        self._current_question_id = form_q.id
        context = self._context_for_gemma()

        try:
            question_text = await gemma.generate_question(
                field_label=form_q.label,
                field_type=form_q.type.value,
                options=form_q.options,
                description=form_q.description,
                context=context,
            )
        except Exception as exc:
            logger.warning("Gemma question generation failed: %s — using label as fallback", exc)
            # Fallback: use the label directly as the question
            question_text = _label_to_question(form_q)

        return InterviewQuestion(
            question_id=form_q.id,
            question_text=question_text,
            hint=form_q.description,
            options=form_q.options,
            field_type=form_q.type.value,
            required=form_q.required,
        )

    # ── Submit answer ─────────────────────────────────────────────────────────

    async def submit_answer(
        self,
        question_id: str,
        raw_answer: str,
        source: AnswerSource = AnswerSource.text,
    ) -> StoredAnswer:
        """
        Process and store a user's answer:
        1. Interpret raw answer via Gemma
        2. Validate against form constraints
        3. Store in answer map
        """
        form_q = schema_manager.get_question(question_id)
        if form_q is None:
            raise ValueError(f"Question '{question_id}' not found in schema.")

        # ── Skip / N/A handling ───────────────────────────────────────────────
        if raw_answer.strip().lower() in ("skip", "n/a", "na", "none", "i don't know", "idk", ""):
            stored = StoredAnswer(
                question_id=question_id,
                raw_answer=raw_answer,
                interpreted_value=None if not form_q.required else raw_answer,
                source=source,
                confidence=AnswerConfidence.high,
                validated=True,
            )
            self._answers[question_id] = stored
            return stored

        # ── Interpret via Gemma ───────────────────────────────────────────────
        try:
            interpreted = await gemma.interpret_answer(
                field_label=form_q.label,
                field_type=form_q.type.value,
                options=form_q.options,
                raw_answer=raw_answer,
            )
        except Exception as exc:
            logger.warning("Gemma interpretation failed: %s — using raw answer", exc)
            interpreted = raw_answer

        # Handle "UNCLEAR" response from Gemma
        if str(interpreted).strip().upper() == "UNCLEAR":
            stored = StoredAnswer(
                question_id=question_id,
                raw_answer=raw_answer,
                interpreted_value=raw_answer,  # Use raw as best effort
                source=source,
                confidence=AnswerConfidence.low,
                validated=False,
                validation_error="Could not clearly interpret this answer.",
            )
            self._answers[question_id] = stored
            return stored

        # ── Structural validation ─────────────────────────────────────────────
        is_valid, error = schema_manager.validate_answer_for_question(form_q, interpreted)

        stored = StoredAnswer(
            question_id=question_id,
            raw_answer=raw_answer,
            interpreted_value=interpreted,
            source=source,
            confidence=AnswerConfidence.high if is_valid else AnswerConfidence.medium,
            validated=is_valid,
            validation_error=error,
        )
        self._answers[question_id] = stored
        return stored

    # ── Edit ──────────────────────────────────────────────────────────────────

    async def edit_answer(self, question_id: str, new_answer: str) -> StoredAnswer:
        """Re-process an answer as if it were freshly submitted."""
        return await self.submit_answer(question_id, new_answer)

    # ── Status ────────────────────────────────────────────────────────────────

    def get_status(self) -> dict:
        total = schema_manager.total_count()
        answered = len(self._answers)
        required_qs = schema_manager.required_questions()
        required_remaining = sum(1 for q in required_qs if q.id not in self._answered_ids())
        optional_remaining = total - answered - required_remaining
        is_complete = required_remaining == 0
        pct = (answered / total * 100) if total > 0 else 0

        return {
            "total_questions": total,
            "answered": answered,
            "required_remaining": required_remaining,
            "optional_remaining": max(0, optional_remaining),
            "is_complete": is_complete,
            "completion_percent": round(pct, 1),
        }

    # ── All answers (for review UI) ───────────────────────────────────────────

    def get_all_answers(self) -> list[dict]:
        result = []
        for q in schema_manager.all_questions():
            ans = self._answers.get(q.id)
            result.append({
                "question_id": q.id,
                "label": q.label,
                "type": q.type.value,
                "required": q.required,
                "options": q.options,
                "answered": ans is not None,
                "value": ans.interpreted_value if ans else None,
                "raw": ans.raw_answer if ans else None,
                "validated": ans.validated if ans else False,
                "error": ans.validation_error if ans else None,
            })
        return result

    # ── Build autofill payload ────────────────────────────────────────────────

    def build_autofill_data(self) -> AutofillData:
        """Convert stored answers to an AutofillData payload for the extension."""
        entries: dict[str, AutofillEntry] = {}
        form_schema = schema_manager.schema

        for qid, ans in self._answers.items():
            q = schema_manager.get_question(qid)
            if q is None or ans.interpreted_value is None:
                continue
            entries[qid] = AutofillEntry(
                value=ans.interpreted_value,
                type=q.type.value,
                index=q.index,
                question_id=qid,
            )

        return AutofillData(
            answers=entries,
            form_title=form_schema.form_title if form_schema else None,
            total_fields=len(self._answers),
            filled_count=len(entries),
        )


# ── Helpers ───────────────────────────────────────────────────────────────────

def _label_to_question(q: FormQuestion) -> str:
    """Convert a form label to a natural question as a Gemma fallback."""
    label = q.label.strip().rstrip("?")
    if q.type in (FieldType.radio, FieldType.dropdown) and q.options:
        opts = ", ".join(q.options)
        return f"What is your {label}? Options: {opts}"
    if q.type == FieldType.checkbox and q.options:
        opts = ", ".join(q.options)
        return f"Which of the following apply to {label}? Options: {opts}"
    return f"Please provide your {label}."


# ── Singleton ─────────────────────────────────────────────────────────────────
interview_engine = InterviewEngine()
