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

    subject = "Welcome to Provisio — you're all set"

    api_key = getattr(settings, "email_api_key", "")
    sender = getattr(settings, "email_from", "") or "noreply@provisio.site"
    frontend_url = settings.frontend_url.rstrip("/")

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
            "<!DOCTYPE html>"
            "<html>"
            "<head><meta charset=\"utf-8\"><meta name=\"viewport\" "
            "content=\"width=device-width\"></head>"
            "<body style=\"margin:0;padding:0;background:#0a0a0a;"
            "font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',"
            "sans-serif;\">"
            "  <table width=\"100%\" cellpadding=\"0\" cellspacing=\"0\""
            "         style=\"background:#0a0a0a;padding:40px 20px;\">"
            "    <tr><td align=\"center\">"
            "      <table width=\"560\" cellpadding=\"0\" cellspacing=\"0\""
            "             style=\"background:#111;border-radius:12px;"
            "                    border:1px solid #222;overflow:hidden;\">"
            "        <tr>"
            "          <td style=\"padding:32px 40px 24px;"
            "                     border-bottom:1px solid #222;\">"
            "            <span style=\"color:#fff;font-size:20px;"
            "                         font-weight:700;"
            "                         letter-spacing:-0.02em;\">"
            "              Provisio</span>"
            "            <span style=\"color:#666;font-size:13px;"
            "                         margin-left:8px;\">by Domani</span>"
            "          </td>"
            "        </tr>"
            "        <tr>"
            "          <td style=\"padding:40px 40px 32px;\">"
            "            <p style=\"margin:0 0 8px;color:#999;"
            "                      font-size:13px;"
            "                      text-transform:uppercase;"
            "                      letter-spacing:0.06em;\">"
            "              You're in</p>"
            "            <h1 style=\"margin:0 0 16px;color:#fff;"
            "                       font-size:26px;font-weight:700;"
            "                       line-height:1.2;"
            "                       letter-spacing:-0.02em;\">"
            f"              Welcome to Provisio {plan_name}</h1>"
            "            <p style=\"margin:0 0 32px;color:#888;"
            "                      font-size:15px;line-height:1.6;\">"
            "              Your account is active. Start building "
            "              your pitch deck — your evidence, your "
            "              story, your raise."
            "            </p>"
            "            <table cellpadding=\"0\" cellspacing=\"0\">"
            "              <tr>"
            "                <td style=\"background:#d4a017;"
            "                           border-radius:8px;\">"
            f"                  <a href=\"{frontend_url}/home\""
            "                     style=\"display:block;"
            "                            padding:14px 32px;"
            "                            color:#000;font-size:15px;"
            "                            font-weight:700;"
            "                            text-decoration:none;"
            "                            letter-spacing:-0.01em;\">"
            "                    Go to Provisio &rarr;"
            "                  </a>"
            "                </td>"
            "              </tr>"
            "            </table>"
            "          </td>"
            "        </tr>"
            "        <tr>"
            "          <td style=\"padding:20px 40px;"
            "                     border-top:1px solid #1a1a1a;\">"
            "            <p style=\"margin:0;color:#444;"
            "                      font-size:12px;\">"
            f"              You're receiving this because you "
            f"subscribed to Provisio {plan_name}. "
            "              Questions? Reply to this email."
            "            </p>"
            "          </td>"
            "        </tr>"
            "      </table>"
            "    </td></tr>"
            "  </table>"
            "</body>"
            "</html>"
        ),
        "text": (
            f"Welcome to Provisio {plan_name}. Your account is "
            f"active. Go to Provisio: {frontend_url}/home"
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
