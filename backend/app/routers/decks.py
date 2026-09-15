"""
Multi-deck management. Replaces the earlier single-deck-per-user model
(the old /deck/generate and /deck/saved endpoints). A user can now have
many decks, each with its own profile snapshot and repo selection.
"""
from typing import Any
from pydantic import BaseModel
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select

from app.core.deps import get_current_user_id
from app.core.db import AsyncSessionLocal
from app.models.deck import DeckModel
from app.models.company_profile import CompanyProfileModel
from app.routers.company_profile import CompanyProfileIn
from app.services.deck_builder import build_deck, slide_to_dict, theme_to_dict
from app.services.github_extract import RepoSummary

router = APIRouter(prefix="/decks", tags=["decks"])


async def _shared_profile_dict(session, user_id: str) -> dict:
    row = await session.get(CompanyProfileModel, user_id)
    if not row:
        return {}
    return {col.name: getattr(row, col.name) for col in CompanyProfileModel.__table__.columns if col.name != "user_id"}


def _deck_summary(d: DeckModel) -> dict:
    return {
        "id": d.id,
        "name": d.name,
        "slide_count": len(d.slides or []),
        "updated_at": d.updated_at.isoformat() if d.updated_at else None,
        "created_at": d.created_at.isoformat() if d.created_at else None,
    }


def _deck_full(d: DeckModel) -> dict:
    return {
        **_deck_summary(d),
        "profile_snapshot": d.profile_snapshot,
        "repo_full_names": d.repo_full_names,
        "slides": d.slides,
        "theme": d.theme,
        "layouts": d.layouts,
        "freeform_slide_ids": d.freeform_slide_ids,
    }


class CreateDeckRequest(BaseModel):
    name: str = "Untitled deck"
    use_shared_profile: bool = True
    repo_summaries: list[RepoSummary] = []


@router.get("")
async def list_decks(user_id: str = Depends(get_current_user_id)):
    async with AsyncSessionLocal() as session:
        result = await session.execute(
            select(DeckModel).where(DeckModel.user_id == user_id).order_by(DeckModel.updated_at.desc())
        )
        return [_deck_summary(d) for d in result.scalars().all()]


@router.post("")
async def create_deck(body: CreateDeckRequest, user_id: str = Depends(get_current_user_id)):
    async with AsyncSessionLocal() as session:
        profile = await _shared_profile_dict(session, user_id) if body.use_shared_profile else {}
        slide_list, deck_theme = build_deck(profile, body.repo_summaries)

        deck = DeckModel(
            user_id=user_id,
            name=body.name or "Untitled deck",
            profile_snapshot=profile,
            repo_full_names=[s.full_name for s in body.repo_summaries],
            slides=[slide_to_dict(s) for s in slide_list],
            theme=theme_to_dict(deck_theme),
            layouts={},
            freeform_slide_ids=[],
        )
        session.add(deck)
        await session.commit()
        await session.refresh(deck)
        return _deck_full(deck)


@router.get("/{deck_id}")
async def get_deck(deck_id: str, user_id: str = Depends(get_current_user_id)):
    async with AsyncSessionLocal() as session:
        deck = await session.get(DeckModel, deck_id)
        if not deck or deck.user_id != user_id:
            raise HTTPException(status_code=404, detail="Deck not found.")
        return _deck_full(deck)


class SaveDeckEditorRequest(BaseModel):
    name: str | None = None
    slides: list[dict[str, Any]]
    theme: dict[str, Any]
    layouts: dict[str, Any] = {}
    freeform_slide_ids: list[str] = []


@router.put("/{deck_id}")
async def save_deck_editor_state(deck_id: str, body: SaveDeckEditorRequest, user_id: str = Depends(get_current_user_id)):
    async with AsyncSessionLocal() as session:
        deck = await session.get(DeckModel, deck_id)
        if not deck or deck.user_id != user_id:
            raise HTTPException(status_code=404, detail="Deck not found.")
        if body.name is not None:
            deck.name = body.name
        deck.slides = body.slides
        deck.theme = body.theme
        deck.layouts = body.layouts
        deck.freeform_slide_ids = body.freeform_slide_ids
        await session.commit()
    return {"status": "saved"}


@router.put("/{deck_id}/profile")
async def update_deck_profile(deck_id: str, body: CompanyProfileIn, user_id: str = Depends(get_current_user_id)):
    async with AsyncSessionLocal() as session:
        deck = await session.get(DeckModel, deck_id)
        if not deck or deck.user_id != user_id:
            raise HTTPException(status_code=404, detail="Deck not found.")
        deck.profile_snapshot = body.model_dump()
        await session.commit()
    return {"status": "saved"}


class RegenerateRequest(BaseModel):
    repo_summaries: list[RepoSummary] = []


@router.post("/{deck_id}/regenerate")
async def regenerate_deck(deck_id: str, body: RegenerateRequest, user_id: str = Depends(get_current_user_id)):
    async with AsyncSessionLocal() as session:
        deck = await session.get(DeckModel, deck_id)
        if not deck or deck.user_id != user_id:
            raise HTTPException(status_code=404, detail="Deck not found.")

        slide_list, deck_theme = build_deck(deck.profile_snapshot or {}, body.repo_summaries)
        deck.slides = [slide_to_dict(s) for s in slide_list]
        deck.theme = theme_to_dict(deck_theme)
        deck.repo_full_names = [s.full_name for s in body.repo_summaries]
        deck.layouts = {}
        deck.freeform_slide_ids = []
        await session.commit()
        await session.refresh(deck)
        return _deck_full(deck)


@router.delete("/{deck_id}")
async def delete_deck(deck_id: str, user_id: str = Depends(get_current_user_id)):
    async with AsyncSessionLocal() as session:
        deck = await session.get(DeckModel, deck_id)
        if not deck or deck.user_id != user_id:
            raise HTTPException(status_code=404, detail="Deck not found.")
        await session.delete(deck)
        await session.commit()
    return {"status": "deleted"}
