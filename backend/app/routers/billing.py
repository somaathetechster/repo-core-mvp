"""
Billing and administration endpoints.

The export gate lives here rather than in the export router so there is one
place that decides who may export, and one place that records that they did.
Splitting that decision across call sites is how paywalls end up leaking.
"""
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select, func, desc

from app.core.deps import get_current_user_id
from app.core.db import AsyncSessionLocal
from app.models.billing import (
    PLANS, PlanId, SubscriptionStatus, SubscriptionModel, UsageModel, UserFlagsModel,
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
    limit: int = 100,
    user_id: str = Depends(get_current_user_id),
):
    """
    Everyone who has used the product, with what they've built and what
    they're paying. Built from the tables that already exist rather than a
    separate users table, so it can't drift out of sync with reality.
    """
    async with AsyncSessionLocal() as session:
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

        return {
            "users": users[:limit],
            "totals": {
                "users": len(users),
                "paying": sum(1 for u in users if u["plan"] != "free"),
                "decks": sum(deck_counts.values()),
                "exports": sum(export_counts.values()),
            },
        }


class GrantRequest(BaseModel):
    target_user_id: str
    plan_id: str
    note: str = ""


@admin.post("/grant")
async def grant_plan(body: GrantRequest, user_id: str = Depends(get_current_user_id)):
    """
    Gives a user a plan without payment, for campaigns and comps.

    Recorded as a normal subscription with provider "admin_grant", so it
    shows up in the same history as a paid one and is auditable. The
    granting admin's id is stored on the row.
    """
    async with AsyncSessionLocal() as session:
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
async def revoke(body: RevokeRequest, user_id: str = Depends(get_current_user_id)):
    async with AsyncSessionLocal() as session:
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
async def recent_usage(limit: int = 100, user_id: str = Depends(get_current_user_id)):
    async with AsyncSessionLocal() as session:
        await require_admin(session, user_id)
        rows = (await session.execute(
            select(UsageModel).order_by(desc(UsageModel.created_at)).limit(limit)
        )).scalars().all()
        return {
            "events": [
                {
                    "id": r.id, "user_id": r.user_id, "event": r.event,
                    "deck_id": r.deck_id, "detail": r.detail,
                    "created_at": r.created_at.isoformat() if r.created_at else None,
                }
                for r in rows
            ]
        }
