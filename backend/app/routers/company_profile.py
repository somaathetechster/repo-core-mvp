"""
Read/write the founder's company profile: the manually-entered evidence
layer that sits alongside GitHub extraction. A single record per user.
"""
import logging
import time

from pydantic import BaseModel
from fastapi import APIRouter, Depends

from app.core.deps import get_current_user_id
from app.core.db import AsyncSessionLocal
from app.models.company_profile import CompanyProfileModel

log = logging.getLogger(__name__)
router = APIRouter(prefix="/company-profile", tags=["company-profile"])

# Profile-gap analysis is one LLM call (the Planner's evidence inventory, no
# generation), so it's cached per user for ten minutes rather than re-run on
# every save/visit.
_GAPS_TTL_SECONDS = 600
_gaps_cache: dict[str, tuple[float, dict]] = {}


class TeamMember(BaseModel):
    name: str = ""
    role: str = ""
    bio: str = ""
    photo_data_url: str = ""
    linkedin_url: str = ""


class TaggedImage(BaseModel):
    data_url: str
    tag: str = "other"  # "product" | "market" | "traction" | "cover" | "other"


class CompanyProfileIn(BaseModel):
    company_name: str = ""
    one_liner: str = ""
    website_url: str = ""
    industry: str = ""
    stage: str = ""
    location: str = ""
    founded_date: str = ""
    incorporation_status: str = ""
    incorporation_country: str = ""

    logo_data_url: str = ""
    company_image_data_urls: list[TaggedImage] = []
    demo_video_url: str = ""
    brand_primary_color: str = ""
    brand_secondary_color: str = ""
    brand_font_style: str = "serif"

    problem: str = ""
    solution: str = ""
    evidence_of_innovation: str = ""
    differentiation: str = ""
    patents_or_ip: str = ""

    market_research: str = ""
    market_opportunity: str = ""
    tam: str = ""
    sam: str = ""
    som: str = ""
    competitive_landscape: str = ""
    go_to_market: str = ""

    traction: str = ""
    key_metrics: str = ""
    business_model: str = ""
    pricing_model: str = ""

    team_members: list[TeamMember] = []

    funding_ask: str = ""
    use_of_funds: str = ""
    previous_funding: str = ""
    valuation_expectation: str = ""

    risks_and_mitigations: str = ""

    program_name: str = ""
    program_type: str = ""
    program_url: str = ""
    program_requirements: str = ""
    program_deadline: str = ""
    program_questions: str = ""
    why_this_program: str = ""
    why_now: str = ""
    customer_segment: str = ""
    unit_economics: str = ""
    milestones_next_12m: str = ""
    impact_outcomes: str = ""


@router.get("")
async def get_company_profile(user_id: str = Depends(get_current_user_id)):
    async with AsyncSessionLocal() as session:
        profile = await session.get(CompanyProfileModel, user_id)
        if not profile:
            return CompanyProfileIn().model_dump()
        return {
            col.name: getattr(profile, col.name)
            for col in CompanyProfileModel.__table__.columns
            if col.name not in ("user_id", "updated_at")
        }


async def _profile_dict(session, user_id: str) -> dict:
    profile = await session.get(CompanyProfileModel, user_id)
    if not profile:
        return {}
    return {
        col.name: getattr(profile, col.name)
        for col in CompanyProfileModel.__table__.columns
        if col.name not in ("user_id", "updated_at")
    }


@router.get("/gaps")
async def profile_gaps(user_id: str = Depends(get_current_user_id)):
    """
    Runs the Planner's evidence inventory against the saved profile (no
    generation) and returns which fields are strong/weak/missing plus the
    gaps. Cached per user for ten minutes.

    This is what lets a founder see exactly what the generator needs before
    they build a deck, instead of discovering empty sections afterwards.
    """
    now = time.time()
    cached = _gaps_cache.get(user_id)
    if cached and now - cached[0] < _GAPS_TTL_SECONDS:
        return cached[1]

    async with AsyncSessionLocal() as session:
        profile = await _profile_dict(session, user_id)

    # Analyse against the Seed baseline — the common reference the strength
    # message speaks in ("strong enough for a Seed deck…").
    from app.services.deck_structures import get_structure
    from app.services.narrative_engine import _build_input
    from app.services.deck_planner import run_planner

    structure = get_structure("seed")
    payload: dict = {"evidence_inventory": [], "gaps": [], "core_argument": "", "founder_edge": ""}
    try:
        source_text, _ = _build_input(profile, None, structure)
        brief = run_planner(source_text, structure)
        if brief:
            payload = {
                "evidence_inventory": brief.get("evidence_inventory", []),
                "gaps": brief.get("gaps", []),
                "core_argument": brief.get("core_argument", ""),
                "founder_edge": brief.get("founder_edge", ""),
            }
    except Exception:
        log.error("Profile gap analysis failed", exc_info=True)

    _gaps_cache[user_id] = (now, payload)
    return payload


@router.put("")
async def save_company_profile(body: CompanyProfileIn, user_id: str = Depends(get_current_user_id)):
    data = body.model_dump()
    data["team_members"] = [tm for tm in data["team_members"]]  # already dicts from model_dump

    async with AsyncSessionLocal() as session:
        profile = await session.get(CompanyProfileModel, user_id)
        if profile:
            for field, value in data.items():
                setattr(profile, field, value)
        else:
            profile = CompanyProfileModel(user_id=user_id, **data)
            session.add(profile)
        await session.commit()
    # The profile changed, so its cached gap analysis is stale.
    _gaps_cache.pop(user_id, None)
    return {"status": "saved"}
