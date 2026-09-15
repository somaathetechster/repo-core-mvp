"""
Real persistence for GitHub App connections, backed by Postgres. Also
handles refreshing an expired access token using the stored refresh token,
so callers always get back a usable token without needing to know whether
a refresh happened.
"""
from dataclasses import dataclass
from datetime import datetime, timezone, timedelta
import httpx
from sqlalchemy import select

from app.core.crypto import decrypt_token, encrypt_token
from app.core.config import settings
from app.core.db import AsyncSessionLocal
from app.models.github_connection import GithubConnectionModel

GITHUB_TOKEN_URL = "https://github.com/login/oauth/access_token"

# Refresh a bit before actual expiry, so a request never races an
# almost-expired token.
_REFRESH_MARGIN = timedelta(minutes=5)


@dataclass
class GithubConnection:
    access_token: str
    installation_id: str


async def save_user_connection(
    user_id: str,
    encrypted_token: str,
    installation_id: str,
    encrypted_refresh_token: str = "",
    token_expires_at: datetime | None = None,
) -> None:
    async with AsyncSessionLocal() as session:
        existing = await session.get(GithubConnectionModel, user_id)
        if existing:
            existing.encrypted_token = encrypted_token
            existing.installation_id = installation_id
            existing.encrypted_refresh_token = encrypted_refresh_token
            existing.token_expires_at = token_expires_at
        else:
            session.add(GithubConnectionModel(
                user_id=user_id,
                encrypted_token=encrypted_token,
                installation_id=installation_id,
                encrypted_refresh_token=encrypted_refresh_token,
                token_expires_at=token_expires_at,
            ))
        await session.commit()


async def get_user_connection(user_id: str) -> GithubConnection | None:
    """
    Returns a connection with a guaranteed-valid access token, refreshing
    and persisting a new one first if the stored token is expired or close
    to it. Returns None if there's no connection at all, or if a refresh
    is needed but fails (e.g. the user revoked access on GitHub's side).
    """
    async with AsyncSessionLocal() as session:
        result = await session.execute(
            select(GithubConnectionModel).where(GithubConnectionModel.user_id == user_id)
        )
        row = result.scalar_one_or_none()
        if not row:
            return None

        needs_refresh = (
            row.token_expires_at is not None
            and row.token_expires_at - _REFRESH_MARGIN <= datetime.now(timezone.utc)
        )

        if not needs_refresh:
            return GithubConnection(access_token=decrypt_token(row.encrypted_token), installation_id=row.installation_id)

        if not row.encrypted_refresh_token:
            # Token is expired and we have no way to refresh it (e.g. an
            # older connection made before refresh tokens were stored).
            return None

        refresh_token = decrypt_token(row.encrypted_refresh_token)
        async with httpx.AsyncClient() as client:
            resp = await client.post(
                GITHUB_TOKEN_URL,
                headers={"Accept": "application/json"},
                data={
                    "client_id": settings.github_client_id,
                    "client_secret": settings.github_client_secret,
                    "grant_type": "refresh_token",
                    "refresh_token": refresh_token,
                },
            )
        payload = resp.json()
        new_access_token = payload.get("access_token")
        if not new_access_token:
            # Refresh failed, most likely the refresh token itself expired
            # (GitHub's refresh tokens are valid for 6 months) or access
            # was revoked. The user needs to reconnect.
            return None

        new_refresh_token = payload.get("refresh_token", refresh_token)
        expires_in = payload.get("expires_in")
        new_expires_at = (
            datetime.now(timezone.utc) + timedelta(seconds=expires_in) if expires_in else None
        )

        row.encrypted_token = encrypt_token(new_access_token)
        row.encrypted_refresh_token = encrypt_token(new_refresh_token)
        row.token_expires_at = new_expires_at
        await session.commit()

        return GithubConnection(access_token=new_access_token, installation_id=row.installation_id)


async def delete_user_connection(user_id: str) -> None:
    async with AsyncSessionLocal() as session:
        existing = await session.get(GithubConnectionModel, user_id)
        if existing:
            await session.delete(existing)
            await session.commit()
