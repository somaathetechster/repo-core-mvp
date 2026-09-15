"""
Persisted deck state: the slides (including any edits, reordering, or
deletions the founder made), the theme, and any freeform layout positions.
One deck per user for now, same simplification as company_profiles.

This is separate from /deck/generate, which always builds a fresh deck
from the current company profile and repo evidence. Saving is an explicit
action so a founder's manual edits (reordering, rewording, freeform
positioning) aren't silently lost or overwritten by regeneration.
"""
from datetime import datetime, timezone
from sqlalchemy import String, JSON, DateTime
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base


class SavedDeckModel(Base):
    __tablename__ = "saved_decks"

    user_id: Mapped[str] = mapped_column(String, primary_key=True)
    slides: Mapped[list] = mapped_column(JSON, default=list)
    theme: Mapped[dict] = mapped_column(JSON, default=dict)
    layouts: Mapped[dict] = mapped_column(JSON, default=dict)  # slide_id -> list of LayoutElement dicts
    freeform_slide_ids: Mapped[list] = mapped_column(JSON, default=list)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
    )
