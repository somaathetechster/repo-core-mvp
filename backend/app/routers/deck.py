"""
Generates a deck from the user's saved company profile plus repo summaries
the frontend has already fetched via /repos/{owner}/{repo}/analyze. We take
those summaries as input rather than re-fetching from GitHub here, so a
deck can be regenerated instantly without repeated API calls or requiring
a live GitHub connection at generation time.
"""
from pydantic import BaseModel
from fastapi import APIRouter, Depends

from app.core.deps import get_current_user_id
from app.core.db import AsyncSessionLocal
from app.models.company_profile import CompanyProfileModel
from app.services.deck_builder import build_deck, slide_to_dict, theme_to_dict
from app.services.github_extract import RepoSummary

router = APIRouter(prefix="/deck", tags=["deck"])


class GenerateDeckRequest(BaseModel):
    repo_summaries: list[RepoSummary] = []


@router.post("/generate")
async def generate_deck(body: GenerateDeckRequest, user_id: str = Depends(get_current_user_id)):
    async with AsyncSessionLocal() as session:
        profile_row = await session.get(CompanyProfileModel, user_id)
        profile = (
            {col.name: getattr(profile_row, col.name) for col in CompanyProfileModel.__table__.columns}
            if profile_row
            else {}
        )

    slides, theme = build_deck(profile, body.repo_summaries)
    return {"slides": [slide_to_dict(s) for s in slides], "theme": theme_to_dict(theme)}
