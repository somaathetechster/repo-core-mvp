"""
Plans, subscriptions, and entitlements.

The pricing shape is: a one-time purchase that unlocks a single deck, a
monthly subscription, and a yearly one. Entitlement is computed rather than
stored as a flag, because a stored flag drifts: a subscription lapses, a
refund is issued, an admin grant expires, and a boolean on the user row
quietly stays true. Deriving it from the subscription record on every check
means the answer is always current.

An admin can grant a plan directly. That path is deliberately first-class
rather than a hack, because comping accounts for campaigns and partnerships
is a real business need, and doing it by editing rows by hand is how people
end up with unauditable state.
"""
from datetime import datetime, timedelta, timezone
from dataclasses import dataclass
from enum import Enum

from sqlalchemy import String, DateTime, Integer, Boolean, ForeignKey, Text
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.sql import func

from app.core.db import Base


class PlanId(str, Enum):
    FREE = "free"
    ONE_TIME = "one_time"
    MONTHLY = "monthly"
    YEARLY = "yearly"


class SubscriptionStatus(str, Enum):
    ACTIVE = "active"
    CANCELLED = "cancelled"       # cancelled but still inside the paid period
    EXPIRED = "expired"
    PENDING = "pending"           # checkout started, payment not confirmed
    REFUNDED = "refunded"


@dataclass(frozen=True)
class Plan:
    id: PlanId
    name: str
    description: str
    price_usd: float
    interval: str | None            # "month" | "year" | None for one-time
    deck_exports: int | None        # None means unlimited
    features: tuple[str, ...]


PLANS: dict[PlanId, Plan] = {
    PlanId.FREE: Plan(
        id=PlanId.FREE,
        name="Free",
        description="Build and preview a deck in full. Exporting requires a plan.",
        price_usd=0,
        interval=None,
        deck_exports=0,
        features=(
            "Unlimited decks",
            "Full editor, templates, and data studio",
            "Repository analysis",
            "Watermark-free preview",
        ),
    ),
    PlanId.ONE_TIME: Plan(
        id=PlanId.ONE_TIME,
        name="Single deck",
        description="Export one deck. No subscription, no renewal.",
        price_usd=10.00,
        interval=None,
        deck_exports=1,
        features=(
            "Everything in Free",
            "Export one deck to PowerPoint and PDF",
            "Embedded fonts",
            "No recurring charge",
        ),
    ),
    PlanId.MONTHLY: Plan(
        id=PlanId.MONTHLY,
        name="Monthly",
        description="Unlimited exports while your subscription is active.",
        price_usd=30.00,
        interval="month",
        deck_exports=None,
        features=(
            "Everything in Free",
            "Unlimited exports",
            "Embedded fonts",
            "Cancel any time",
        ),
    ),
    PlanId.YEARLY: Plan(
        id=PlanId.YEARLY,
        name="Yearly",
        description="Unlimited exports for a year, at a lower effective rate.",
        price_usd=99.99,
        interval="year",
        deck_exports=None,
        features=(
            "Everything in Monthly",
            "Unlimited exports for twelve months",
            "Priority support",
        ),
    ),
}


class SubscriptionModel(Base):
    """
    One row per purchase or grant. History is kept rather than overwritten,
    so a lapsed subscription, a refund, and an admin comp are all visible
    afterwards instead of being collapsed into a current-state flag.
    """
    __tablename__ = "subscriptions"

    id: Mapped[str] = mapped_column(String, primary_key=True)
    user_id: Mapped[str] = mapped_column(String, index=True, nullable=False)
    plan_id: Mapped[str] = mapped_column(String, nullable=False)
    status: Mapped[str] = mapped_column(String, nullable=False, default=SubscriptionStatus.PENDING.value)

    # Where the money came from. "admin_grant" is a first-class provider so
    # comped accounts are auditable in the same place as paid ones.
    provider: Mapped[str] = mapped_column(String, nullable=False)  # stripe | paystack | admin_grant
    provider_reference: Mapped[str | None] = mapped_column(String, nullable=True, index=True)
    amount_usd: Mapped[float | None] = mapped_column(nullable=True)
    currency: Mapped[str | None] = mapped_column(String, nullable=True)

    current_period_start: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    current_period_end: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    cancelled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    # For one-time purchases: how many exports have been consumed.
    exports_used: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    granted_by: Mapped[str | None] = mapped_column(String, nullable=True)
    note: Mapped[str | None] = mapped_column(Text, nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class UsageModel(Base):
    """
    An append-only record of billable actions.

    Kept separate from the subscription so that usage survives a plan change
    and so the admin view can answer "what has this person actually done"
    without inferring it from deck rows.
    """
    __tablename__ = "usage_events"

    id: Mapped[str] = mapped_column(String, primary_key=True)
    user_id: Mapped[str] = mapped_column(String, index=True, nullable=False)
    event: Mapped[str] = mapped_column(String, nullable=False)   # deck_export | deck_created | repo_analyzed
    deck_id: Mapped[str | None] = mapped_column(String, nullable=True)
    subscription_id: Mapped[str | None] = mapped_column(String, nullable=True)
    detail: Mapped[str | None] = mapped_column(String, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class UserFlagsModel(Base):
    """
    Per-user state that isn't part of a subscription: admin rights, and a
    record of which single deck a one-time purchase was spent on.
    """
    __tablename__ = "user_flags"

    user_id: Mapped[str] = mapped_column(String, primary_key=True)
    is_admin: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    email: Mapped[str | None] = mapped_column(String, nullable=True)
    display_name: Mapped[str | None] = mapped_column(String, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


# ---------------------------------------------------------------------------
# Entitlement
# ---------------------------------------------------------------------------

@dataclass
class Entitlement:
    plan: Plan
    can_export: bool
    reason: str
    subscription_id: str | None = None
    exports_remaining: int | None = None     # None means unlimited
    period_end: datetime | None = None


    @property
    def is_paid(self) -> bool:
        return self.plan.id != PlanId.FREE


def _now() -> datetime:
    return datetime.now(timezone.utc)


def period_end_for(plan: Plan, start: datetime) -> datetime | None:
    if plan.interval == "month":
        return start + timedelta(days=30)
    if plan.interval == "year":
        return start + timedelta(days=365)
    return None


def evaluate_entitlement(subscriptions: list[SubscriptionModel]) -> Entitlement:
    """
    Works out what a user is entitled to right now.

    Subscriptions are evaluated newest-first and the first one that is
    genuinely usable wins. A cancelled subscription still grants access
    until its period ends, which is what the customer paid for, and a
    one-time purchase stays valid until its single export is consumed
    rather than expiring on a clock.
    """
    now = _now()
    usable_recurring: list[SubscriptionModel] = []
    usable_one_time: list[SubscriptionModel] = []

    for sub in sorted(subscriptions, key=lambda s: s.created_at or now, reverse=True):
        if sub.status in (SubscriptionStatus.PENDING.value, SubscriptionStatus.REFUNDED.value, SubscriptionStatus.EXPIRED.value):
            continue
        plan = PLANS.get(PlanId(sub.plan_id)) if sub.plan_id in {p.value for p in PlanId} else None
        if not plan:
            continue

        if plan.interval:
            # Active or cancelled-but-unexpired both grant access.
            if sub.current_period_end and sub.current_period_end > now:
                usable_recurring.append(sub)
        else:
            if plan.deck_exports is not None and sub.exports_used < plan.deck_exports:
                usable_one_time.append(sub)

    # An unlimited plan beats a one-time credit, so a subscriber's credit
    # isn't silently burned while they're already paying monthly.
    if usable_recurring:
        sub = usable_recurring[0]
        plan = PLANS[PlanId(sub.plan_id)]
        return Entitlement(
            plan=plan,
            can_export=True,
            reason=f"{plan.name} plan active",
            subscription_id=sub.id,
            exports_remaining=None,
            period_end=sub.current_period_end,
        )

    if usable_one_time:
        sub = usable_one_time[0]
        plan = PLANS[PlanId(sub.plan_id)]
        remaining = (plan.deck_exports or 0) - sub.exports_used
        return Entitlement(
            plan=plan,
            can_export=True,
            reason=f"{remaining} export remaining on your single-deck purchase",
            subscription_id=sub.id,
            exports_remaining=remaining,
        )

    return Entitlement(
        plan=PLANS[PlanId.FREE],
        can_export=False,
        reason="Exporting requires a plan. Your deck is saved and stays editable.",
        exports_remaining=0,
    )


def plan_to_dict(plan: Plan) -> dict:
    return {
        "id": plan.id.value,
        "name": plan.name,
        "description": plan.description,
        "price_usd": plan.price_usd,
        "interval": plan.interval,
        "deck_exports": plan.deck_exports,
        "features": list(plan.features),
    }


def entitlement_to_dict(e: Entitlement) -> dict:
    return {
        "plan": plan_to_dict(e.plan),
        "can_export": e.can_export,
        "reason": e.reason,
        "is_paid": e.is_paid,
        "exports_remaining": e.exports_remaining,
        "period_end": e.period_end.isoformat() if e.period_end else None,
        "subscription_id": e.subscription_id,
    }
