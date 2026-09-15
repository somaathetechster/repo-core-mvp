"""
Server-side check for whether a user has a verified MFA (TOTP) factor
enrolled. This is what lets the backend actually enforce 2FA, rather than
trusting the frontend to gate on it.

Why this needs the Admin API: a JWT's `aal` claim tells us the CURRENT
assurance level of this specific token, but not whether a stronger level is
REQUIRED for this account. A user with no MFA enrolled is always aal1, and
that's correct. A user who enrolled MFA but is presenting a password-only
token is also aal1, but that should be rejected. The JWT alone can't tell
these apart; only Supabase's own record of the user's enrolled factors can.

Results are cached briefly in memory to avoid a network round-trip to
Supabase on every single request. This means a factor enrolled or removed
in the last MFA_CHECK_CACHE_SECONDS may not be reflected immediately, which
is an acceptable tradeoff for request latency.
"""
import time
import httpx
from app.core.config import settings

MFA_CHECK_CACHE_SECONDS = 30

_cache: dict[str, tuple[bool, float]] = {}  # user_id -> (has_verified_totp, checked_at)


async def user_has_verified_totp(user_id: str) -> bool:
    cached = _cache.get(user_id)
    if cached and (time.time() - cached[1]) < MFA_CHECK_CACHE_SECONDS:
        return cached[0]

    if not settings.supabase_url or not settings.supabase_service_role_key:
        # Misconfigured server. Fail closed: treat as if MFA is required but
        # unverifiable, which blocks access rather than silently skipping
        # the check. Fix by setting SUPABASE_SERVICE_ROLE_KEY.
        raise RuntimeError("SUPABASE_SERVICE_ROLE_KEY or SUPABASE_URL is not configured.")

    async with httpx.AsyncClient() as client:
        resp = await client.get(
            f"{settings.supabase_url}/auth/v1/admin/users/{user_id}",
            headers={
                "apikey": settings.supabase_service_role_key,
                "Authorization": f"Bearer {settings.supabase_service_role_key}",
            },
            timeout=10,
        )
        resp.raise_for_status()
        user_data = resp.json()

    factors = user_data.get("factors", []) or []
    has_verified = any(f.get("factor_type") == "totp" and f.get("status") == "verified" for f in factors)

    _cache[user_id] = (has_verified, time.time())
    return has_verified
