"""
An AI-generated business document owned by a user (Provisio Docs).

Unlike the company profile (one shared source of truth per user), a user can
have many documents, each of a given ``doc_type`` (proposal, business plan,
investment memo, …). ``content`` holds the document body as a list of sections,
each with a heading and a prose body; ``letterhead`` optionally overrides the
header applied to every exported page, and when null the company profile's
brand fields are used instead.

Images (a letterhead logo) are kept as base64 data URLs inline, the same
pragmatic approach taken by DeckModel / CompanyProfileModel — see their
docstrings for why, and when to migrate to object storage.
"""
import uuid
from datetime import datetime, timezone
from sqlalchemy import String, JSON, DateTime
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base


def _new_id() -> str:
    return uuid.uuid4().hex


class DocumentModel(Base):
    __tablename__ = "documents"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=_new_id)
    user_id: Mapped[str] = mapped_column(String, index=True)
    title: Mapped[str] = mapped_column(String, default="Untitled Document")

    # proposal / business_plan / investment_memo / pitch_summary / report / general
    doc_type: Mapped[str] = mapped_column(String, default="general")

    # The document body: {"sections": [{"heading": str, "body": str}, ...]}.
    content: Mapped[dict] = mapped_column(JSON, default=dict)

    # Letterhead override: {logo_url, company_name, address, tagline,
    # primary_color}. Null means "fall back to the company profile's brand".
    letterhead: Mapped[dict | None] = mapped_column(JSON, nullable=True)

    # draft (blank) / generated (AI-written) / final (user marked done)
    status: Mapped[str] = mapped_column(String, default="draft")

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
    )
