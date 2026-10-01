"""
Support conversations and the mailing list.

Two audiences hit this router. The founder, authenticated with a Supabase
JWT, can read and write their own thread and nothing else. The controller
app, authenticated with the shared admin key, can read every thread and
reply. The two paths are kept visibly separate so a founder can never reach
an admin route by sending an unexpected header.
"""
from fastapi import APIRouter, Depends, HTTPException, Request, File, Form, UploadFile
from pydantic import BaseModel
from sqlalchemy import select, update, func

from app.core.db import AsyncSessionLocal
from app.core.deps import get_current_user_id, get_current_user_id_optional
from app.models.support import SupportMessageModel
from app.models.billing import UserFlagsModel
from app.routers.billing import _check_admin_key, require_admin
from app.services.support_storage import upload_support_attachment

router = APIRouter(tags=["support"])
admin = APIRouter(prefix="/admin", tags=["support-admin"])

MAX_BODY = 4000

#: Attachment limits for support screenshots.
MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024  # 5MB
ALLOWED_ATTACHMENT_TYPES = {
    "image/png", "image/jpeg", "image/jpg", "image/gif", "image/webp",
    "application/pdf",
}


class SendMessage(BaseModel):
    body: str


class OptIn(BaseModel):
    opt_in: bool
    email: str = ""


def _serialise(m: SupportMessageModel) -> dict:
    return {
        "id": m.id,
        "sender": m.sender,
        "body": m.body,
        "attachment_path": m.attachment_path,
        "created_at": m.created_at.isoformat() if m.created_at else None,
    }


# ── Founder side ───────────────────────────────────────────────────────────

@router.get("/support/messages")
async def my_messages(user_id: str = Depends(get_current_user_id)):
    """The founder's own thread. Reading it marks admin replies as seen."""
    async with AsyncSessionLocal() as session:
        rows = (await session.execute(
            select(SupportMessageModel)
            .where(SupportMessageModel.user_id == user_id)
            .order_by(SupportMessageModel.created_at.asc())
            .limit(200)
        )).scalars().all()

        await session.execute(
            update(SupportMessageModel)
            .where(
                SupportMessageModel.user_id == user_id,
                SupportMessageModel.sender == "admin",
                SupportMessageModel.read_by_user == False,  # noqa: E712
            )
            .values(read_by_user=True)
        )
        await session.commit()
        return [_serialise(m) for m in rows]


@router.get("/support/unread")
async def my_unread(user_id: str = Depends(get_current_user_id)):
    """Cheap poll for the widget's badge — a count, not the whole thread."""
    async with AsyncSessionLocal() as session:
        n = (await session.execute(
            select(func.count(SupportMessageModel.id)).where(
                SupportMessageModel.user_id == user_id,
                SupportMessageModel.sender == "admin",
                SupportMessageModel.read_by_user == False,  # noqa: E712
            )
        )).scalar() or 0
        return {"unread": n}


@router.post("/support/messages")
async def send_message(
    message: str = Form(...),
    screenshot: UploadFile | None = File(None),
    user_id: str = Depends(get_current_user_id),
):
    """
    Posts a support message, optionally with a screenshot/PDF attachment.

    Accepts multipart/form-data: `message` (text) and optional `screenshot`
    (file). A failed attachment upload never blocks the message — it's saved
    without the attachment and the error is logged.
    """
    text = (message or "").strip()
    if not text:
        raise HTTPException(400, "Message is empty.")
    if len(text) > MAX_BODY:
        raise HTTPException(400, f"Message is too long (limit {MAX_BODY} characters).")

    # Validate and read the attachment up front (before touching the DB), so a
    # bad file is rejected cleanly rather than leaving a half-saved message.
    attachment_bytes: bytes | None = None
    attachment_name = ""
    attachment_type = ""
    if screenshot is not None and screenshot.filename:
        attachment_type = (screenshot.content_type or "").lower()
        if attachment_type not in ALLOWED_ATTACHMENT_TYPES:
            raise HTTPException(400, "Attachment must be a PNG, JPG, GIF, WebP, or PDF.")
        attachment_bytes = await screenshot.read()
        if len(attachment_bytes) > MAX_ATTACHMENT_BYTES:
            raise HTTPException(400, "Attachment is too large (limit 5MB).")
        attachment_name = screenshot.filename

    # Upload the attachment first so the stored path can be saved on the row.
    # A failure returns None and is logged inside the service — never fatal.
    attachment_path = None
    if attachment_bytes is not None:
        attachment_path = await upload_support_attachment(
            user_id, attachment_name, attachment_type, attachment_bytes
        )

    async with AsyncSessionLocal() as session:
        flags = await session.get(UserFlagsModel, user_id)
        msg = SupportMessageModel(
            user_id=user_id, sender="user", body=text,
            user_email=(flags.email if flags else None),
            attachment_path=attachment_path,
            read_by_user=True, read_by_admin=False,
        )
        session.add(msg)
        await session.commit()
        await session.refresh(msg)
        return _serialise(msg)


@router.post("/me/marketing-optin")
async def set_marketing_optin(body: OptIn, user_id: str = Depends(get_current_user_id)):
    """
    Records the mailing-list choice made at sign-up.

    Called once the session exists, because at sign-up time the account is
    not yet confirmed and has no token to authenticate with. The choice
    itself travels in the user's Supabase metadata until then.
    """
    async with AsyncSessionLocal() as session:
        flags = await session.get(UserFlagsModel, user_id)
        if flags is None:
            flags = UserFlagsModel(user_id=user_id, is_admin=False)
            session.add(flags)
        flags.marketing_opt_in = bool(body.opt_in)
        if body.email and not flags.email:
            flags.email = body.email
        await session.commit()
        return {"ok": True, "opt_in": bool(body.opt_in)}


# ── Controller side ────────────────────────────────────────────────────────

async def _require_controller(request: Request, user_id: str | None) -> None:
    """Admin key, or an admin user's own JWT. Anything else is a 403."""
    if _check_admin_key(request):
        return
    if not user_id:
        raise HTTPException(status_code=403, detail="Not authorised")
    async with AsyncSessionLocal() as session:
        await require_admin(session, user_id)


@admin.get("/support/threads")
async def list_threads(request: Request, user_id: str = Depends(get_current_user_id_optional)):
    """
    One row per founder who has ever written in, newest activity first, with
    the unread count so the controller can show what still needs a reply.
    """
    await _require_controller(request, user_id)
    async with AsyncSessionLocal() as session:
        rows = (await session.execute(
            select(SupportMessageModel)
            .order_by(SupportMessageModel.created_at.desc())
            .limit(1000)
        )).scalars().all()

        threads: dict[str, dict] = {}
        for m in rows:  # newest first, so the first one seen is the latest
            t = threads.setdefault(m.user_id, {
                "user_id": m.user_id,
                "email": m.user_email or m.user_id[:12],
                "last_message": m.body[:140],
                "last_sender": m.sender,
                "last_at": m.created_at.isoformat() if m.created_at else None,
                "unread": 0,
                "messages": 0,
            })
            if m.user_email and t["email"].startswith(m.user_id[:8]):
                t["email"] = m.user_email
            t["messages"] += 1
            if m.sender == "user" and not m.read_by_admin:
                t["unread"] += 1
        return list(threads.values())


@admin.get("/support/threads/{thread_user_id}")
async def read_thread(
    thread_user_id: str,
    request: Request,
    user_id: str = Depends(get_current_user_id_optional),
):
    await _require_controller(request, user_id)
    async with AsyncSessionLocal() as session:
        rows = (await session.execute(
            select(SupportMessageModel)
            .where(SupportMessageModel.user_id == thread_user_id)
            .order_by(SupportMessageModel.created_at.asc())
            .limit(500)
        )).scalars().all()

        await session.execute(
            update(SupportMessageModel)
            .where(
                SupportMessageModel.user_id == thread_user_id,
                SupportMessageModel.sender == "user",
                SupportMessageModel.read_by_admin == False,  # noqa: E712
            )
            .values(read_by_admin=True)
        )
        await session.commit()
        return [_serialise(m) for m in rows]


@admin.post("/support/threads/{thread_user_id}/reply")
async def reply_to_thread(
    thread_user_id: str,
    body: SendMessage,
    request: Request,
    user_id: str = Depends(get_current_user_id_optional),
):
    await _require_controller(request, user_id)
    text = (body.body or "").strip()
    if not text:
        raise HTTPException(400, "Reply is empty.")

    async with AsyncSessionLocal() as session:
        flags = await session.get(UserFlagsModel, thread_user_id)
        msg = SupportMessageModel(
            user_id=thread_user_id, sender="admin", body=text[:MAX_BODY],
            user_email=(flags.email if flags else None),
            read_by_user=False, read_by_admin=True,
        )
        session.add(msg)
        await session.commit()
        await session.refresh(msg)
        return _serialise(msg)


@admin.get("/mailing-list")
async def mailing_list(request: Request, user_id: str = Depends(get_current_user_id_optional)):
    """Everyone who opted in, for export into Resend or any other sender."""
    await _require_controller(request, user_id)
    async with AsyncSessionLocal() as session:
        rows = (await session.execute(
            select(UserFlagsModel).where(UserFlagsModel.marketing_opt_in == True)  # noqa: E712
        )).scalars().all()
        return [
            {"user_id": f.user_id, "email": f.email, "name": f.display_name}
            for f in rows if f.email
        ]
