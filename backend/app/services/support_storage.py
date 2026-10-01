"""
Uploads support attachments to Supabase Storage.

Talks to the Storage REST API directly with httpx rather than pulling in the
`supabase` SDK: httpx is already a dependency, the service-role key is already
configured, and this keeps the attachment path out of the request thread's
critical path. Every failure here is swallowed and logged — a support message
must still be saved even when its screenshot can't be stored.
"""
import logging
import re
import uuid
from datetime import datetime, timezone

import httpx

from app.core.config import settings

log = logging.getLogger(__name__)

#: Private bucket for support screenshots/PDFs.
SUPPORT_BUCKET = "support-attachments"


def _safe_name(name: str) -> str:
    base = (name or "file").strip().replace("\\", "/").split("/")[-1]
    cleaned = re.sub(r"[^A-Za-z0-9._-]", "_", base)
    return cleaned[:120] or "file"


async def _ensure_bucket(client: httpx.AsyncClient, base: str, key: str) -> None:
    """Create the private bucket if it doesn't exist. Existing is not an error."""
    resp = await client.post(
        f"{base}/storage/v1/bucket",
        headers={"Authorization": f"Bearer {key}", "apikey": key, "Content-Type": "application/json"},
        json={"id": SUPPORT_BUCKET, "name": SUPPORT_BUCKET, "public": False},
    )
    # 409/400 is the usual "already exists" response; only warn on anything else.
    if resp.status_code not in (200, 201, 400, 409):
        log.warning("Support bucket create returned %s: %s", resp.status_code, resp.text[:200])


async def upload_support_attachment(
    user_id: str, filename: str, content_type: str, data: bytes
) -> str | None:
    """
    Uploads `data` to the private support bucket and returns its storage path,
    or None if storage isn't configured or the upload fails.
    """
    base = (settings.supabase_url or "").rstrip("/")
    key = settings.supabase_service_role_key or ""
    if not base or not key:
        log.warning("Supabase storage not configured; skipping support attachment upload.")
        return None

    stamp = datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S")
    object_path = f"{user_id}/{stamp}-{uuid.uuid4().hex[:8]}-{_safe_name(filename)}"
    try:
        async with httpx.AsyncClient(timeout=20) as client:
            await _ensure_bucket(client, base, key)
            resp = await client.post(
                f"{base}/storage/v1/object/{SUPPORT_BUCKET}/{object_path}",
                headers={
                    "Authorization": f"Bearer {key}",
                    "apikey": key,
                    "Content-Type": content_type or "application/octet-stream",
                    "x-upsert": "true",
                },
                content=data,
            )
            if resp.status_code not in (200, 201):
                log.error("Support attachment upload failed %s: %s", resp.status_code, resp.text[:300])
                return None
    except Exception as exc:  # network error, DNS, timeout, etc.
        log.error("Support attachment upload error: %r", exc)
        return None

    return f"{SUPPORT_BUCKET}/{object_path}"
