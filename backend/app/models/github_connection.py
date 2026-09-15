"""
Persisted GitHub App connection, one row per user, tying their Supabase
user id to an encrypted GitHub token + which installation (repo selection)
they granted.

Also stores an encrypted refresh token and the access token's expiry.
GitHub App user access tokens expire (8 hours, when "Expire user
authorization tokens" is on, which is the default for GitHub Apps created
after a certain date and not always toggleable off). Without refreshing,
every connection silently breaks after 8 hours. See github_extract.py's
get_valid_access_token for the refresh logic that uses these fields.
"""
from datetime import datetime, timezone
from sqlalchemy import String, DateTime
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base


class GithubConnectionModel(Base):
    __tablename__ = "github_connections"

    user_id: Mapped[str] = mapped_column(String, primary_key=True)
    encrypted_token: Mapped[str] = mapped_column(String, nullable=False)
    encrypted_refresh_token: Mapped[str] = mapped_column(String, default="")
    token_expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    installation_id: Mapped[str] = mapped_column(String, nullable=False)
    connected_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
