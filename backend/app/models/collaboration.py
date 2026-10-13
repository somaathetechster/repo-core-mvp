"""
Workspace collaboration.

A workspace is simply an account (a Supabase user) that has invited other
people to work inside it. There is no separate "workspace" row: the owner's
user_id *is* the workspace id. Each invitation is one CollaboratorModel row
linking an owner to an invitee, with a role and a status.

Roles, weakest to strongest:
    viewer      can view and export decks
    commenter   can view and leave comments
    editor      can edit deck content
    manager     can create, edit, delete decks
    admin       full access except account settings

The owner themselves is never stored as a collaborator row — ownership is
implied by being the owner_id — so the owner can never be removed or have
their role changed, which the endpoints enforce.

Status lifecycle:
    pending   invite sent, not yet accepted
    accepted  invitee joined; invitee_user_id is set
    revoked   invite withdrawn, or member removed

Like data_records, a user can have many of these, so the primary key is a
generated id and owner_id is a plain indexed column.
"""
import uuid
from datetime import datetime, timezone

from sqlalchemy import String, DateTime
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base


def _new_id() -> str:
    # The codebase uses uuid4().hex as its collision-resistant id everywhere
    # (see data_records); keeping the same shape here rather than adding a
    # cuid dependency for one table.
    return uuid.uuid4().hex


# Allowed roles, ordered weakest to strongest. Kept here so both the model's
# docstring and the router validate against one source of truth.
ROLES: tuple[str, ...] = ("viewer", "commenter", "editor", "manager", "admin")

# Allowed statuses.
STATUSES: tuple[str, ...] = ("pending", "accepted", "revoked")


class CollaboratorModel(Base):
    __tablename__ = "collaborators"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=_new_id)

    #: The account being shared — the owner's Supabase user_id, i.e. the
    #: workspace this invite belongs to.
    owner_id: Mapped[str] = mapped_column(String, index=True, nullable=False)

    #: Who was invited, by email. Lower-cased by the router before storing so
    #: lookups are case-insensitive.
    invitee_email: Mapped[str] = mapped_column(String, index=True, nullable=False)

    #: The invitee's Supabase user_id. Null until the invite is accepted,
    #: because at invite time the person may not even have an account yet.
    invitee_user_id: Mapped[str | None] = mapped_column(String, index=True, nullable=True)

    #: One of ROLES.
    role: Mapped[str] = mapped_column(String, nullable=False, default="viewer")

    #: One of STATUSES.
    status: Mapped[str] = mapped_column(String, nullable=False, default="pending", index=True)

    #: Secure random token used in the invite link ({FRONTEND_URL}/invite/{token}).
    #: Unique so a token resolves to exactly one invite.
    invite_token: Mapped[str] = mapped_column(String, unique=True, index=True, nullable=False)

    invited_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
    accepted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
