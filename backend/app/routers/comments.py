"""
Slide comments.

Access mirrors the deck's own sharing: a comment is visible to the deck
owner and to any collaborator in the owner's workspace with the "commenter"
role or above. A plain "viewer" can see and export decks but not their
feedback threads, so viewers are excluded here.

Editing, resolving, and deleting a comment are limited to its author or the
deck owner — a collaborator can't rewrite or clear someone else's note.

See app/models/comments.py for the data shape and app/routers/decks.py for
the parallel workspace-permission model.
"""
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy import select

from app.core.deps import get_current_user_id
from app.core.db import AsyncSessionLocal
from app.models.deck import DeckModel
from app.models.comments import SlideCommentModel
from app.models.collaboration import CollaboratorModel
from app.models.billing import UserFlagsModel

router = APIRouter(prefix="/decks", tags=["comments"])


# Comment capability ladder. Unlike the deck-read ladder (where viewer and
# commenter are equal), here a commenter can do something a viewer can't:
# see and leave comments. Owner is implicit full access.
_COMMENT_RANK = {"viewer": 0, "commenter": 1, "editor": 2, "manager": 3, "admin": 4}
_MIN_TO_COMMENT = _COMMENT_RANK["commenter"]


class CreateCommentBody(BaseModel):
    slide_id: str
    content: str


class PatchCommentBody(BaseModel):
    resolved: bool | None = None
    content: str | None = None


def _now() -> datetime:
    return datetime.now(timezone.utc)


async def _author_identity(session, user_id: str) -> dict:
    """Name/email for an author, from the user_flags row we already keep."""
    flags = await session.get(UserFlagsModel, user_id)
    email = (flags.email if flags else None) or None
    name = (flags.display_name if flags else None) or None
    return {
        "name": name or (email.split("@")[0] if email else user_id[:12]),
        "email": email,
    }


def _serialise(c: SlideCommentModel, identity: dict) -> dict:
    return {
        "id": c.id,
        "deck_id": c.deck_id,
        "slide_id": c.slide_id,
        "user_id": c.user_id,
        "content": c.content,
        "resolved": c.resolved,
        "created_at": c.created_at.isoformat() if c.created_at else None,
        "updated_at": c.updated_at.isoformat() if c.updated_at else None,
        "author_name": identity["name"],
        "author_email": identity["email"],
    }


async def _resolve_access(session, deck_id: str, current_user: str) -> tuple[DeckModel, str]:
    """Locate the deck and the caller's role on it.

    Returns (deck, role) where role is "owner" for the deck owner, otherwise
    the collaborator's role. Raises 404 if the deck doesn't exist and 403 if
    the caller has no accepted membership in the owner's workspace.
    """
    deck = await session.get(DeckModel, deck_id)
    if not deck:
        raise HTTPException(status_code=404, detail="Deck not found.")

    if deck.user_id == current_user:
        return deck, "owner"

    collab = (await session.execute(
        select(CollaboratorModel).where(
            CollaboratorModel.owner_id == deck.user_id,
            CollaboratorModel.invitee_user_id == current_user,
            CollaboratorModel.status == "accepted",
        )
    )).scalars().first()
    if not collab:
        raise HTTPException(status_code=403, detail="You don't have access to this deck.")
    return deck, collab.role


def _can_comment(role: str) -> bool:
    """Owner, or a collaborator ranked commenter or above."""
    if role == "owner":
        return True
    return _COMMENT_RANK.get(role, -1) >= _MIN_TO_COMMENT


@router.get("/{deck_id}/comments")
async def list_comments(deck_id: str, request: Request, user_id: str = Depends(get_current_user_id)):
    """All unresolved comments for the deck, grouped by slide_id. Includes a
    flat list too, which is what the editor consumes directly."""
    async with AsyncSessionLocal() as session:
        _, role = await _resolve_access(session, deck_id, user_id)
        if not _can_comment(role):
            raise HTTPException(status_code=403, detail="Your role doesn't include comments.")

        rows = (await session.execute(
            select(SlideCommentModel)
            .where(
                SlideCommentModel.deck_id == deck_id,
                SlideCommentModel.resolved == False,  # noqa: E712
            )
            .order_by(SlideCommentModel.created_at.asc())
        )).scalars().all()

        # Resolve each distinct author once.
        identities: dict[str, dict] = {}
        for c in rows:
            if c.user_id not in identities:
                identities[c.user_id] = await _author_identity(session, c.user_id)

        comments = [_serialise(c, identities[c.user_id]) for c in rows]
        by_slide: dict[str, list[dict]] = {}
        for c in comments:
            by_slide.setdefault(c["slide_id"], []).append(c)

        return {"comments": comments, "by_slide": by_slide}


@router.post("/{deck_id}/comments")
async def create_comment(
    deck_id: str,
    body: CreateCommentBody,
    request: Request,
    user_id: str = Depends(get_current_user_id),
):
    slide_id = (body.slide_id or "").strip()
    content = (body.content or "").strip()
    if not slide_id:
        raise HTTPException(status_code=400, detail="A slide is required.")
    if not content:
        raise HTTPException(status_code=400, detail="A comment can't be empty.")

    async with AsyncSessionLocal() as session:
        _, role = await _resolve_access(session, deck_id, user_id)
        if not _can_comment(role):
            raise HTTPException(status_code=403, detail="Your role doesn't include comments.")

        comment = SlideCommentModel(
            deck_id=deck_id,
            slide_id=slide_id,
            user_id=user_id,
            content=content,
            resolved=False,
        )
        session.add(comment)
        await session.commit()
        await session.refresh(comment)
        identity = await _author_identity(session, user_id)
        return _serialise(comment, identity)


@router.patch("/{deck_id}/comments/{comment_id}")
async def patch_comment(
    deck_id: str,
    comment_id: str,
    body: PatchCommentBody,
    request: Request,
    user_id: str = Depends(get_current_user_id),
):
    async with AsyncSessionLocal() as session:
        deck, role = await _resolve_access(session, deck_id, user_id)
        if not _can_comment(role):
            raise HTTPException(status_code=403, detail="Your role doesn't include comments.")

        comment = await session.get(SlideCommentModel, comment_id)
        if not comment or comment.deck_id != deck_id:
            raise HTTPException(status_code=404, detail="Comment not found.")

        # Only the author or the deck owner may edit or resolve.
        is_owner = deck.user_id == user_id
        if comment.user_id != user_id and not is_owner:
            raise HTTPException(status_code=403, detail="Only the author or deck owner can change this comment.")

        if body.content is not None:
            content = body.content.strip()
            if not content:
                raise HTTPException(status_code=400, detail="A comment can't be empty.")
            comment.content = content
        if body.resolved is not None:
            comment.resolved = body.resolved

        await session.commit()
        await session.refresh(comment)
        identity = await _author_identity(session, comment.user_id)
        return _serialise(comment, identity)


@router.delete("/{deck_id}/comments/{comment_id}")
async def delete_comment(
    deck_id: str,
    comment_id: str,
    request: Request,
    user_id: str = Depends(get_current_user_id),
):
    async with AsyncSessionLocal() as session:
        deck, role = await _resolve_access(session, deck_id, user_id)
        if not _can_comment(role):
            raise HTTPException(status_code=403, detail="Your role doesn't include comments.")

        comment = await session.get(SlideCommentModel, comment_id)
        if not comment or comment.deck_id != deck_id:
            raise HTTPException(status_code=404, detail="Comment not found.")

        is_owner = deck.user_id == user_id
        if comment.user_id != user_id and not is_owner:
            raise HTTPException(status_code=403, detail="Only the author or deck owner can delete this comment.")

        await session.delete(comment)
        await session.commit()
        return {"ok": True}
