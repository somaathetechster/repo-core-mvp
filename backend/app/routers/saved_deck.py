"""
Save and load the founder's edited deck (slides, theme, freeform layouts).
Separate from /deck/generate, which builds a fresh deck from scratch.
"""
from typing import Any
from pydantic import BaseModel
from fastapi import APIRouter, Depends

from app.core.deps import get_current_user_id
from app.core.db import AsyncSessionLocal
from app.models.saved_deck import SavedDeckModel

router = APIRouter(prefix="/deck", tags=["deck"])


class SaveDeckRequest(BaseModel):
    slides: list[dict[str, Any]]
    theme: dict[str, Any]
    layouts: dict[str, Any] = {}
    freeform_slide_ids: list[str] = []


@router.get("/saved")
async def get_saved_deck(user_id: str = Depends(get_current_user_id)):
    async with AsyncSessionLocal() as session:
        deck = await session.get(SavedDeckModel, user_id)
        if not deck:
            return None
        return {
            "slides": deck.slides,
            "theme": deck.theme,
            "layouts": deck.layouts,
            "freeform_slide_ids": deck.freeform_slide_ids,
            "updated_at": deck.updated_at.isoformat() if deck.updated_at else None,
        }


@router.put("/saved")
async def save_deck(body: SaveDeckRequest, user_id: str = Depends(get_current_user_id)):
    async with AsyncSessionLocal() as session:
        deck = await session.get(SavedDeckModel, user_id)
        if deck:
            deck.slides = body.slides
            deck.theme = body.theme
            deck.layouts = body.layouts
            deck.freeform_slide_ids = body.freeform_slide_ids
        else:
            deck = SavedDeckModel(
                user_id=user_id,
                slides=body.slides,
                theme=body.theme,
                layouts=body.layouts,
                freeform_slide_ids=body.freeform_slide_ids,
            )
            session.add(deck)
        await session.commit()
    return {"status": "saved"}
