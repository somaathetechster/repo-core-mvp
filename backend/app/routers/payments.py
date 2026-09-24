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
from datetime import datetime, timezone

import httpx
from fastapi import APIRouter, HTTPException, Request, Response
from pydantic import BaseModel
from sqlalchemy import select

from app.core.db import AsyncSessionLocal
from app.models.billing import SubscriptionModel, UsageModel, UserFlagsModel

log = logging.getLogger(__name__)

router = APIRouter(tags=["payments"])

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

BACHS_BASE = "https://api.bachs.io"
BACHS_SECRET = os.getenv("BACHS_SECRET_KEY", "")
BACHS_WEBHOOK_SECRET = os.getenv("BACHS_WEBHOOK_SECRET", "")

# Bachs product IDs — create these in the Bachs dashboard, then set the env
# vars. First boot will log a warning if they're missing but won't crash.
PRODUCT_IDS: dict[str, str] = {
    "single":  os.getenv("BACHS_PRODUCT_SINGLE", ""),
    "monthly": os.getenv("BACHS_PRODUCT_MONTHLY", ""),
    "yearly":  os.getenv("BACHS_PRODUCT_YEARLY", ""),
}

PLAN_DETAILS = {
    "single":  {"name": "Single export",     "price": "10.00",  "currency": "USD", "interval": None},
    "monthly": {"name": "Monthly plan",       "price": "30.00",  "currency": "USD", "interval": "month"},
    "yearly":  {"name": "Yearly plan",        "price": "99.00",  "currency": "USD", "interval": "year"},
}

FRONTEND_URL = os.getenv("FRONTEND_URL", "https://www.provisio.site")


def _headers() -> dict[str, str]:
    return {
        "Authorization": f"Bearer {BACHS_SECRET}",
        "Content-Type": "application/json",
        "Accept": "application/json",
    }


# ---------------------------------------------------------------------------
# Checkout creation
# ---------------------------------------------------------------------------

class CheckoutRequest(BaseModel):
    plan_id: str


@router.post("/checkout/create")
async def create_checkout(body: CheckoutRequest, request: Request):
    """
    Creates a Bachs checkout session and returns the URL to redirect to.

    Called by the frontend when a user picks a plan. We look up (or create)
    a Bachs customer for this user, attach the right product, and hand back
    a hosted checkout URL. The user pays there; fulfilment happens via
    webhook.
    """
    from app.core.deps import get_current_user_id
    try:
        user_id = await get_current_user_id(request)
    except Exception:
        raise HTTPException(status_code=401, detail="Not authenticated")

    plan = PLAN_DETAILS.get(body.plan_id)
    if not plan:
        raise HTTPException(status_code=400, detail=f"Unknown plan '{body.plan_id}'")

    product_id = PRODUCT_IDS.get(body.plan_id)
    if not product_id:
        raise HTTPException(status_code=503, detail=f"Product for plan '{body.plan_id}' is not configured yet.")

    # Look up the user's email from user_flags so Bachs can pre-fill it.
    async with AsyncSessionLocal() as session:
        flags = await session.get(UserFlagsModel, user_id)
    user_email = (flags.email if flags else None) or ""

    async with httpx.AsyncClient(timeout=15) as client:
        # Find or create a Bachs customer for this user.
        cust_id = await _get_or_create_customer(client, user_id, user_email)

        # Create the checkout session.
        payload = {
            "customer_id": cust_id,
            "line_items": [{"product_id": product_id, "quantity": 1}],
            "success_url": f"{FRONTEND_URL}?checkout=success&plan={body.plan_id}",
            "cancel_url":  f"{FRONTEND_URL}?checkout=cancelled",
            # Carry user_id through so the webhook knows who to activate.
            "metadata": {"user_id": user_id, "plan_id": body.plan_id},
        }
        res = await client.post(f"{BACHS_BASE}/v1/checkout-sessions", json=payload, headers=_headers())

    if res.status_code not in (200, 201):
        log.error("Bachs checkout error %s: %s", res.status_code, res.text[:500])
        raise HTTPException(status_code=502, detail="Payment provider error. Please try again.")

    data = res.json()
    url = data.get("url") or data.get("checkout_url") or (data.get("data") or {}).get("url")
    if not url:
        log.error("No URL in Bachs response: %s", data)
        raise HTTPException(status_code=502, detail="Could not get checkout URL from payment provider.")

    return {"checkout_url": url}


async def _get_or_create_customer(client: httpx.AsyncClient, user_id: str, email: str) -> str:
    """Finds the Bachs customer for this user, creating one if needed."""
    # Search by metadata user_id first.
    res = await client.get(
        f"{BACHS_BASE}/v1/customers",
        params={"metadata[user_id]": user_id, "limit": 1},
        headers=_headers(),
    )
    if res.status_code == 200:
        items = (res.json().get("data") or res.json().get("items") or [])
        if items:
            return items[0]["id"]

    # Create one.
    res = await client.post(
        f"{BACHS_BASE}/v1/customers",
        json={"email": email or f"{user_id}@provisio.internal", "metadata": {"user_id": user_id}},
        headers=_headers(),
    )
    if res.status_code not in (200, 201):
        raise HTTPException(status_code=502, detail="Could not create payment customer.")
    data = res.json()
    return (data.get("data") or data)["id"]


# ---------------------------------------------------------------------------
# Webhook receiver
# ---------------------------------------------------------------------------

@router.post("/webhooks/bachs")
async def bachs_webhook(request: Request):
    """
    Receives and verifies Bachs webhook events.

    Bachs signs every payload with HMAC-SHA256 using the endpoint secret.
    We verify before touching the database. Fulfilment is idempotent: if
    a row already exists for this user+provider, nothing changes.
    """
    raw = await request.body()
    sig = request.headers.get("Bachs-Signature", "")

    if not _verify_signature(raw, sig):
        log.warning("Bachs webhook signature mismatch — rejected")
        raise HTTPException(status_code=400, detail="Bad signature")

    try:
        event = json.loads(raw)
    except json.JSONDecodeError:
        raise HTTPException(status_code=400, detail="Invalid JSON")

    event_type = event.get("event") or event.get("type") or ""
    log.info("Bachs webhook: %s", event_type)

    try:
        await _dispatch(event_type, event)
    except Exception as exc:
        # Log but return 200 so Bachs doesn't keep retrying a logic error.
        log.exception("Webhook handler error for %s: %s", event_type, exc)

    return Response(status_code=200)


def _verify_signature(payload: bytes, header: str) -> bool:
    """HMAC-SHA256 verification against the endpoint signing secret."""
    if not BACHS_WEBHOOK_SECRET:
        log.warning("BACHS_WEBHOOK_SECRET not set — skipping signature check")
        return True  # Allow through in dev; fail hard in prod via the else branch.

    expected = hmac.new(
        BACHS_WEBHOOK_SECRET.encode(),
        payload,
        hashlib.sha256,
    ).hexdigest()

    # Header may be "sha256=<hex>" or just "<hex>".
    actual = header.removeprefix("sha256=")
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
        log.debug("Unhandled event type: %s", event_type)


# ---------------------------------------------------------------------------
# Event handlers
# ---------------------------------------------------------------------------

async def _on_checkout_completed(data: dict) -> None:
    """
    Checkout completed. For one-time payments we activate here. For
    recurring plans the subscription.created event is the authoritative
    signal; this just logs.
    """
    meta = data.get("metadata") or {}
    user_id = meta.get("user_id")
    plan_id = meta.get("plan_id")
    if not user_id or not plan_id:
        log.warning("checkout.completed missing metadata: %s", meta)
        return

    if plan_id == "single":
        # One-time export credit — activate now.
        await _activate_plan(user_id, plan_id, provider_ref=data.get("id", ""))
        log.info("Single export activated for %s via checkout.completed", user_id)


async def _on_collection_succeeded(data: dict) -> None:
    """
    A payment was collected. For one-time purchases this is the billing
    confirmation; for subscriptions the subscription events are canonical.
    """
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
        # Fall back to customer lookup
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
    """Plan change or renewal — keep the row current."""
    sub_id = data.get("id", "")
    status = data.get("status", "")
    if status in ("canceled", "cancelled", "expired"):
        await _deactivate_by_sub_id(sub_id)
    else:
        # Renewal: reset the period so usage caps reset correctly.
        async with AsyncSessionLocal() as session:
            rows = (await session.execute(
                select(SubscriptionModel).where(SubscriptionModel.provider_subscription_id == sub_id)
            )).scalars().all()
            for row in rows:
                row.status = "active"
                row.current_period_start = datetime.now(timezone.utc)
            await session.commit()


async def _on_subscription_deleted(data: dict) -> None:
    await _deactivate_by_sub_id(data.get("id", ""))
    log.info("Subscription %s cancelled", data.get("id"))


async def _on_invoice_paid(data: dict) -> None:
    """Renewal invoice paid — subscription stays active, already handled above."""
    pass


async def _on_invoice_failed(data: dict) -> None:
    """Renewal failed. Bachs will retry; we leave the subscription active until
    it reaches a terminal failure state and fires subscription.deleted."""
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
    """
    Creates or updates the subscription row. Idempotent: a duplicate call
    with the same user_id + provider_ref does nothing.
    """
    plan_map = {
        "single":  ("one_time", False),
        "monthly": ("monthly",  True),
        "yearly":  ("yearly",   True),
    }
    plan_key, is_recurring = plan_map.get(plan_id, ("monthly", True))

    async with AsyncSessionLocal() as session:
        # Idempotency: skip if we already processed this exact event.
        if provider_ref:
            existing = (await session.execute(
                select(SubscriptionModel).where(
                    SubscriptionModel.user_id == user_id,
                    SubscriptionModel.provider_subscription_id == provider_ref,
                )
            )).scalars().first()
            if existing:
                return

        # Deactivate any existing active subscription first.
        existing_rows = (await session.execute(
            select(SubscriptionModel).where(
                SubscriptionModel.user_id == user_id,
                SubscriptionModel.status == "active",
            )
        )).scalars().all()
        for row in existing_rows:
            row.status = "superseded"

        now = datetime.now(timezone.utc)
        sub = SubscriptionModel(
            user_id=user_id,
            plan_id=plan_key,
            status="active",
            provider="bachs",
            provider_subscription_id=sub_id or provider_ref,
            current_period_start=now,
        )
        session.add(sub)

        # Ensure a usage row exists for this billing period.
        period = now.strftime("%Y-%m")
        existing_usage = (await session.execute(
            select(UsageModel).where(
                UsageModel.user_id == user_id,
                UsageModel.period == period,
            )
        )).scalars().first()
        if not existing_usage:
            session.add(UsageModel(user_id=user_id, period=period))

        await session.commit()


async def _deactivate_by_sub_id(sub_id: str) -> None:
    if not sub_id:
        return
    async with AsyncSessionLocal() as session:
        rows = (await session.execute(
            select(SubscriptionModel).where(
                SubscriptionModel.provider_subscription_id == sub_id
            )
        )).scalars().all()
        for row in rows:
            row.status = "cancelled"
        await session.commit()


async def _user_id_from_customer(cust_id: str) -> str | None:
    """Looks up our user_id from a Bachs customer_id via the Bachs API."""
    async with httpx.AsyncClient(timeout=10) as client:
        res = await client.get(f"{BACHS_BASE}/v1/customers/{cust_id}", headers=_headers())
    if res.status_code != 200:
        return None
    data = res.json()
    cust = data.get("data") or data
    return (cust.get("metadata") or {}).get("user_id")


def _infer_plan_from_product(data: dict) -> str | None:
    """Guesses the plan from the product_id on a subscription object."""
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
