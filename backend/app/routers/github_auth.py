"""
GitHub App install flow (NOT an OAuth App — this is what lets the user pick
specific repos instead of granting blanket access to everything).

Flow:
  1. Frontend hits GET /auth/github/install -> we redirect to GitHub's
     installation picker (github.com/apps/<slug>/installations/new), where
     the user chooses "All repositories" or specific ones.
  2. After install + authorization, GitHub redirects to our callback with
     `code` (OAuth code, identifies the user), `installation_id` (which
     installation — i.e. which repo selection — was created), and `state`
     (our CSRF token).
  3. We exchange `code` for a user access token (same token endpoint as a
     regular OAuth App, just using the GitHub App's client id/secret).
  4. We store the encrypted token + installation_id together.
  5. Repo listing/analysis later uses this token against
     /user/installations/{installation_id}/repositories, which only
     returns the repos the user actually granted — nothing more.
"""
import secrets
from datetime import datetime, timezone, timedelta
import httpx
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import RedirectResponse

from app.core.config import settings
from app.core.crypto import encrypt_token
from app.core.deps import get_current_user_id, get_current_user_id_from_query
from app.services import github_store

router = APIRouter(prefix="/auth/github", tags=["github-auth"])

GITHUB_INSTALL_URL_TEMPLATE = "https://github.com/apps/{slug}/installations/new"
GITHUB_TOKEN_URL = "https://github.com/login/oauth/access_token"

# In-memory state store for CSRF protection on the install redirect.
# Swap for Redis/DB in production (multi-instance deployments need shared state).
_pending_states: dict[str, str] = {}


@router.get("/install")
async def github_install(user_id: str = Depends(get_current_user_id_from_query)):
    state = secrets.token_urlsafe(24)
    _pending_states[state] = user_id

    install_url = GITHUB_INSTALL_URL_TEMPLATE.format(slug=settings.github_app_slug)
    return RedirectResponse(f"{install_url}?state={state}")


@router.get("/callback")
async def github_callback(code: str, installation_id: str, state: str, setup_action: str | None = None):
    user_id = _pending_states.pop(state, None)
    if not user_id:
        raise HTTPException(status_code=400, detail="Invalid or expired state.")

    async with httpx.AsyncClient() as client:
        resp = await client.post(
            GITHUB_TOKEN_URL,
            headers={"Accept": "application/json"},
            data={
                "client_id": settings.github_client_id,
                "client_secret": settings.github_client_secret,
                "code": code,
                "redirect_uri": settings.github_oauth_redirect_uri,
            },
        )
        resp.raise_for_status()
        payload = resp.json()

    access_token = payload.get("access_token")
    if not access_token:
        raise HTTPException(status_code=400, detail=f"GitHub token exchange failed: {payload}")

    # GitHub includes a refresh_token and expires_in only when the app has
    # "Expire user authorization tokens" enabled. Store them if present so
    # github_store can refresh automatically once the access token expires,
    # instead of silently breaking after 8 hours.
    refresh_token = payload.get("refresh_token", "")
    expires_in = payload.get("expires_in")
    expires_at = datetime.now(timezone.utc) + timedelta(seconds=expires_in) if expires_in else None

    await github_store.save_user_connection(
        user_id=user_id,
        encrypted_token=encrypt_token(access_token),
        installation_id=installation_id,
        encrypted_refresh_token=encrypt_token(refresh_token) if refresh_token else "",
        token_expires_at=expires_at,
    )

    return RedirectResponse(f"{settings.frontend_url}/connect/github?status=success")


@router.delete("/disconnect")
async def github_disconnect(user_id: str = Depends(get_current_user_id)):
    await github_store.delete_user_connection(user_id)
    return {"status": "disconnected"}
