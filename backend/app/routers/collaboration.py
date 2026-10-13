"""
Workspace collaboration: inviting people into your account, managing their
roles, and accepting invitations.

Authorisation model is deliberately simple and owner-centric: every member
belongs to exactly one owner's workspace (owner_id). Only the owner can
invite, change roles, or remove members in their own workspace. The owner is
implied by owner_id and is never a CollaboratorModel row, so "cannot change /
remove the owner" falls out for free — there is simply no member row to touch.

See app/models/collaboration.py for the data shape.
"""
import logging
import secrets
from datetime import datetime, timezone

import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select

from app.core.config import settings
from app.core.db import AsyncSessionLocal
from app.core.deps import get_current_user_id
from app.models.billing import UserFlagsModel
from app.models.collaboration import CollaboratorModel, ROLES

log = logging.getLogger(__name__)

router = APIRouter(prefix="/collaboration", tags=["collaboration"])


# ── Request bodies ───────────────────────────────────────────────────────────

class InviteBody(BaseModel):
    email: str
    role: str


class RoleBody(BaseModel):
    role: str


# ── Helpers ──────────────────────────────────────────────────────────────────

def _now() -> datetime:
    return datetime.now(timezone.utc)


def _validate_role(role: str) -> str:
    role = (role or "").strip().lower()
    if role not in ROLES:
        raise HTTPException(400, f"Invalid role. Must be one of: {', '.join(ROLES)}.")
    return role


async def _user_identity(session, user_id: str) -> dict:
    """Best-effort name/email for a user_id, from the user_flags row we already
    keep. Falls back to the id when we have nothing nicer to show."""
    flags = await session.get(UserFlagsModel, user_id)
    email = (flags.email if flags else None) or None
    name = (flags.display_name if flags else None) or None
    return {
        "user_id": user_id,
        "email": email,
        "name": name or (email.split("@")[0] if email else user_id[:12]),
    }


def _serialise(c: CollaboratorModel, identity: dict | None = None) -> dict:
    out = {
        "id": c.id,
        "owner_id": c.owner_id,
        "invitee_email": c.invitee_email,
        "invitee_user_id": c.invitee_user_id,
        "role": c.role,
        "status": c.status,
        "invited_at": c.invited_at.isoformat() if c.invited_at else None,
        "accepted_at": c.accepted_at.isoformat() if c.accepted_at else None,
        "is_owner": False,
    }
    if identity:
        out["name"] = identity.get("name")
        # Prefer the stored invite email, but surface the account email if we
        # learned it after they accepted.
        out["email"] = c.invitee_email or identity.get("email")
    else:
        out["name"] = c.invitee_email.split("@")[0] if c.invitee_email else "Invited user"
        out["email"] = c.invitee_email
    return out


async def _owner_name(session, user_id: str) -> str:
    identity = await _user_identity(session, user_id)
    return identity["name"]


async def _email_has_account(email: str) -> bool | None:
    """Whether a Supabase account already exists for this email.

    Returns True/False, or None when we genuinely can't tell (admin API not
    configured, or the call failed). Callers treat None conservatively. Uses
    the same Admin API + service-role key the MFA check already relies on.
    """
    if not settings.supabase_url or not settings.supabase_service_role_key:
        return None
    headers = {
        "apikey": settings.supabase_service_role_key,
        "Authorization": f"Bearer {settings.supabase_service_role_key}",
    }
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            # GoTrue's admin list endpoint is paginated; scan a bounded number
            # of pages rather than the whole table. For the scale here this is
            # plenty, and it never loops unboundedly.
            for page in range(1, 11):
                resp = await client.get(
                    f"{settings.supabase_url}/auth/v1/admin/users",
                    headers=headers,
                    params={"page": page, "per_page": 200},
                )
                resp.raise_for_status()
                data = resp.json()
                users = data.get("users", data if isinstance(data, list) else [])
                if not users:
                    break
                for u in users:
                    if (u.get("email") or "").lower() == email.lower():
                        return True
                if len(users) < 200:
                    break
        return False
    except Exception as exc:  # noqa: BLE001 — never let this break the flow
        log.warning("Could not check account existence for invite: %s", exc)
        return None


async def _send_invite_email(to_email: str, owner_name: str, token: str) -> bool:
    """Send the invite email via Resend, mirroring services/email.py. Best
    effort: a failure is logged and never blocks creating the invite."""
    api_key = getattr(settings, "email_api_key", "")
    sender = getattr(settings, "email_from", "") or "noreply@provisio.site"
    link = f"{settings.frontend_url.rstrip('/')}/invite/{token}"
    subject = f"You've been invited to {owner_name}'s Provisio workspace"

    if not api_key:
        log.info(
            "Invite email not sent (no EMAIL_API_KEY configured): to=%s link=%s subject=%r",
            to_email, link, subject,
        )
        return False

    payload = {
        "from": sender,
        "to": [to_email],
        "subject": subject,
        "html": (
            f"<h2>You've been invited to {owner_name}'s Provisio workspace</h2>"
            f"<p>{owner_name} has invited you to collaborate on Provisio.</p>"
            f"<p><a href='{link}'>Accept the invitation</a></p>"
            f"<p>Or paste this link into your browser:<br>{link}</p>"
            "<p>— The Provisio team</p>"
        ),
        "text": (
            f"{owner_name} has invited you to collaborate on their Provisio "
            f"workspace. Accept here: {link}"
        ),
    }
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            res = await client.post(
                "https://api.resend.com/emails",
                json=payload,
                headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
            )
        if res.status_code in (200, 201, 202):
            return True
        log.warning("Invite email rejected: to=%s status=%s body=%s", to_email, res.status_code, res.text[:300])
        return False
    except Exception:
        log.warning("Invite email send failed: to=%s", to_email, exc_info=True)
        return False


# ── Invites & members (owner side) ────────────────────────────────────────────

@router.post("/invite")
async def invite(body: InviteBody, user_id: str = Depends(get_current_user_id)):
    """Invite someone into the current user's workspace."""
    email = (body.email or "").strip().lower()
    if not email or "@" not in email:
        raise HTTPException(400, "A valid email address is required.")
    role = _validate_role(body.role)

    async with AsyncSessionLocal() as session:
        # Don't let an owner invite themselves.
        me = await _user_identity(session, user_id)
        if me["email"] and me["email"].lower() == email:
            raise HTTPException(400, "You already own this workspace.")

        # Reuse any existing non-revoked invite for this email in this
        # workspace rather than creating duplicates.
        existing = (await session.execute(
            select(CollaboratorModel).where(
                CollaboratorModel.owner_id == user_id,
                CollaboratorModel.invitee_email == email,
                CollaboratorModel.status != "revoked",
            )
        )).scalars().first()
        if existing:
            raise HTTPException(409, "That person has already been invited to this workspace.")

        token = secrets.token_urlsafe(32)
        collab = CollaboratorModel(
            owner_id=user_id,
            invitee_email=email,
            role=role,
            status="pending",
            invite_token=token,
            invited_at=_now(),
        )
        session.add(collab)
        await session.commit()
        await session.refresh(collab)

        owner_name = me["name"]

    # Send the email outside the DB session; failure is non-fatal.
    await _send_invite_email(email, owner_name, token)
    return _serialise(collab)


@router.get("/members")
async def members(user_id: str = Depends(get_current_user_id)):
    """All members of the current user's workspace, with the owner first."""
    async with AsyncSessionLocal() as session:
        owner_identity = await _user_identity(session, user_id)
        rows = (await session.execute(
            select(CollaboratorModel)
            .where(
                CollaboratorModel.owner_id == user_id,
                CollaboratorModel.status != "revoked",
            )
            .order_by(CollaboratorModel.invited_at.asc())
        )).scalars().all()

        members_out = [{
            "id": f"owner:{user_id}",
            "owner_id": user_id,
            "invitee_user_id": user_id,
            "name": owner_identity["name"],
            "email": owner_identity["email"],
            "role": "owner",
            "status": "accepted",
            "is_owner": True,
            "invited_at": None,
            "accepted_at": None,
        }]

        for c in rows:
            identity = None
            if c.invitee_user_id:
                identity = await _user_identity(session, c.invitee_user_id)
            members_out.append(_serialise(c, identity))

        return members_out


@router.patch("/members/{collaborator_id}")
async def update_member_role(
    collaborator_id: str,
    body: RoleBody,
    user_id: str = Depends(get_current_user_id),
):
    """Change a member's role. Owner only; the owner's own role can't change
    (there is no owner member row to target)."""
    role = _validate_role(body.role)
    async with AsyncSessionLocal() as session:
        collab = await session.get(CollaboratorModel, collaborator_id)
        if not collab or collab.owner_id != user_id or collab.status == "revoked":
            raise HTTPException(404, "Member not found.")
        collab.role = role
        await session.commit()
        await session.refresh(collab)
        identity = await _user_identity(session, collab.invitee_user_id) if collab.invitee_user_id else None
        return _serialise(collab, identity)


@router.delete("/members/{collaborator_id}")
async def remove_member(collaborator_id: str, user_id: str = Depends(get_current_user_id)):
    """Remove a member from the workspace. Owner only."""
    async with AsyncSessionLocal() as session:
        collab = await session.get(CollaboratorModel, collaborator_id)
        if not collab or collab.owner_id != user_id:
            raise HTTPException(404, "Member not found.")
        collab.status = "revoked"
        await session.commit()
        return {"ok": True}


@router.get("/invites/pending")
async def pending_invites(user_id: str = Depends(get_current_user_id)):
    """Invites sent by the current user that haven't been accepted yet."""
    async with AsyncSessionLocal() as session:
        rows = (await session.execute(
            select(CollaboratorModel)
            .where(
                CollaboratorModel.owner_id == user_id,
                CollaboratorModel.status == "pending",
            )
            .order_by(CollaboratorModel.invited_at.desc())
        )).scalars().all()
        return [_serialise(c) for c in rows]


@router.delete("/invites/{collaborator_id}")
async def revoke_invite(collaborator_id: str, user_id: str = Depends(get_current_user_id)):
    """Revoke a pending invite. Owner only."""
    async with AsyncSessionLocal() as session:
        collab = await session.get(CollaboratorModel, collaborator_id)
        if not collab or collab.owner_id != user_id:
            raise HTTPException(404, "Invite not found.")
        if collab.status != "pending":
            raise HTTPException(409, "Only pending invites can be revoked.")
        collab.status = "revoked"
        await session.commit()
        return {"ok": True}


# ── Workspaces (invitee side) ─────────────────────────────────────────────────

@router.get("/workspaces")
async def my_workspaces(user_id: str = Depends(get_current_user_id)):
    """Workspaces the current user has accepted an invite into."""
    async with AsyncSessionLocal() as session:
        rows = (await session.execute(
            select(CollaboratorModel)
            .where(
                CollaboratorModel.invitee_user_id == user_id,
                CollaboratorModel.status == "accepted",
            )
            .order_by(CollaboratorModel.accepted_at.asc())
        )).scalars().all()

        out = []
        for c in rows:
            owner_identity = await _user_identity(session, c.owner_id)
            out.append({
                "owner_id": c.owner_id,
                "owner_name": owner_identity["name"],
                "owner_email": owner_identity["email"],
                "role": c.role,
                "accepted_at": c.accepted_at.isoformat() if c.accepted_at else None,
            })
        return out


# ── Accept flow ───────────────────────────────────────────────────────────────

@router.get("/accept/{token}")
async def accept_info(token: str):
    """Public: describe an invite so the frontend can render the right UI.

    Returns whether the invitee needs to create an account first. No auth —
    the person following the link may not be logged in (or may not have an
    account at all) yet.
    """
    async with AsyncSessionLocal() as session:
        collab = (await session.execute(
            select(CollaboratorModel).where(CollaboratorModel.invite_token == token)
        )).scalars().first()
        if not collab:
            raise HTTPException(404, "This invitation link is not valid.")
        if collab.status == "revoked":
            raise HTTPException(410, "This invitation has been revoked.")

        owner_name = await _owner_name(session, collab.owner_id)

        if collab.status == "accepted":
            return {
                "already_accepted": True,
                "requires_signup": False,
                "email": collab.invitee_email,
                "owner_name": owner_name,
                "role": collab.role,
            }

        has_account = await _email_has_account(collab.invitee_email)
        # None (unknown) → don't force a signup form; let them try to log in and
        # POST accept, which is the safe default.
        requires_signup = has_account is False

        return {
            "already_accepted": False,
            "requires_signup": requires_signup,
            "email": collab.invitee_email,
            "owner_name": owner_name,
            "role": collab.role,
        }


@router.post("/accept/{token}")
async def accept_invite(token: str, user_id: str = Depends(get_current_user_id)):
    """Accept an invite as the logged-in user. The account may have just been
    created by the frontend signup step; either way the current user becomes
    the invitee."""
    async with AsyncSessionLocal() as session:
        collab = (await session.execute(
            select(CollaboratorModel).where(CollaboratorModel.invite_token == token)
        )).scalars().first()
        if not collab:
            raise HTTPException(404, "This invitation link is not valid.")
        if collab.status == "revoked":
            raise HTTPException(410, "This invitation has been revoked.")

        owner_name = await _owner_name(session, collab.owner_id)

        if collab.status == "accepted":
            # Idempotent: if this same user already accepted, just report it.
            if collab.invitee_user_id == user_id:
                return {
                    "ok": True,
                    "already_accepted": True,
                    "owner_id": collab.owner_id,
                    "owner_name": owner_name,
                    "role": collab.role,
                }
            raise HTTPException(409, "This invitation has already been accepted.")

        collab.invitee_user_id = user_id
        collab.status = "accepted"
        collab.accepted_at = _now()
        await session.commit()

        return {
            "ok": True,
            "already_accepted": False,
            "owner_id": collab.owner_id,
            "owner_name": owner_name,
            "role": collab.role,
        }
