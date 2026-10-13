"""
Slide comments.

A comment is a note left by the deck owner or a collaborator against one
slide of a deck. Comments are addressed by the slide's own ``id`` field
(the same id the editor uses), not by index, so reordering slides never
re-points a comment at the wrong slide.

Resolving a comment hides it from the default view rather than deleting it,
so a thread of feedback can be worked through and then tucked away.

Like data_records and collaborators, a deck can have many comments, so the
primary key is a generated id with deck_id / slide_id as plain indexed
columns.
"""
import uuid
from datetime import datetime, timezone

from sqlalchemy import String, Text, Boolean, DateTime
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base


def _new_id() -> str:
    return uuid.uuid4().hex


class SlideCommentModel(Base):
    __tablename__ = "slide_comments"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=_new_id)

    #: The deck this comment belongs to (DeckModel.id).
    deck_id: Mapped[str] = mapped_column(String, index=True, nullable=False)

    #: The slide's own id field (not its position), so the comment survives
    #: slide reordering.
    slide_id: Mapped[str] = mapped_column(String, index=True, nullable=False)

    #: The author's Supabase user_id.
    user_id: Mapped[str] = mapped_column(String, index=True, nullable=False)

    content: Mapped[str] = mapped_column(Text, nullable=False)

    #: Resolved comments are hidden from the default view.
    resolved: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
    )
