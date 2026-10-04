"""Payment checkout and webhook handling for Provisio."""
from __future__ import annotations

import hashlib
import hmac
import json
import logging
import os
import re
import uuid
from datetime import datetime, timezone

import httpx
from fastapi import APIRouter, Depends, Request, Response, HTTPException
from jose import jwt as jose_jwt
from pydantic import BaseModel
from sqlalchemy import select

from app.core.config import settings
from app.core.db import AsyncSessionLocal
from app.core.deps import get_current_user_id
from app.models.billing import SubscriptionModel, UsageModel, UserFlagsModel, PLANS, PlanId, period_end_for
from app.services.email import send_welcome_email

log = logging.getLogger(__name__)
router = APIRouter(tags=["payments"])

FLUTTERWAVE_URL = "https://api.flutterwave.com/v3/payments"
NOWPAYMENTS_URL = "https://api.nowpayments.io/v1/payment"
FLW_SECRET_KEY = os.getenv("FLW_SECRET_KEY", "")
FLW_PUBLIC_KEY = os.getenv("FLW_PUBLIC_KEY", "")
FLW_ENCRYPTION_KEY = os.getenv("FLW_ENCRYPTION_KEY", "")
FLW_WEBHOOK_SECRET = os.getenv("FLW_WEBHOOK_SECRET", "")
NOWPAYMENTS_API_KEY = os.getenv("NOWPAYMENTS_API_KEY", "")
NOWPAYMENTS_IPN_SECRET = os.getenv("NOWPAYMENTS_IPN_SECRET", "")
FRONTEND_URL = os.getenv("FRONTEND_URL", settings.frontend_url).rstrip("/")
BACKEND_URL = os.getenv("BACKEND_URL", settings.backend_url).rstrip("/")

PLAN_DETAILS = {
    "single": {"name": "Single export", "amount": 10.00},
    "monthly": {"name": "Monthly plan", "amount": 30.00},
    "yearly": {"name": "Yearly plan", "amount": 99.00},
}


def _email_from_request(request: Request) -> str | None:
    try:
        token = request.headers.get("Authorization", "").removeprefix("Bearer ").strip()
        return jose_jwt.get_unverified_claims(token).get("email") if token else None
    except Exception as exc:
        log.warning("Could not extract email from JWT claims: %s", exc)
        return None


class CheckoutRequest(BaseModel):
    plan_id: str


def _plan_or_400(plan_id: str) -> dict:
    plan = PLAN_DETAILS.get(plan_id)
    if not plan:
        raise HTTPException(status_code=400, detail=f"Unknown plan '{plan_id}'")
    return plan


def _require_email(request: Request) -> str:
    email = _email_from_request(request)
    if not email:
        raise HTTPException(status_code=400, detail="Your account email could not be resolved.")
    return email


@router.post("/checkout/flutterwave")
async def create_flutterwave_checkout(body: CheckoutRequest, request: Request, user_id: str = Depends(get_current_user_id)):
    plan = _plan_or_400(body.plan_id)
    if not FLW_SECRET_KEY:
        raise HTTPException(status_code=503, detail="Flutterwave payments are not configured.")
    tx_ref = f"provisio-{user_id}-{body.plan_id}-{int(datetime.now(timezone.utc).timestamp())}"
    payload = {
        "tx_ref": tx_ref, "amount": plan["amount"], "currency": "USD",
        "redirect_url": f"{FRONTEND_URL}?checkout=success&plan={body.plan_id}",
        "customer": {"email": _require_email(request)},
        "meta": {"user_id": user_id, "plan_id": body.plan_id},
        "payment_options": "card,banktransfer",
        "customizations": {"title": "Provisio", "description": plan["name"]},
    }
    headers = {"Authorization": f"Bearer {FLW_SECRET_KEY}", "Content-Type": "application/json"}
    async with httpx.AsyncClient(timeout=20) as client:
        res = await client.post(FLUTTERWAVE_URL, json=payload, headers=headers)
    log.info("Flutterwave payment initialization response: status=%s body=%s", res.status_code, res.text)
    if res.status_code not in (200, 201):
        raise HTTPException(status_code=502, detail="Payment provider error. Please try again.")
    url = (res.json().get("data") or {}).get("link")
    if not url:
        raise HTTPException(status_code=502, detail="Could not get checkout URL from payment provider.")
    return {"checkout_url": url}


@router.post("/checkout/crypto")
async def create_crypto_checkout(body: CheckoutRequest, request: Request, user_id: str = Depends(get_current_user_id)):
    log.info("=== CRYPTO CHECKOUT HANDLER REACHED ===")
    try:
        plan = _plan_or_400(body.plan_id)
        if not NOWPAYMENTS_API_KEY:
            log.warning("Crypto checkout unavailable: NOWPAYMENTS_API_KEY is missing or empty.")
            raise HTTPException(status_code=503, detail="Crypto payments are not configured.")
        email = _require_email(request)
        log.info("Crypto checkout starting — user=%s plan=%s email=%s", user_id, body.plan_id, email)
        order_id = f"provisio-{user_id}-{body.plan_id}-{int(datetime.now(timezone.utc).timestamp())}"
        payload = {
            "price_amount": plan["amount"], "price_currency": "usd", "pay_currency": "usdttrc20",
            "order_id": order_id, "order_description": f"{plan['name']} — Provisio",
            "ipn_callback_url": f"{BACKEND_URL}/webhooks/nowpayments",
            "success_url": f"{FRONTEND_URL}?checkout=success&plan={body.plan_id}",
            "cancel_url": f"{FRONTEND_URL}?checkout=cancelled", "customer_email": email,
            "is_fixed_rate": True, "is_fee_paid_by_user": False,
        }
        log.info("NowPayments request payload: %s", payload)
        try:
            async with httpx.AsyncClient(timeout=20) as client:
                res = await client.post(NOWPAYMENTS_URL, json=payload, headers={"x-api-key": NOWPAYMENTS_API_KEY})
        except Exception:
            log.error("NowPayments request failed with an exception", exc_info=True)
            raise HTTPException(status_code=502, detail="Payment provider error. Please try again.")
        log.info("NowPayments response: status=%s body=%s", res.status_code, res.text)
        if res.status_code not in (200, 201):
            log.error("NowPayments error %s: %s", res.status_code, res.text)
            raise HTTPException(status_code=502, detail="Payment provider error. Please try again.")
        log.info("NowPayments full response: %s", res.text)
        url = res.json().get("invoice_url")
        if not url:
            raise HTTPException(status_code=502, detail="Could not get checkout URL from payment provider.")
        return {"checkout_url": url}
    except Exception as e:
        log.error("=== UNHANDLED EXCEPTION IN CRYPTO CHECKOUT: %s", e, exc_info=True)
        raise


@router.post("/webhooks/flutterwave")
async def flutterwave_webhook(request: Request):
    raw = await request.body()
    signature = request.headers.get("verif-hash", "")
    if not FLW_WEBHOOK_SECRET or not hmac.compare_digest(signature, FLW_WEBHOOK_SECRET):
        log.warning("Flutterwave webhook signature mismatch")
        return Response(status_code=200)
    try:
        event = json.loads(raw)
        data = event.get("data") or {}
        if event.get("event") == "charge.completed" and data.get("status") == "successful":
            meta = data.get("meta") or event.get("meta") or {}
            user_id, plan_id, tx_ref = meta.get("user_id"), meta.get("plan_id"), data.get("tx_ref")
            if user_id and plan_id and tx_ref and not await _provider_reference_exists(tx_ref):
                await _activate_plan(user_id, plan_id, provider_ref=tx_ref, provider="flutterwave")
    except Exception:
        log.exception("Flutterwave webhook processing failed")
    return Response(status_code=200)


@router.post("/webhooks/nowpayments")
async def nowpayments_webhook(request: Request):
    raw = await request.body()
    signature = request.headers.get("x-nowpayments-sig", "")
    try:
        body = json.loads(raw)
        canonical = json.dumps(body, sort_keys=True).encode()
        valid = bool(NOWPAYMENTS_IPN_SECRET) and hmac.compare_digest(
            hmac.new(NOWPAYMENTS_IPN_SECRET.encode(), canonical, hashlib.sha512).hexdigest(), signature,
        )
        if valid and body.get("payment_status") in ("finished", "confirmed"):
            order_id = body.get("order_id", "")
            match = re.match(r"^provisio-(.+)-(single|monthly|yearly)-(\d+)$", order_id)
            if match and not await _provider_reference_exists(order_id):
                await _activate_plan(match.group(1), match.group(2), provider_ref=order_id, provider="nowpayments")
        elif not valid:
            log.warning("NowPayments webhook signature mismatch")
    except Exception:
        log.exception("NowPayments webhook processing failed")
    return Response(status_code=200)


async def _provider_reference_exists(provider_ref: str) -> bool:
    async with AsyncSessionLocal() as session:
        return (await session.execute(select(SubscriptionModel).where(SubscriptionModel.provider_reference == provider_ref))).scalars().first() is not None


async def _on_checkout_completed(data: dict) -> None:
    meta = data.get("meta") or data.get("metadata") or {}
    if meta.get("user_id") and meta.get("plan_id"):
        await _activate_plan(meta["user_id"], meta["plan_id"], provider_ref=data.get("id", ""))


async def _on_subscription_created(data: dict) -> None:
    meta = data.get("meta") or data.get("metadata") or {}
    if meta.get("user_id"):
        sub_id = data.get("id", "")
        await _activate_plan(meta["user_id"], meta.get("plan_id", "monthly"), provider_ref=sub_id, sub_id=sub_id)


async def _on_subscription_updated(data: dict) -> None:
    sub_id = data.get("id", "")
    if data.get("status") in ("canceled", "cancelled", "expired"):
        await _deactivate_by_sub_id(sub_id)
        return
    async with AsyncSessionLocal() as session:
        rows = (await session.execute(select(SubscriptionModel).where(SubscriptionModel.provider_reference == sub_id))).scalars().all()
        for row in rows:
            if not row.admin_revoked:
                row.status = "active"
                row.current_period_start = datetime.now(timezone.utc)
                row.current_period_end = _period_end_from_event(data, row.plan_id)
        await session.commit()


async def _on_subscription_deleted(data: dict) -> None:
    await _deactivate_by_sub_id(data.get("id", ""))


async def _activate_plan(user_id: str, plan_id: str, provider_ref: str = "", sub_id: str = "", provider: str = "payment") -> None:
    plan_map = {"single": "one_time", "monthly": "monthly", "yearly": "yearly"}
    plan_key = plan_map.get(plan_id, "monthly")
    ref = sub_id or provider_ref
    async with AsyncSessionLocal() as session:
        if ref:
            existing = (await session.execute(select(SubscriptionModel).where(SubscriptionModel.provider_reference == ref))).scalars().first()
            if existing:
                if not existing.admin_revoked and existing.status != "active":
                    existing.status = "active"
                    await session.commit()
                return
        existing_rows = (await session.execute(select(SubscriptionModel).where(SubscriptionModel.user_id == user_id, SubscriptionModel.status == "active"))).scalars().all()
        for row in existing_rows:
            row.status = "superseded"
        now = datetime.now(timezone.utc)
        plan = PLANS.get(PlanId(plan_key)) if plan_key in {p.value for p in PlanId} else None
        sub = SubscriptionModel(id=str(uuid.uuid4()), user_id=user_id, plan_id=plan_key, status="active", provider=provider, provider_reference=ref, current_period_start=now, current_period_end=period_end_for(plan, now) if plan else None)
        session.add(sub)
        session.add(UsageModel(id=str(uuid.uuid4()), user_id=user_id, event="plan_activated", subscription_id=sub.id, detail=plan_key))
        await session.commit()

        # Welcome the new subscriber. Best-effort and outside the critical
        # path: the subscription is already committed, so a mail failure can't
        # undo the activation. We take the recipient from the stored user-flags
        # email (populated at sign-up / first support contact).
        flags = await session.get(UserFlagsModel, user_id)
        recipient = flags.email if flags else ""
        plan_name = plan.name if plan else plan_key
        await send_welcome_email(recipient, plan_name)


async def _deactivate_by_sub_id(sub_id: str) -> None:
    if not sub_id:
        return
    async with AsyncSessionLocal() as session:
        rows = (await session.execute(select(SubscriptionModel).where(SubscriptionModel.provider_reference == sub_id))).scalars().all()
        for row in rows:
            row.status = "cancelled"
        await session.commit()


def _period_end_from_event(data: dict, plan_id: str) -> datetime | None:
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
