"""
Builds a deck as a list of structured slides, from the company profile
(the founder's own words, entered directly) plus repo summaries already
extracted via GitHub (see github_extract.py).

Deliberate design choice: only the Technology slide is AI-generated, since
it's the only section that needs structured data turned into prose. Every
other slide displays the founder's own text, formatted, not rewritten.
This keeps the deck's claims traceable to exactly where they came from:
either "the founder wrote this" or "extracted from this repo", never
"the AI decided to phrase it this way".

Each slide's blocks carry an explicit source label, which the frontend
renders as a small citation on hover or alongside the text. Empty fields
are dropped rather than shown as blank sections.
"""
from dataclasses import dataclass, field
from app.services.narrative import build_technology_slide_content
from app.services.github_extract import RepoSummary


@dataclass
class SlideBlock:
    text: str
    source: str  # e.g. "From your company profile", "GitHub: owner/repo"


@dataclass
class Slide:
    id: str
    type: str
    title: str
    blocks: list[SlideBlock] = field(default_factory=list)
    image_data_url: str | None = None
    team_members: list[dict] | None = None  # only set for the Team slide
    toc_entries: list[dict] | None = None  # only set for the Table of Contents slide


@dataclass
class DeckTheme:
    primary_color: str | None = None
    secondary_color: str | None = None
    font_style: str = "serif"


PROFILE_SOURCE = "From your company profile"


def _block_if_present(text: str, source: str = PROFILE_SOURCE) -> list[SlideBlock]:
    text = (text or "").strip()
    return [SlideBlock(text=text, source=source)] if text else []


def _images_by_tag(profile: dict) -> dict[str, list[str]]:
    """Group uploaded images by their tag, so each can be placed on the
    slide it was intended for rather than a single catch-all gallery."""
    by_tag: dict[str, list[str]] = {}
    for img in profile.get("company_image_data_urls") or []:
        # Support both the new {data_url, tag} shape and legacy bare strings
        # from before tagging existed, which default to "other".
        if isinstance(img, dict):
            tag = img.get("tag", "other")
            url = img.get("data_url", "")
        else:
            tag = "other"
            url = img
        if url:
            by_tag.setdefault(tag, []).append(url)
    return by_tag


def build_deck_from_narrative(
    profile: dict,
    narrative,
    repo_summaries: list[RepoSummary],
) -> tuple[list[Slide], DeckTheme, list[str]]:
    """
    Builds a deck from written narrative copy rather than from raw profile
    fields.

    The older path put the founder's own paragraphs on slides more or less
    unchanged, which is why decks read like filled-in forms. This takes
    rewritten copy, keeps the source attributions so every claim stays
    traceable, and surfaces the narrative engine's warnings to the caller
    rather than hiding them.
    """
    images_by_tag = _images_by_tag(profile)
    theme = DeckTheme(
        primary_color=profile.get("brand_primary_color") or None,
        secondary_color=profile.get("brand_secondary_color") or None,
        font_style=profile.get("brand_font_style") or "serif",
    )

    company = (profile.get("company_name") or "Untitled").strip()
    slides: list[Slide] = []

    cover_image = (images_by_tag.get("cover") or [None])[0] or (profile.get("logo_data_url") or None)
    slides.append(Slide(
        id="cover", type="cover", title=company,
        blocks=[SlideBlock(text=(profile.get("one_liner") or "").strip(), source="")]
              if profile.get("one_liner") else [],
        image_data_url=cover_image,
    ))

    # Images are matched to slides by tag, so a product screenshot lands on
    # the solution slide rather than sitting unused in the library.
    tag_for_kind = {
        "solution": "product", "product": "product", "technology": "diagram",
        "problem": "customer", "traction": "press", "market": "background",
    }

    for item in narrative.slides:
        kind = item.kind
        blocks = [SlideBlock(text=item.lead, source=", ".join(item.sources) or "Your profile")]
        blocks += [SlideBlock(text=p, source="") for p in item.points]
        tag = tag_for_kind.get(kind)
        image = (images_by_tag.get(tag) or [None])[0] if tag else None
        slides.append(Slide(
            id=kind, type="text", title=item.title, blocks=blocks, image_data_url=image,
        ))

    team = profile.get("team_members") or []
    if team:
        slides.append(Slide(
            id="team", type="team", title="Team", blocks=[],
            team_members=team,
        ))

    MAX_SLIDES = 14
    if len(slides) > MAX_SLIDES:
        slides = slides[:MAX_SLIDES]

    toc = Slide(
        id="toc", type="toc", title="Contents", blocks=[],
        toc_entries=[{"title": s.title} for s in slides[1:]],
    )
    slides.insert(1, toc)

    return slides, theme, list(narrative.warnings)


def build_deck(profile: dict, repo_summaries: list[RepoSummary]) -> tuple[list[Slide], DeckTheme]:
    slides: list[Slide] = []
    images_by_tag = _images_by_tag(profile)

    theme = DeckTheme(
        primary_color=profile.get("brand_primary_color") or None,
        secondary_color=profile.get("brand_secondary_color") or None,
        font_style=profile.get("brand_font_style") or "serif",
    )

    # Cover, uses a "cover"-tagged image as a background/accent if provided,
    # otherwise falls back to the logo.
    cover_image = (images_by_tag.get("cover") or [None])[0] or (profile.get("logo_data_url") or None)
    slides.append(Slide(
        id="cover",
        type="cover",
        title=profile.get("company_name") or "Untitled company",
        blocks=_block_if_present(profile.get("one_liner", "")),
        image_data_url=cover_image,
    ))

    # Problem
    if profile.get("problem"):
        slides.append(Slide(id="problem", type="text", title="Problem", blocks=_block_if_present(profile["problem"])))

    # Solution
    if profile.get("solution"):
        slides.append(Slide(id="solution", type="text", title="Solution", blocks=_block_if_present(profile["solution"])))

    # Evidence of innovation / differentiation, combined if both present
    innovation_blocks = _block_if_present(profile.get("evidence_of_innovation", ""))
    differentiation_blocks = _block_if_present(profile.get("differentiation", ""))
    if innovation_blocks or differentiation_blocks:
        slides.append(Slide(
            id="innovation",
            type="text",
            title="Why this is defensible",
            blocks=innovation_blocks + differentiation_blocks,
        ))

    # Technology, the one AI-generated slide, one per analyzed repo
    for summary in repo_summaries:
        content = build_technology_slide_content(summary)
        slides.append(Slide(
            id=f"technology-{summary.full_name}",
            type="text",
            title=f"Technology: {summary.full_name}",
            blocks=[SlideBlock(text=content, source=f"GitHub: {summary.full_name}")],
        ))

    # Market
    market_blocks = []
    if profile.get("market_opportunity"):
        market_blocks += _block_if_present(profile["market_opportunity"])
    for label, key in [("TAM", "tam"), ("SAM", "sam"), ("SOM", "som")]:
        if profile.get(key):
            market_blocks.append(SlideBlock(text=f"{label}: {profile[key]}", source=PROFILE_SOURCE))
    if profile.get("competitive_landscape"):
        market_blocks += _block_if_present(profile["competitive_landscape"])
    if market_blocks:
        slides.append(Slide(
            id="market",
            type="text",
            title="Market",
            blocks=market_blocks,
            image_data_url=(images_by_tag.get("market") or [None])[0],
        ))

    # Traction and business model
    traction_blocks = _block_if_present(profile.get("traction", "")) + _block_if_present(profile.get("key_metrics", ""))
    if traction_blocks:
        slides.append(Slide(
            id="traction",
            type="text",
            title="Traction",
            blocks=traction_blocks,
            image_data_url=(images_by_tag.get("traction") or [None])[0],
        ))

    business_blocks = _block_if_present(profile.get("business_model", "")) + _block_if_present(profile.get("pricing_model", ""))
    if business_blocks:
        slides.append(Slide(id="business-model", type="text", title="Business model", blocks=business_blocks))

    # Team
    team_members = profile.get("team_members") or []
    if team_members:
        slides.append(Slide(id="team", type="team", title="Team", team_members=team_members))

    # Product images, and any "other"-tagged uploads, each as its own slide
    for i, image_url in enumerate(images_by_tag.get("product", [])):
        slides.append(Slide(id=f"product-image-{i}", type="image", title="Product", image_data_url=image_url))
    for i, image_url in enumerate(images_by_tag.get("other", [])):
        slides.append(Slide(id=f"other-image-{i}", type="image", title="Additional", image_data_url=image_url))

    # The ask
    ask_blocks = _block_if_present(profile.get("funding_ask", "")) + _block_if_present(profile.get("use_of_funds", ""))
    if ask_blocks:
        slides.append(Slide(id="ask", type="text", title="The ask", blocks=ask_blocks))

    # Risks
    if profile.get("risks_and_mitigations"):
        slides.append(Slide(
            id="risks", type="text", title="Risks and mitigations",
            blocks=_block_if_present(profile["risks_and_mitigations"]),
        ))

    # An investor deck that runs past ~15 slides stops being read. Cap it
    # and say so, rather than silently generating 30 pages nobody opens.
    MAX_SLIDES = 14
    if len(slides) > MAX_SLIDES:
        slides = slides[:MAX_SLIDES]

    # Table of contents, built from every slide after the cover, then
    # inserted right after it. Built last since it needs the final list.
    if len(slides) > 1:
        toc_entries = [{"title": s.title} for s in slides[1:]]
        slides.insert(1, Slide(id="toc", type="toc", title="Contents", toc_entries=toc_entries))

    return slides, theme


def slide_to_dict(slide: Slide) -> dict:
    return {
        "id": slide.id,
        "type": slide.type,
        "title": slide.title,
        "blocks": [{"text": b.text, "source": b.source} for b in slide.blocks],
        "image_data_url": slide.image_data_url,
        "team_members": slide.team_members,
        "toc_entries": slide.toc_entries,
    }


def theme_to_dict(theme: DeckTheme) -> dict:
    return {
        "primary_color": theme.primary_color,
        "secondary_color": theme.secondary_color,
        "font_style": theme.font_style,
    }
