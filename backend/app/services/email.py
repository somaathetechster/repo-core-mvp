"""
Transactional email, sent via Resend.

Sending is best-effort: a failure here must never break the flow that
triggered it (a payment succeeded whether or not the welcome email went out),
so callers get a bool and every path is logged.
"""
from __future__ import annotations

import logging

import httpx

from app.core.config import settings

log = logging.getLogger(__name__)


async def send_welcome_email(user_email: str, plan_name: str) -> bool:
    """
    Sends the post-subscription welcome email. Returns True if the provider
    accepted it, False otherwise. Never raises.
    """
    if not user_email:
        log.info("Welcome email skipped: no recipient address (plan=%s)", plan_name)
        return False

    subject = f"Welcome to Provisio {plan_name} — you're all set"

    api_key = getattr(settings, "email_api_key", "")
    sender = getattr(settings, "email_from", "") or "noreply@provisio.site"

    if not api_key:
        # Not configured yet. Log the attempt so it's visible in the logs that
        # a welcome email *would* have gone out, then no-op.
        log.info(
            "Welcome email not sent (no EMAIL_API_KEY configured): "
            "to=%s plan=%s subject=%r",
            user_email, plan_name, subject,
        )
        return False

    payload = {
        "from": sender,
        "to": [user_email],
        "subject": subject,
        "html": (
            f"<h2>Welcome to Provisio {plan_name}!</h2>"
            "<p>Your plan is now active.</p>"
            "<p><a href='https://www.provisio.site'>Log in to get started</a></p>"
            "<p>— The Provisio team</p>"
        ),
        "text": (
            f"Your {plan_name} plan is now active. "
            "Log in at https://www.provisio.site — The Provisio team"
        ),
    }
    log.info("Sending welcome email via Resend: to=%s plan=%s", user_email, plan_name)
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            res = await client.post(
                "https://api.resend.com/emails",
                json=payload,
                headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
            )
        if res.status_code in (200, 201, 202):
            log.info("Welcome email accepted by Resend: to=%s plan=%s", user_email, plan_name)
            return True
        log.warning(
            "Welcome email rejected by Resend: to=%s plan=%s status=%s body=%s",
            user_email, plan_name, res.status_code, res.text[:500],
        )
        return False
    except Exception:
        log.warning("Welcome email send failed: to=%s plan=%s", user_email, plan_name, exc_info=True)
        return False
