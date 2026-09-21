"""
Verifies the Supabase-issued JWT sent on every request as:
    Authorization: Bearer <token>

Supabase projects created (or migrated) after their JWT Signing Keys rollout
sign tokens asymmetrically (ES256), not with a shared HS256 secret. We verify
against Supabase's public JWKS endpoint instead, no shared secret needed,
and this works whether the project uses the legacy or new signing method.

The JWKS (public keys) are fetched once and cached in memory for the life of
the process. They rotate rarely, so this is safe; restart the server if you
ever rotate signing keys and hit unexpected 401s.

After signature verification, we also enforce 2FA server-side: if the
account has a verified TOTP factor enrolled, the token must show aal2 (both
factors completed), not just aal1 (password only). This is what actually
closes the 2FA requirement, since a client could otherwise skip the second
factor entirely and call the API with a password-only token. See
mfa_check.py for why this needs a server-side lookup rather than just
reading the token's own aal claim.
"""
import httpx
from fastapi import Header, HTTPException, Query
from jose import jwt, JWTError

from app.core.config import settings
from app.core.mfa_check import user_has_verified_totp

_jwks_cache: dict | None = None


def _get_jwks() -> dict:
    global _jwks_cache
    if _jwks_cache is None:
        if not settings.supabase_url:
            raise HTTPException(status_code=500, detail="SUPABASE_URL is not configured on the server.")
        jwks_url = f"{settings.supabase_url}/auth/v1/.well-known/jwks.json"
        resp = httpx.get(jwks_url, timeout=10)
        resp.raise_for_status()
        _jwks_cache = resp.json()
    return _jwks_cache


async def _verify(token: str) -> str:
    try:
        unverified_header = jwt.get_unverified_header(token)
    except JWTError as e:
        raise HTTPException(status_code=401, detail=f"Malformed token: {e}")

    kid = unverified_header.get("kid")
    alg = unverified_header.get("alg", "ES256")

    jwks = _get_jwks()
    matching_key = next((k for k in jwks.get("keys", []) if k.get("kid") == kid), None)

    if not matching_key:
        # Key not found, could be a real rotation, so refresh once and retry
        # before giving up, rather than caching a stale keyset forever.
        global _jwks_cache
        _jwks_cache = None
        jwks = _get_jwks()
        matching_key = next((k for k in jwks.get("keys", []) if k.get("kid") == kid), None)
        if not matching_key:
            raise HTTPException(status_code=401, detail="Token signed with an unrecognized key.")

    try:
        payload = jwt.decode(
            token,
            matching_key,
            algorithms=[alg],
            audience="authenticated",  # Supabase's default audience claim
        )
    except JWTError as e:
        raise HTTPException(status_code=401, detail=f"Invalid or expired token: {e}")

    user_id = payload.get("sub")
    if not user_id:
        raise HTTPException(status_code=401, detail="Token missing subject claim.")

    # Enforce 2FA server-side. A token's own "aal" claim reflects what level
    # THIS token reached, not what level this account requires, so we check
    # the account's actual enrolled factors via the Admin API.
    aal = payload.get("aal", "aal1")
    try:
        requires_mfa = await user_has_verified_totp(user_id)
    except (httpx.HTTPError, RuntimeError) as e:
        # Fail closed: if we can't determine MFA status, don't grant access
        # on the assumption that it's not required.
        raise HTTPException(status_code=503, detail=f"Could not verify account security status: {e}")

    if requires_mfa and aal != "aal2":
        raise HTTPException(status_code=401, detail="Second factor required for this account.")

    return user_id


async def get_current_user_id(authorization: str = Header(...)) -> str:
    """Standard path: token in the Authorization header. Used by nearly every route."""
    if not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing or malformed Authorization header.")
    return await _verify(authorization.removeprefix("Bearer ").strip())


async def get_current_user_id_from_query(access_token: str = Query(...)) -> str:
    """
    Only for the GitHub OAuth redirect entry point (/auth/github/login), because a
    plain browser navigation (<a href> / window.location) can't attach a header.
    Everywhere else in the app must use get_current_user_id (header-based) instead,
    a token sitting in a URL is more exposure-prone (browser history, server logs,
    Referer headers) than one in a header, so this path should stay a narrow exception.
    """
    return await _verify(access_token)


async def get_current_user_id_optional(authorization: str = Header(default="")) -> str | None:
    """Like get_current_user_id but returns None instead of raising if missing."""
    if not authorization:
        return None
    try:
        return await get_current_user_id(authorization)
    except Exception:
        return None
