"""
Deck-review finding actions.

The review is computed in the browser, so these endpoints just persist which
findings a user has marked Done or Ignored, so that state survives a reload
instead of living only in sessionStorage. Everything is scoped to the current
user; a user can only read or change their own actions.
"""
import uuid
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select, delete

from app.core.db import AsyncSessionLocal
from app.core.deps import get_current_user_id
from app.models.deck import DeckModel
from app.models.review import ReviewFindingAction

router = APIRouter(prefix="/review", tags=["review"])


class FindingActionIn(BaseModel):
    deck_id: str
    finding_id: str
    action: Literal["done", "ignored"]


class FindingActionDelete(BaseModel):
    deck_id: str
    finding_id: str


@router.post("/findings/action")
async def save_finding_action(body: FindingActionIn, user_id: str = Depends(get_current_user_id)):
    """Upsert the action for this (user, deck, finding)."""
    deck_id = body.deck_id.strip()
    finding_id = body.finding_id.strip()
    if not deck_id or not finding_id:
        raise HTTPException(400, "deck_id and finding_id are required.")

    async with AsyncSessionLocal() as session:
        deck = await session.get(DeckModel, deck_id)
        if not deck or deck.user_id != user_id:
            raise HTTPException(404, "Deck not found")

        existing = (await session.execute(
            select(ReviewFindingAction).where(
                ReviewFindingAction.user_id == user_id,
                ReviewFindingAction.deck_id == deck_id,
                ReviewFindingAction.finding_id == finding_id,
            )
        )).scalars().first()

        if existing:
            existing.action = body.action
        else:
            session.add(ReviewFindingAction(
                id=str(uuid.uuid4()),
                user_id=user_id,
                deck_id=deck_id,
                finding_id=finding_id,
                action=body.action,
            ))
        await session.commit()
    return {"success": True}


@router.delete("/findings/action")
async def delete_finding_action(body: FindingActionDelete, user_id: str = Depends(get_current_user_id)):
    """Remove the action (un-done / un-ignore). Idempotent."""
    deck_id = body.deck_id.strip()
    finding_id = body.finding_id.strip()
    if not deck_id or not finding_id:
        raise HTTPException(400, "deck_id and finding_id are required.")

    async with AsyncSessionLocal() as session:
        await session.execute(
            delete(ReviewFindingAction).where(
                ReviewFindingAction.user_id == user_id,
                ReviewFindingAction.deck_id == deck_id,
                ReviewFindingAction.finding_id == finding_id,
            )
        )
        await session.commit()
    return {"success": True}


@router.get("/{deck_id}/finding-actions")
async def list_finding_actions(deck_id: str, user_id: str = Depends(get_current_user_id)):
    """Every finding this user has acted on for this deck."""
    async with AsyncSessionLocal() as session:
        rows = (await session.execute(
            select(ReviewFindingAction).where(
                ReviewFindingAction.user_id == user_id,
                ReviewFindingAction.deck_id == deck_id,
            )
        )).scalars().all()
    return {"actions": [{"finding_id": r.finding_id, "action": r.action} for r in rows]}
