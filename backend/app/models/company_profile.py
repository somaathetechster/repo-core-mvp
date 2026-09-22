"""
A founder's company profile: the manually-entered evidence layer (as opposed
to GitHub, which is auto-extracted). One row per user for now; if a user
needs multiple companies later, add a company_id and drop the user_id
primary key in favor of a foreign key + separate ownership table.

Images (logo, company images, team member photos) are stored as base64 data
URLs directly in Postgres for now. This is simple and works without setting
up separate object storage, but is not efficient for large images or many
users; migrate to Supabase Storage (or S3) and store URLs instead once this
becomes a real cost or performance concern.

Team members are stored as a JSON array rather than a separate table for
now, since there's no need yet to query across users by team member. If
that need appears later (e.g. searching by team member name), split into a
real child table.
"""
from datetime import datetime, timezone
from sqlalchemy import String, Text, DateTime, JSON
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base


class CompanyProfileModel(Base):
    __tablename__ = "company_profiles"

    user_id: Mapped[str] = mapped_column(String, primary_key=True)

    # Identity
    company_name: Mapped[str] = mapped_column(String, default="")
    one_liner: Mapped[str] = mapped_column(String, default="")
    website_url: Mapped[str] = mapped_column(String, default="")
    industry: Mapped[str] = mapped_column(String, default="")
    stage: Mapped[str] = mapped_column(String, default="")
    location: Mapped[str] = mapped_column(String, default="")
    founded_date: Mapped[str] = mapped_column(String, default="")
    incorporation_status: Mapped[str] = mapped_column(String, default="")
    incorporation_country: Mapped[str] = mapped_column(String, default="")

    # Brand assets. logo_data_url is a base64 data URL. Each entry in
    # company_image_data_urls is now {data_url, tag} rather than a bare
    # string, where tag says which part of the deck the image belongs to
    # (e.g. "product", "market", "traction", "cover", "other"). This lets
    # the deck builder place each image where the founder intended, rather
    # than always dumping every image onto one generic "Product" slide.
    logo_data_url: Mapped[str] = mapped_column(Text, default="")
    company_image_data_urls: Mapped[list] = mapped_column(JSON, default=list)
    demo_video_url: Mapped[str] = mapped_column(String, default="")  # external link, e.g. YouTube/Loom

    # Brand theme. If set, the deck viewer uses these instead of Provisio's
    # own default gold/black theme. Hex color strings, e.g. "#2563eb".
    brand_primary_color: Mapped[str] = mapped_column(String, default="")
    brand_secondary_color: Mapped[str] = mapped_column(String, default="")
    # Which font pairing the deck renders with: "serif" (default, Fraunces
    # display + Inter body), "sans" (Inter throughout, modern/minimal feel),
    # or "classic" (a traditional serif body, more formal/institutional).
    brand_font_style: Mapped[str] = mapped_column(String, default="serif")

    # The narrative
    problem: Mapped[str] = mapped_column(Text, default="")
    solution: Mapped[str] = mapped_column(Text, default="")
    evidence_of_innovation: Mapped[str] = mapped_column(Text, default="")
    differentiation: Mapped[str] = mapped_column(Text, default="")
    patents_or_ip: Mapped[str] = mapped_column(Text, default="")

    # Market
    market_research: Mapped[str] = mapped_column(Text, default="")
    market_opportunity: Mapped[str] = mapped_column(Text, default="")
    tam: Mapped[str] = mapped_column(String, default="")
    sam: Mapped[str] = mapped_column(String, default="")
    som: Mapped[str] = mapped_column(String, default="")
    competitive_landscape: Mapped[str] = mapped_column(Text, default="")
    go_to_market: Mapped[str] = mapped_column(Text, default="")

    # Traction and business
    traction: Mapped[str] = mapped_column(Text, default="")
    key_metrics: Mapped[str] = mapped_column(Text, default="")
    business_model: Mapped[str] = mapped_column(Text, default="")
    pricing_model: Mapped[str] = mapped_column(Text, default="")

    # Team. Each entry: {name, role, bio, photo_data_url, linkedin_url}
    team_members: Mapped[list] = mapped_column(JSON, default=list)

    # The ask
    funding_ask: Mapped[str] = mapped_column(Text, default="")
    use_of_funds: Mapped[str] = mapped_column(Text, default="")
    previous_funding: Mapped[str] = mapped_column(Text, default="")
    valuation_expectation: Mapped[str] = mapped_column(String, default="")

    # Risk
    risks_and_mitigations: Mapped[str] = mapped_column(Text, default="")

    # Target program, expanded from a single free-text field into structured
    # fields, since this is what makes a deck adapt to a specific audience.
    program_name: Mapped[str] = mapped_column(String, default="")
    program_type: Mapped[str] = mapped_column(String, default="")  # accelerator / VC fund / competition / grant
    program_url: Mapped[str] = mapped_column(String, default="")
    program_requirements: Mapped[str] = mapped_column(Text, default="")  # what THEY ask for, pasted or summarized
    program_deadline: Mapped[str] = mapped_column(String, default="")
    #: The application's own questions, pasted. Each is routed to the slide
    #: that answers it, so the deck visibly answers the form.
    program_questions: Mapped[str] = mapped_column(Text, default="")
    #: Why this company fits this programme. Becomes the "fit" slide, which
    #: accelerators and corporate programmes weight heavily.
    why_this_program: Mapped[str] = mapped_column(Text, default="")

    # Sections that previously had nowhere to live, each feeding one slide.
    why_now: Mapped[str] = mapped_column(Text, default="")                 # -> why_now slide
    customer_segment: Mapped[str] = mapped_column(Text, default="")        # -> market slide
    unit_economics: Mapped[str] = mapped_column(Text, default="")          # -> business model slide
    milestones_next_12m: Mapped[str] = mapped_column(Text, default="")     # -> milestones slide
    impact_outcomes: Mapped[str] = mapped_column(Text, default="")         # -> impact slide (grants)

    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
    )
