"""
A single deck owned by a user. Unlike company_profiles (one shared source
of truth per user), a user can have many decks, each potentially built
from a different snapshot of their company profile and a different set of
repos, e.g. one deck tailored for an accelerator application and another
for a specific investor.

profile_snapshot is a full copy of the company profile fields at the point
this deck was created (or last edited independently). It starts as either
a copy of the shared /company-profile at creation time, or blank, and from
then on is edited independently per-deck; editing it here never writes
back to the shared company_profiles table.
"""
import uuid
from datetime import datetime, timezone
from sqlalchemy import String, JSON, DateTime
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base


def _new_id() -> str:
    return uuid.uuid4().hex


class DeckModel(Base):
    __tablename__ = "decks"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=_new_id)
    user_id: Mapped[str] = mapped_column(String, index=True)
    name: Mapped[str] = mapped_column(String, default="Untitled deck")

    profile_snapshot: Mapped[dict] = mapped_column(JSON, default=dict)
    repo_full_names: Mapped[list] = mapped_column(JSON, default=list)

    slides: Mapped[list] = mapped_column(JSON, default=list)
    theme: Mapped[dict] = mapped_column(JSON, default=dict)
    layouts: Mapped[dict] = mapped_column(JSON, default=dict)
    freeform_slide_ids: Mapped[list] = mapped_column(JSON, default=list)

    # The strategic Brief (Planner) plus the Critic read and any applied
    # structure override — the deck's "intelligence" layer. Nullable so older
    # decks and the deterministic build path simply carry None. Auto-migrated
    # on boot by _add_missing_columns.
    brief: Mapped[dict | None] = mapped_column(JSON, nullable=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
    )
