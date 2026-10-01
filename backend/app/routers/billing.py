"""
Billing and administration endpoints.

The export gate lives here rather than in the export router so there is one
place that decides who may export, and one place that records that they did.
Splitting that decision across call sites is how paywalls end up leaking.
"""
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy import select, func, desc

from app.core.deps import get_current_user_id, get_current_user_id_optional
from app.core.db import AsyncSessionLocal
from app.models.billing import (
    PLANS, PlanId, SubscriptionStatus, SubscriptionModel, UsageModel, UserFlagsModel, UserNotificationModel,
    evaluate_entitlement, entitlement_to_dict, plan_to_dict, period_end_for,
)
from app.models.deck import DeckModel

router = APIRouter(tags=["billing"])


async def load_entitlement(session, user_id: str):
    rows = (await session.execute(
        select(SubscriptionModel).where(SubscriptionModel.user_id == user_id)
    )).scalars().all()
    return evaluate_entitlement(list(rows))


async def require_export_entitlement(session, user_id: str, deck_id: str):
    """
    The gate. Raises 402 when the user may not export.

    402 rather than 403 because this is specifically "payment required", and
    the frontend keys the paywall off that status rather than parsing the
    message.
    """
    ent = await load_entitlement(session, user_id)
    if not ent.can_export:
        raise HTTPException(
            status_code=402,
            detail={
                "error": "payment_required",
                "message": ent.reason,
                "plans": [plan_to_dict(p) for p in PLANS.values() if p.id != PlanId.FREE],
            },
        )
    return ent


async def record_export(session, user_id: str, deck_id: str, ent) -> None:
    """
    Records the export and consumes a one-time credit if that's what paid
    for it. Called only after the file is successfully produced, so a failed
    export doesn't burn someone's single purchase.
    """
    session.add(UsageModel(
        id=str(uuid.uuid4()), user_id=user_id, event="deck_export",
        deck_id=deck_id, subscription_id=ent.subscription_id,
        detail=ent.plan.id.value,
    ))
    if ent.plan.deck_exports is not None and ent.subscription_id:
        sub = await session.get(SubscriptionModel, ent.subscription_id)
        if sub:
            sub.exports_used = (sub.exports_used or 0) + 1
    await session.commit()


@router.get("/billing/plans")
async def list_plans():
    return {"plans": [plan_to_dict(p) for p in PLANS.values()]}


@router.get("/billing/me")
async def my_entitlement(user_id: str = Depends(get_current_user_id)):
    async with AsyncSessionLocal() as session:
        ent = await load_entitlement(session, user_id)
        history = (await session.execute(
            select(SubscriptionModel)
            .where(SubscriptionModel.user_id == user_id)
            .order_by(desc(SubscriptionModel.created_at))
            .limit(10)
        )).scalars().all()
        exports = (await session.execute(
            select(func.count()).select_from(UsageModel)
            .where(UsageModel.user_id == user_id, UsageModel.event == "deck_export")
        )).scalar() or 0

    return {
        "entitlement": entitlement_to_dict(ent),
        "exports_used": exports,
        "history": [
            {
                "id": s.id, "plan_id": s.plan_id, "status": s.status,
                "provider": s.provider, "amount_usd": s.amount_usd,
                "period_end": s.current_period_end.isoformat() if s.current_period_end else None,
                "created_at": s.created_at.isoformat() if s.created_at else None,
                "note": s.note,
            }
            for s in history
        ],
    }


# ---------------------------------------------------------------------------
# Admin
# ---------------------------------------------------------------------------

admin = APIRouter(prefix="/admin", tags=["admin"])


async def require_admin(session, user_id: str) -> UserFlagsModel:
    flags = await session.get(UserFlagsModel, user_id)
    if not flags or not flags.is_admin:
        # 404 rather than 403: an admin surface shouldn't confirm its own
        # existence to someone who isn't one.
        raise HTTPException(status_code=404, detail="Not found.")
    return flags


@admin.get("/users")
async def list_users(
    request: Request,
    limit: int = 100,
    user_id: str = Depends(get_current_user_id_optional),
):
    """
    Everyone who has used the product. Accepts either a Supabase JWT from an
    admin user, or the X-Admin-Key header from the controller app.
    """
    async with AsyncSessionLocal() as session:
        if not _check_admin_key(request):
            if not user_id:
                raise HTTPException(status_code=403, detail="Not authorised")
            await require_admin(session, user_id)

        deck_counts = dict((await session.execute(
            select(DeckModel.user_id, func.count(DeckModel.id)).group_by(DeckModel.user_id)
        )).all())
        export_counts = dict((await session.execute(
            select(UsageModel.user_id, func.count(UsageModel.id))
            .where(UsageModel.event == "deck_export")
            .group_by(UsageModel.user_id)
        )).all())

        flags = (await session.execute(select(UserFlagsModel).limit(limit))).scalars().all()
        known = {f.user_id for f in flags}
        # Users who have decks but no flags row yet still need to appear.
        for uid in list(deck_counts) + list(export_counts):
            if uid not in known:
                known.add(uid)
                flags.append(UserFlagsModel(user_id=uid, is_admin=False))

        all_subs = (await session.execute(select(SubscriptionModel))).scalars().all()
        subs_by_user: dict[str, list[SubscriptionModel]] = {}
        for s in all_subs:
            subs_by_user.setdefault(s.user_id, []).append(s)

        users = []
        for f in flags:
            ent = evaluate_entitlement(subs_by_user.get(f.user_id, []))
            users.append({
                "user_id": f.user_id,
                "email": f.email,
                "display_name": f.display_name,
                "is_admin": f.is_admin,
                "plan": ent.plan.id.value,
                "plan_name": ent.plan.name,
                "can_export": ent.can_export,
                "period_end": ent.period_end.isoformat() if ent.period_end else None,
                "deck_count": deck_counts.get(f.user_id, 0),
                "export_count": export_counts.get(f.user_id, 0),
                "joined": f.created_at.isoformat() if f.created_at else None,
            })

        users.sort(key=lambda u: (-u["deck_count"], u["user_id"]))

        # Return flat list - the controller app expects an array
        return users[:limit]


class GrantRequest(BaseModel):
    target_user_id: str
    plan_id: str
    note: str = ""


@admin.post("/grant")
async def grant_plan(request: Request, body: GrantRequest, user_id: str = Depends(get_current_user_id_optional)):
    """
    Gives a user a plan without payment, for campaigns and comps.

    Recorded as a normal subscription with provider "admin_grant", so it
    shows up in the same history as a paid one and is auditable. The
    granting admin's id is stored on the row.
    """
    async with AsyncSessionLocal() as session:
        if not _check_admin_key(request):
            await require_admin(session, user_id)

        try:
            plan = PLANS[PlanId(body.plan_id)]
        except (KeyError, ValueError):
            raise HTTPException(status_code=400, detail=f"Unknown plan '{body.plan_id}'.")
        if plan.id == PlanId.FREE:
            raise HTTPException(status_code=400, detail="Free is the absence of a plan, not a grant.")

        start = datetime.now(timezone.utc)
        sub = SubscriptionModel(
            id=str(uuid.uuid4()),
            user_id=body.target_user_id,
            plan_id=plan.id.value,
            status=SubscriptionStatus.ACTIVE.value,
            provider="admin_grant",
            amount_usd=0,
            current_period_start=start,
            current_period_end=period_end_for(plan, start),
            granted_by=user_id,
            note=body.note or f"Granted by admin",
        )
        session.add(sub)
        await session.commit()

        ent = await load_entitlement(session, body.target_user_id)
        return {"granted": plan_to_dict(plan), "entitlement": entitlement_to_dict(ent)}


class RevokeRequest(BaseModel):
    subscription_id: str
    reason: str = ""


@admin.post("/revoke")
async def revoke(request: Request, body: RevokeRequest, user_id: str = Depends(get_current_user_id_optional)):
    async with AsyncSessionLocal() as session:
        if not _check_admin_key(request):
            await require_admin(session, user_id)
        sub = await session.get(SubscriptionModel, body.subscription_id)
        if not sub:
            raise HTTPException(status_code=404, detail="Subscription not found.")
        sub.status = SubscriptionStatus.EXPIRED.value
        sub.cancelled_at = datetime.now(timezone.utc)
        sub.note = (sub.note or "") + f" | Revoked by admin: {body.reason}"
        await session.commit()
        return {"revoked": sub.id}


@admin.get("/usage")
async def usage_by_period(request: Request, limit: int = 500, user_id: str = Depends(get_current_user_id_optional)):
    """
    Per-user, per-month usage for the admin Usage tab.

    Returns a flat array of rows — one per (user, month) — each carrying the
    decks created and exports used in that month plus the user's current plan.
    The admin frontend renders this directly as a table, so the response is an
    array, not an envelope. (It previously returned a raw {events: [...]} log,
    which the Usage tab couldn't render — it expects these aggregated rows.)
    """
    async with AsyncSessionLocal() as session:
        if not _check_admin_key(request):
            await require_admin(session, user_id)

        decks = (await session.execute(
            select(DeckModel.user_id, DeckModel.created_at)
        )).all()
        exports = (await session.execute(
            select(UsageModel.user_id, UsageModel.created_at)
            .where(UsageModel.event == "deck_export")
        )).all()

        # Bucket activity by (user, YYYY-MM).
        buckets: dict[tuple[str, str], dict] = {}

        def bucket(uid: str, created_at) -> dict:
            period = created_at.strftime("%Y-%m") if created_at else "—"
            key = (uid, period)
            if key not in buckets:
                buckets[key] = {"user_id": uid, "period": period, "decks_created": 0, "exports_used": 0}
            return buckets[key]

        for uid, created_at in decks:
            bucket(uid, created_at)["decks_created"] += 1
        for uid, created_at in exports:
            bucket(uid, created_at)["exports_used"] += 1

        # Email and current plan are per-user, not per-period.
        flags = (await session.execute(select(UserFlagsModel))).scalars().all()
        email_by_user = {f.user_id: (f.email or "") for f in flags}
        all_subs = (await session.execute(select(SubscriptionModel))).scalars().all()
        subs_by_user: dict[str, list[SubscriptionModel]] = {}
        for s in all_subs:
            subs_by_user.setdefault(s.user_id, []).append(s)

        rows = []
        for (uid, _period), agg in buckets.items():
            ent = evaluate_entitlement(subs_by_user.get(uid, []))
            rows.append({
                "user_id": uid,
                "email": email_by_user.get(uid, ""),
                "period": agg["period"],
                "decks_created": agg["decks_created"],
                "exports_used": agg["exports_used"],
                "plan": ent.plan.id.value,
            })

        # Most recent period first, then by email for a stable order.
        rows.sort(key=lambda r: (r["period"], r["email"]), reverse=True)
        return rows[:limit]

import os as _os
_ADMIN_KEY = _os.environ.get("ADMIN_CONTROLLER_KEY", "")

def _check_admin_key(request: Request) -> bool:
    """Allows the controller app to call admin endpoints without a user JWT."""
    return bool(_ADMIN_KEY and request.headers.get("X-Admin-Key") == _ADMIN_KEY)

async def require_admin_or_key(
    request: Request,
    session,
    user_id: str | None,
) -> None:
    if _check_admin_key(request):
        return
    if not user_id:
        raise HTTPException(status_code=404)
    await require_admin(session, user_id)


@admin.get("/stats")
async def admin_stats(
    request: Request,
    user_id: str = Depends(get_current_user_id_optional),
):
    async with AsyncSessionLocal() as session:
        if not _check_admin_key(request):
            await require_admin(session, user_id)
        from sqlalchemy import func as sqlfunc, text
        from app.models.deck import DeckModel
        from app.models.billing import SubscriptionModel, UsageModel

        total_users_row = await session.execute(
            text("SELECT count(*) FROM auth.users")
        )
        total_users = total_users_row.scalar() or 0

        deck_count = (await session.execute(sqlfunc.count(DeckModel.id).select())).scalar() or 0
        export_count = (await session.execute(sqlfunc.count(UsageModel.id).select())).scalar() or 0
        paying = (await session.execute(
            select(sqlfunc.count(SubscriptionModel.id)).where(
                SubscriptionModel.status == "active",
                SubscriptionModel.plan_id != "free",
            )
        )).scalar() or 0

        mrr = 0
        subs = (await session.execute(
            select(SubscriptionModel).where(SubscriptionModel.status == "active")
        )).scalars().all()
        for sub in subs:
            if sub.plan_id == "monthly": mrr += 30
            elif sub.plan_id == "yearly": mrr += round(99.99 / 12, 2)

        # Active 7d: users who created or updated a deck in the last 7 days
        active_row = await session.execute(
            text("SELECT count(distinct user_id) FROM decks WHERE updated_at > now() - interval '7 days'")
        )
        active_7d = active_row.scalar() or 0

        return {
            "total_users": total_users, "active_7d": active_7d,
            "total_decks": deck_count, "total_exports": export_count,
            "paying_users": paying, "mrr_usd": mrr,
        }


@admin.post("/grant-admin")
async def grant_admin_role(
    body: dict,
    request: Request,
    user_id: str = Depends(get_current_user_id_optional),
):
    async with AsyncSessionLocal() as session:
        if not _check_admin_key(request):
            await require_admin(session, user_id)
        target = body.get("user_id")
        if not target:
            raise HTTPException(400, "user_id required")
        flags = await session.get(UserFlagsModel, target)
        if flags:
            flags.is_admin = True
        else:
            session.add(UserFlagsModel(user_id=target, is_admin=True))
        await session.commit()


@admin.post("/revoke-admin")
async def revoke_admin_role(
    body: dict,
    request: Request,
    user_id: str = Depends(get_current_user_id_optional),
):
    async with AsyncSessionLocal() as session:
        if not _check_admin_key(request):
            await require_admin(session, user_id)
        target = body.get("user_id")
        flags = await session.get(UserFlagsModel, target)
        if flags:
            flags.is_admin = False
            await session.commit()


@admin.post("/revoke-plan")
async def revoke_user_plan(
    body: dict,
    request: Request,
    user_id: str = Depends(get_current_user_id_optional),
):
    async with AsyncSessionLocal() as session:
        if not _check_admin_key(request):
            await require_admin(session, user_id)
        target = body.get("user_id")
        from sqlalchemy import update
        await session.execute(
            update(SubscriptionModel)
            .where(SubscriptionModel.user_id == target, SubscriptionModel.status == "active")
            .values(status="revoked")
        )
        await session.commit()


@admin.post("/create-admin")
async def create_admin_user(
    body: dict,
    request: Request,
    user_id: str = Depends(get_current_user_id_optional),
):
    """Creates a new Supabase user and immediately grants them admin."""
    if not _check_admin_key(request):
        async with AsyncSessionLocal() as session:
            await require_admin(session, user_id)
    email = body.get("email"); pw = body.get("password")
    if not email or not pw:
        raise HTTPException(400, "email and password required")
    from app.core.config import settings
    from supabase._async.client import AsyncClient
    sb: AsyncClient = _sc(settings.supabase_url, settings.supabase_service_role_key)
    res = await sb.auth.admin.create_user({"email": email, "password": pw, "email_confirm": True})
    new_uid = res.user.id
    async with AsyncSessionLocal() as session:
        existing = await session.get(UserFlagsModel, new_uid)
        if existing:
            existing.is_admin = True
        else:
            session.add(UserFlagsModel(user_id=new_uid, is_admin=True, email=email))
        await session.commit()
    return {"user_id": new_uid, "email": email}

# ── User notification endpoints ─────────────────────────────────────────

@router.get("/notifications")
async def get_notifications(user_id: str = Depends(get_current_user_id)):
    """Returns unread notifications for the current user."""
    async with AsyncSessionLocal() as session:
        from sqlalchemy import select as _select
        result = await session.execute(
            _select(UserNotificationModel)
            .where(UserNotificationModel.user_id == user_id, UserNotificationModel.read == False)
            .order_by(UserNotificationModel.created_at.desc())
            .limit(10)
        )
        notifs = result.scalars().all()
        return [
            {"id": n.id, "message": n.message, "category": n.category, "created_at": n.created_at.isoformat()}
            for n in notifs
        ]


@router.post("/notifications/{notif_id}/dismiss")
async def dismiss_notification(notif_id: int, user_id: str = Depends(get_current_user_id)):
    """Marks a notification as read (dismissed by the user)."""
    async with AsyncSessionLocal() as session:
        notif = await session.get(UserNotificationModel, notif_id)
        if notif and notif.user_id == user_id:
            notif.read = True
            await session.commit()
    return {"ok": True}
