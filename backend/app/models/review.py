"""
Persisted deck-review finding actions.

The review itself is computed client-side (see frontend/src/deck/review.ts), so
the backend never sees the findings — it only records which ones a user has
marked Done or Ignored, keyed by the finding's stable id. One row per
(user, deck, finding); re-acting on the same finding updates the row rather
than piling up duplicates.
"""
from datetime import datetime

from sqlalchemy import DateTime, String, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base


class ReviewFindingAction(Base):
    __tablename__ = "review_finding_actions"
    __table_args__ = (
        UniqueConstraint("user_id", "deck_id", "finding_id", name="uq_review_action_user_deck_finding"),
    )

    id: Mapped[str] = mapped_column(String, primary_key=True)

    #: The user who acted. A plain string (the Supabase auth user id), matching
    #: every other table here — auth.users lives in Supabase, not locally.
    user_id: Mapped[str] = mapped_column(String, nullable=False, index=True)

    #: The deck the finding belongs to.
    deck_id: Mapped[str] = mapped_column(String, nullable=False, index=True)

    #: The finding's stable identifier within the review (e.g. "no-numbers-2").
    finding_id: Mapped[str] = mapped_column(String, nullable=False)

    #: "done" or "ignored".
    action: Mapped[str] = mapped_column(String, nullable=False)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
