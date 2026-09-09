"""
GitHub OAuth App flow (NOT a personal access token, NOT username/password).

Flow:
  1. Frontend hits GET /auth/github/login -> we redirect to GitHub's consent screen
  2. User approves -> GitHub redirects back to /auth/github/callback with a `code`
  3. We exchange `code` for an access token server-side
  4. We encrypt + store the token, tied to the logged-in user
  5. We redirect the browser back to the frontend, done

Scope requested: `repo` (read access to private repos the user grants).
We ask for the minimum needed — do not request org-wide or admin scopes.
"""
import secrets
import httpx
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import RedirectResponse

from app.core.config import settings
from app.core.crypto import encrypt_token
from app.core.deps import get_current_user_id  # placeholder — wire to your real auth
from app.services import github_store

router = APIRouter(prefix="/auth/github", tags=["github-auth"])

GITHUB_AUTHORIZE_URL = "https://github.com/login/oauth/authorize"
GITHUB_TOKEN_URL = "https://github.com/login/oauth/access_token"

# In-memory state store for CSRF protection on the OAuth redirect.
# Swap for Redis/DB in production (multi-instance deployments need shared state).
_pending_states: dict[str, str] = {}


@router.get("/login")
async def github_login(user_id: str = Depends(get_current_user_id)):
    state = secrets.token_urlsafe(24)
    _pending_states[state] = user_id

    params = {
        "client_id": settings.github_client_id,
        "redirect_uri": settings.github_oauth_redirect_uri,
        "scope": "repo read:user",
        "state": state,
        "allow_signup": "false",
    }
    query = "&".join(f"{k}={v}" for k, v in params.items())
    return RedirectResponse(f"{GITHUB_AUTHORIZE_URL}?{query}")


@router.get("/callback")
async def github_callback(code: str, state: str):
    user_id = _pending_states.pop(state, None)
    if not user_id:
        raise HTTPException(status_code=400, detail="Invalid or expired OAuth state.")

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

    encrypted = encrypt_token(access_token)
    await github_store.save_user_token(user_id=user_id, encrypted_token=encrypted)

    return RedirectResponse(f"{settings.frontend_url}/connect/github?status=success")


@router.delete("/disconnect")
async def github_disconnect(user_id: str = Depends(get_current_user_id)):
    await github_store.delete_user_token(user_id)
    return {"status": "disconnected"}
