"""
Multi-deck management. Replaces the earlier single-deck-per-user model
(the old /deck/generate and /deck/saved endpoints). A user can now have
many decks, each with its own profile snapshot and repo selection.
"""
from typing import Any
from pydantic import BaseModel
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select, func
from sqlalchemy.dialects.postgresql import JSONB

from app.core.deps import get_current_user_id
from app.core.db import AsyncSessionLocal
from app.models.deck import DeckModel
from app.models.company_profile import CompanyProfileModel
from app.routers.company_profile import CompanyProfileIn
from app.services.program_intelligence import build_brief
from app.services.deck_builder import build_deck, build_deck_from_narrative, slide_to_dict, theme_to_dict
from app.services.narrative_engine import generate_narrative
from app.services.github_extract import RepoSummary

router = APIRouter(prefix="/decks", tags=["decks"])


async def _shared_profile_dict(session, user_id: str) -> dict:
    row = await session.get(CompanyProfileModel, user_id)
    if not row:
        return {}
    # Exclude user_id (not part of the profile content) and updated_at
    # (a datetime, which isn't JSON-serializable and would break the
    # profile_snapshot JSON column on insert).
    return {
        col.name: getattr(row, col.name)
        for col in CompanyProfileModel.__table__.columns
        if col.name not in ("user_id", "updated_at")
    }


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
    """
    Lists decks without loading their contents.

    This previously selected whole rows, so listing ten decks pulled every
    slide and every embedded image out of the database to do nothing but
    count slides. Once decks carried real photography that was tens of
    megabytes per request and the list stopped responding. Slide count comes
    from a JSON length computed in the database instead.
    """
    async with AsyncSessionLocal() as session:
        slide_count = func.coalesce(func.jsonb_array_length(
            func.cast(DeckModel.slides, JSONB)
        ), 0).label("slide_count")

        try:
            result = await session.execute(
                select(
                    DeckModel.id, DeckModel.name, slide_count,
                    DeckModel.updated_at, DeckModel.created_at,
                )
                .where(DeckModel.user_id == user_id)
                .order_by(DeckModel.updated_at.desc())
            )
            return [
                {
                    "id": r.id, "name": r.name, "slide_count": r.slide_count or 0,
                    "updated_at": r.updated_at.isoformat() if r.updated_at else None,
                    "created_at": r.created_at.isoformat() if r.created_at else None,
                }
                for r in result.all()
            ]
        except Exception:
            # Older rows may store slides as plain JSON rather than JSONB, or
            # the database may not support the cast. Fall back to loading the
            # metadata columns only, which is still far lighter than whole rows.
            result = await session.execute(
                select(DeckModel.id, DeckModel.name, DeckModel.updated_at, DeckModel.created_at)
                .where(DeckModel.user_id == user_id)
                .order_by(DeckModel.updated_at.desc())
            )
            return [
                {
                    "id": r.id, "name": r.name, "slide_count": 0,
                    "updated_at": r.updated_at.isoformat() if r.updated_at else None,
                    "created_at": r.created_at.isoformat() if r.created_at else None,
                }
                for r in result.all()
            ]


@router.post("")
async def create_deck(body: CreateDeckRequest, user_id: str = Depends(get_current_user_id)):
    async with AsyncSessionLocal() as session:
        profile = await _shared_profile_dict(session, user_id) if body.use_shared_profile else {}

        # The narrative engine rewrites the founder's input into deck copy
        # rather than passing paragraphs through. If it fails (rate limit,
        # unparseable output), fall back to the direct builder so a deck is
        # still produced rather than the whole request erroring.
        narrative_warnings: list[str] = []
        diligence = None
        for summary in body.repo_summaries:
            if isinstance(summary, dict) and summary.get("diligence"):
                diligence = summary["diligence"]
                break
        try:
            narrative = generate_narrative(profile, diligence)
            slide_list, deck_theme, narrative_warnings = build_deck_from_narrative(
                profile, narrative, body.repo_summaries
            )
        except Exception as e:
            try:
                brief = build_brief(profile)
                brief_dict = brief.to_dict()
            except Exception:
                brief = None
                brief_dict = {}
            slide_list, deck_theme = build_deck(profile, body.repo_summaries, brief)
            narrative_warnings = [
                f"Slides were written directly from your profile because the narrative "
                f"step didn't complete: {e}"
            ]

        deck = DeckModel(
            user_id=user_id,
            name=body.name or "Untitled deck",
            profile_snapshot=profile,
            repo_full_names=[s.full_name for s in body.repo_summaries],
            slides=[slide_to_dict(s) for s in slide_list],
            theme={**theme_to_dict(deck_theme), "program_brief": brief_dict},
            layouts={},
            freeform_slide_ids=[],
        )
        session.add(deck)
        await session.commit()
        await session.refresh(deck)
        # Warnings ride along on the create response: a founder needs to know
        # which sections came out empty and whether any figure couldn't be
        # traced to something they wrote.
        return {**_deck_full(deck), "warnings": narrative_warnings}


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

        brief = build_brief(deck.profile_snapshot or {})
        slide_list, deck_theme = build_deck(deck.profile_snapshot or {}, body.repo_summaries, brief)
        deck.slides = [slide_to_dict(s) for s in slide_list]
        # Regenerating rewrites the slides, but the founder's chosen template
        # and colour scheme are design decisions about this deck, not content.
        # Carrying them across means "regenerate" doesn't silently undo the
        # styling work they just did.
        previous_theme = deck.theme or {}
        new_theme = {**theme_to_dict(deck_theme), "program_brief": brief_dict}
        for key in ("template_id", "scheme_id"):
            if previous_theme.get(key):
                new_theme[key] = previous_theme[key]
        deck.theme = new_theme
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
