"""
Bachs payment integration for Provisio.

Architecture
------------
The backend creates a Bachs checkout session for a Provisio plan and
returns the URL. The frontend redirects the user to it. The user pays
on Bachs' hosted page. Bachs fires a webhook. The webhook is the only
place fulfilment happens — never a client-side redirect.

Plans
-----
  single   $10  one-time   one export credit
  monthly  $30  recurring  unlimited exports, monthly
  yearly   $99  recurring  unlimited exports, annual

Product IDs are created once in the Bachs dashboard (or on first boot)
and stored in env vars. The integration is idempotent: duplicate webhook
events are silently ignored because a SubscriptionModel row with the
same user + provider already exists.
"""
from __future__ import annotations

import hashlib
import hmac
import json
import logging
import os
import uuid
from datetime import datetime, timezone

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request, Response
from jose import jwt as jose_jwt
from pydantic import BaseModel
from sqlalchemy import select

from app.core.db import AsyncSessionLocal
from app.core.deps import get_current_user_id
from app.models.billing import (
    SubscriptionModel, UsageModel, UserFlagsModel, PLANS, PlanId, period_end_for,
)

log = logging.getLogger(__name__)

router = APIRouter(tags=["payments"])

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

BACHS_BASE = "https://api.bachs.io"
BACHS_SECRET = os.getenv("BACHS_SECRET_KEY", "")
BACHS_WEBHOOK_SECRET = os.getenv("BACHS_WEBHOOK_SECRET", "")

PRODUCT_IDS: dict[str, str] = {
    "single":  os.getenv("BACHS_PRODUCT_SINGLE", ""),
    "monthly": os.getenv("BACHS_PRODUCT_MONTHLY", ""),
    "yearly":  os.getenv("BACHS_PRODUCT_YEARLY", ""),
}

PLAN_DETAILS = {
    "single":  {"name": "Single export",  "price": "10.00", "currency": "USD", "interval": None},
    "monthly": {"name": "Monthly plan",   "price": "30.00", "currency": "USD", "interval": "month"},
    "yearly":  {"name": "Yearly plan",    "price": "99.00", "currency": "USD", "interval": "year"},
}

FRONTEND_URL = os.getenv("FRONTEND_URL", "https://www.provisio.site")


def _headers() -> dict[str, str]:
    return {
        "Authorization": f"Bearer {BACHS_SECRET}",
        "Content-Type": "application/json",
        "Accept": "application/json",
    }


def _email_from_request(request: Request) -> str | None:
    """
    Pulls the user's email directly from the JWT claims — no DB lookup.
    Supabase always embeds the email as the 'email' claim. We skip
    re-verification since get_current_user_id already verified the token.
    """
    try:
        auth = request.headers.get("Authorization", "")
        token = auth.removeprefix("Bearer ").strip()
        if not token:
            return None
        claims = jose_jwt.get_unverified_claims(token)
        return claims.get("email") or None
    except Exception as exc:
        log.warning("Could not extract email from JWT claims: %s", exc)
        return None


# ---------------------------------------------------------------------------
# Checkout creation
# ---------------------------------------------------------------------------

class CheckoutRequest(BaseModel):
    plan_id: str


@router.post("/checkout/create")
async def create_checkout(
    body: CheckoutRequest,
    request: Request,
    user_id: str = Depends(get_current_user_id),
):
    """
    Creates a Bachs checkout session and returns the URL to redirect to.

    We pass the user's email inside the `customer` object so Bachs creates
    or matches a real (non-guest) durable customer record. This is required
    for recurring plans. Fulfilment happens via webhook only.
    """
    plan = PLAN_DETAILS.get(body.plan_id)
    if not plan:
        raise HTTPException(status_code=400, detail=f"Unknown plan '{body.plan_id}'")

    product_id = PRODUCT_IDS.get(body.plan_id)
    if not product_id:
        log.error(
            "BACHS_PRODUCT_%s env var is not set — cannot create checkout for plan '%s'",
            body.plan_id.upper(), body.plan_id,
        )
        raise HTTPException(
            status_code=503,
            detail=f"Product for plan '{body.plan_id}' is not configured yet.",
        )

    # Pull email from JWT first (no DB hit). Fall back to UserFlagsModel.
    user_email = _email_from_request(request)
    if not user_email:
        async with AsyncSessionLocal() as session:
            flags = await session.get(UserFlagsModel, user_id)
        user_email = (flags.email if flags else None) or ""
        log.debug("Email not in JWT claims, fell back to UserFlagsModel: %r", user_email)

    if not user_email:
        log.error("No email found for user %s — cannot create a durable Bachs customer", user_id)
        raise HTTPException(
            status_code=400,
            detail="Your account email could not be resolved. Please contact support.",
        )

    # Per Bachs docs: pass customer as an object with email so Bachs creates
    # or matches a real customer record. A customer object is required for
    # recurring (subscription) checkouts.
    payload = {
        "customer": {"email": user_email},
        "product_cart": [{"product_id": product_id, "quantity": 1}],
        "success_url": f"{FRONTEND_URL}?checkout=success&plan={body.plan_id}",
        "cancel_url":  f"{FRONTEND_URL}?checkout=cancelled",
        "metadata": {"user_id": user_id, "plan_id": body.plan_id},
    }

    log.info(
        "Creating Bachs checkout session — user=%s plan=%s product=%s email=%s",
        user_id, body.plan_id, product_id, user_email,
    )

    async with httpx.AsyncClient(timeout=15) as client:
        res = await client.post(
            f"{BACHS_BASE}/v1/checkout-sessions",
            json=payload,
            headers=_headers(),
        )

    log.info(
        "Bachs checkout-sessions response — status=%s body=%s",
        res.status_code, res.text[:1000],
    )

    if res.status_code not in (200, 201):
        log.error("Bachs checkout error %s: %s", res.status_code, res.text[:500])
        raise HTTPException(status_code=502, detail="Payment provider error. Please try again.")

    data = res.json()
    url = data.get("url") or data.get("checkout_url") or (data.get("data") or {}).get("url")
    if not url:
        log.error("No URL in Bachs checkout response: %s", data)
        raise HTTPException(
            status_code=502,
            detail="Could not get checkout URL from payment provider.",
        )

    return {"checkout_url": url}


# ---------------------------------------------------------------------------
# Webhook receiver
# ---------------------------------------------------------------------------

@router.post("/webhooks/bachs")
async def bachs_webhook(request: Request):
    """
    Receives and verifies Bachs webhook events.

    Bachs signs every payload with HMAC-SHA256 using the endpoint secret.
    We verify before touching the database. Fulfilment is idempotent.
    """
    raw = await request.body()
    sig = request.headers.get("Bachs-Signature", "")

    if not _verify_signature(raw, sig):
        log.warning("Bachs webhook signature mismatch — rejected. sig_header=%r", sig)
        raise HTTPException(status_code=400, detail="Bad signature")

    try:
        event = json.loads(raw)
    except json.JSONDecodeError:
        raise HTTPException(status_code=400, detail="Invalid JSON")

    event_type = event.get("event") or event.get("type") or ""
    log.info("Bachs webhook received: %s", event_type)

    try:
        await _dispatch(event_type, event)
    except Exception as exc:
        log.exception("Webhook handler error for %s: %s", event_type, exc)

    return Response(status_code=200)


def _verify_signature(payload: bytes, header: str) -> bool:
    """HMAC-SHA256 verification against the endpoint signing secret."""
    if not BACHS_WEBHOOK_SECRET:
        log.warning("BACHS_WEBHOOK_SECRET not set — skipping signature check")
        return True

    actual = header.removeprefix("sha256=").strip()
    if not actual:
        log.warning("Bachs webhook received with empty signature header")
        return False

    expected = hmac.new(
        BACHS_WEBHOOK_SECRET.encode(),
        payload,
        hashlib.sha256,
    ).hexdigest()

    return hmac.compare_digest(expected, actual)


async def _dispatch(event_type: str, event: dict) -> None:
    """Routes an event to the right handler."""
    data = event.get("data") or {}

    if event_type == "collection.succeeded":
        await _on_collection_succeeded(data)
    elif event_type == "customer.subscription.created":
        await _on_subscription_created(data)
    elif event_type == "customer.subscription.updated":
        await _on_subscription_updated(data)
    elif event_type == "customer.subscription.deleted":
        await _on_subscription_deleted(data)
    elif event_type == "invoice.paid":
        await _on_invoice_paid(data)
    elif event_type == "invoice.payment_failed":
        await _on_invoice_failed(data)
    elif event_type == "checkout.completed":
        await _on_checkout_completed(data)
    else:
        log.debug("Unhandled Bachs event type: %s", event_type)


# ---------------------------------------------------------------------------
# Event handlers
# ---------------------------------------------------------------------------

async def _on_checkout_completed(data: dict) -> None:
    meta = data.get("metadata") or {}
    user_id = meta.get("user_id")
    plan_id = meta.get("plan_id")
    if not user_id or not plan_id:
        log.warning("checkout.completed missing metadata: %s", meta)
        return
    if plan_id == "single":
        await _activate_plan(user_id, plan_id, provider_ref=data.get("id", ""))
        log.info("Single export activated for %s via checkout.completed", user_id)


async def _on_collection_succeeded(data: dict) -> None:
    meta = data.get("metadata") or {}
    user_id = meta.get("user_id")
    plan_id = meta.get("plan_id")
    if not user_id:
        return
    if plan_id == "single":
        await _activate_plan(user_id, plan_id, provider_ref=data.get("id", ""))


async def _on_subscription_created(data: dict) -> None:
    meta = data.get("metadata") or {}
    user_id = meta.get("user_id")
    plan_id = meta.get("plan_id")
    sub_id = data.get("id", "")

    if not user_id:
        cust_id = data.get("customer_id") or (data.get("customer") or {}).get("id")
        user_id = await _user_id_from_customer(cust_id) if cust_id else None
    if not user_id:
        log.warning("subscription.created: could not resolve user_id from %s", data.get("id"))
        return

    if not plan_id:
        plan_id = _infer_plan_from_product(data)

    await _activate_plan(user_id, plan_id or "monthly", provider_ref=sub_id, sub_id=sub_id)
    log.info("Subscription %s activated for %s (plan=%s)", sub_id, user_id, plan_id)


async def _on_subscription_updated(data: dict) -> None:
    sub_id = data.get("id", "")
    status = data.get("status", "")
    if status in ("canceled", "cancelled", "expired"):
        await _deactivate_by_sub_id(sub_id)
        return

    async with AsyncSessionLocal() as session:
        rows = (await session.execute(
            select(SubscriptionModel).where(
                SubscriptionModel.provider_reference == sub_id
            )
        )).scalars().all()
        for row in rows:
            # Never resurrect a plan an admin deliberately revoked. The external
            # subscription may still be live and emitting updates, but the admin
            # decision wins until the user actively re-subscribes (a new row).
            if row.admin_revoked:
                log.info("Ignoring subscription.updated for admin-revoked row %s", row.id)
                continue
            row.status = "active"
            row.current_period_start = datetime.now(timezone.utc)
            # Extend the period from the event when provided, so entitlement
            # stays accurate instead of relying on a stale end date.
            row.current_period_end = _period_end_from_event(data, row.plan_id)
        await session.commit()


async def _on_subscription_deleted(data: dict) -> None:
    await _deactivate_by_sub_id(data.get("id", ""))
    log.info("Subscription %s cancelled", data.get("id"))


async def _on_invoice_paid(data: dict) -> None:
    pass


async def _on_invoice_failed(data: dict) -> None:
    sub_id = (data.get("subscription") or {}).get("id") or data.get("subscription_id", "")
    log.warning("invoice.payment_failed for subscription %s — Bachs will retry", sub_id)


# ---------------------------------------------------------------------------
# Fulfilment helpers
# ---------------------------------------------------------------------------

async def _activate_plan(
    user_id: str,
    plan_id: str,
    provider_ref: str = "",
    sub_id: str = "",
) -> None:
    plan_map = {
        "single":  ("one_time", False),
        "monthly": ("monthly",  True),
        "yearly":  ("yearly",   True),
    }
    plan_key, is_recurring = plan_map.get(plan_id, ("monthly", True))

    ref = sub_id or provider_ref
    async with AsyncSessionLocal() as session:
        if ref:
            existing = (await session.execute(
                select(SubscriptionModel).where(
                    SubscriptionModel.user_id == user_id,
                    SubscriptionModel.provider_reference == ref,
                )
            )).scalars().first()
            if existing:
                # Idempotent: already fulfilled this provider reference. Don't
                # reactivate it if an admin has since revoked it.
                if not existing.admin_revoked and existing.status != "active":
                    existing.status = "active"
                    await session.commit()
                return

        existing_rows = (await session.execute(
            select(SubscriptionModel).where(
                SubscriptionModel.user_id == user_id,
                SubscriptionModel.status == "active",
            )
        )).scalars().all()
        for row in existing_rows:
            row.status = "superseded"

        now = datetime.now(timezone.utc)
        plan = PLANS.get(PlanId(plan_key)) if plan_key in {p.value for p in PlanId} else None
        sub = SubscriptionModel(
            id=str(uuid.uuid4()),
            user_id=user_id,
            plan_id=plan_key,
            status="active",
            provider="bachs",
            provider_reference=ref,
            current_period_start=now,
            # Recurring plans need an end date or entitlement never grants them;
            # one-time plans are gated by exports_used, so None is correct there.
            current_period_end=period_end_for(plan, now) if plan else None,
        )
        session.add(sub)

        # An append-only marker that a plan was activated (the usage log has no
        # per-period row concept — it's an event stream).
        session.add(UsageModel(
            id=str(uuid.uuid4()), user_id=user_id, event="plan_activated",
            subscription_id=sub.id, detail=plan_key,
        ))

        await session.commit()


async def _deactivate_by_sub_id(sub_id: str) -> None:
    if not sub_id:
        return
    async with AsyncSessionLocal() as session:
        rows = (await session.execute(
            select(SubscriptionModel).where(
                SubscriptionModel.provider_reference == sub_id
            )
        )).scalars().all()
        for row in rows:
            row.status = "cancelled"
        await session.commit()


async def cancel_bachs_subscription(provider_reference: str) -> bool:
    """
    Cancels a subscription at Bachs so it stops billing *and* stops emitting
    update events that would otherwise resurrect the local row.

    Best-effort: returns True on success, False otherwise, and never raises —
    an admin revoke must still neutralise the local entitlement even if the
    provider call fails (the local row is also marked admin_revoked, so a
    later webhook won't reactivate it regardless).
    """
    if not provider_reference or not BACHS_SECRET:
        return False
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            res = await client.delete(
                f"{BACHS_BASE}/v1/subscriptions/{provider_reference}",
                headers=_headers(),
            )
        if res.status_code in (200, 202, 204):
            log.info("Bachs subscription %s cancelled", provider_reference)
            return True
        log.error(
            "Bachs cancel for %s returned %s: %s",
            provider_reference, res.status_code, res.text[:300],
        )
        return False
    except Exception as exc:
        log.error("Bachs cancel error for %s: %r", provider_reference, exc)
        return False


async def _user_id_from_customer(cust_id: str) -> str | None:
    async with httpx.AsyncClient(timeout=10) as client:
        res = await client.get(f"{BACHS_BASE}/v1/customers/{cust_id}", headers=_headers())
    log.info("Bachs customer lookup — status=%s body=%s", res.status_code, res.text[:300])
    if res.status_code != 200:
        return None
    data = res.json()
    cust = data.get("data") or data
    return (cust.get("metadata") or {}).get("user_id")


def _period_end_from_event(data: dict, plan_id: str) -> datetime:
    """
    The subscription's period end, taken from the webhook payload when present
    (unix seconds or ISO-8601), else derived from the plan interval.
    """
    raw = data.get("current_period_end") or data.get("period_end")
    if raw:
        try:
            if isinstance(raw, (int, float)):
                return datetime.fromtimestamp(raw, tz=timezone.utc)
            return datetime.fromisoformat(str(raw).replace("Z", "+00:00"))
        except (ValueError, OSError, OverflowError):
            pass
    now = datetime.now(timezone.utc)
    plan = PLANS.get(PlanId(plan_id)) if plan_id in {p.value for p in PlanId} else None
    return (period_end_for(plan, now) if plan else None) or now


def _infer_plan_from_product(data: dict) -> str | None:
    prod_id = (
        data.get("product_id")
        or (data.get("product") or {}).get("id")
        or (data.get("plan") or {}).get("product_id")
        or ""
    )
    for plan, pid in PRODUCT_IDS.items():
        if pid and pid == prod_id:
            return plan
    return None
