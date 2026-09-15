"""
Read/write the founder's company profile: the manually-entered evidence
layer that sits alongside GitHub extraction. A single record per user.
"""
from pydantic import BaseModel
from fastapi import APIRouter, Depends

from app.core.deps import get_current_user_id
from app.core.db import AsyncSessionLocal
from app.models.company_profile import CompanyProfileModel

router = APIRouter(prefix="/company-profile", tags=["company-profile"])


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
    return {"status": "saved"}
