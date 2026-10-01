"""
Support conversations.

One thread per user, because a founder with a problem wants to continue the
conversation they already started, not open a ticket each time. Messages are
plain rows ordered by time; the thread is everything belonging to that user.

Delivery is by polling rather than websockets. The volume here is a handful
of conversations, and a socket layer would add a failure mode (dropped
connections, reconnect logic, a second auth path) for a few seconds of
latency. Both sides poll while their window is open and stop when it isn't.
"""
from datetime import datetime

from sqlalchemy import Boolean, DateTime, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base


class SupportMessageModel(Base):
    __tablename__ = "support_messages"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)

    #: The founder the thread belongs to. Admin replies carry the same id, so
    #: the whole conversation is one query.
    user_id: Mapped[str] = mapped_column(String, nullable=False, index=True)

    #: "user" or "admin". Who typed it, not who it is addressed to.
    sender: Mapped[str] = mapped_column(String, nullable=False, default="user")

    body: Mapped[str] = mapped_column(Text, nullable=False)

    #: Denormalised so the admin thread list can show who wrote without a
    #: join against auth.users on every poll.
    user_email: Mapped[str | None] = mapped_column(String, nullable=True)

    #: Storage path of an uploaded attachment (a screenshot or PDF), relative
    #: to the Supabase Storage bucket, e.g. "support-attachments/<user>/<file>".
    #: Null when the message had no attachment, or the upload failed (which
    #: never blocks saving the message itself).
    attachment_path: Mapped[str | None] = mapped_column(String, nullable=True)

    #: Read receipts, tracked per side so each can show its own unread count.
    read_by_user: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    read_by_admin: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), index=True
    )
