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
from app.services.program_intelligence import DeckBrief, build_brief


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

    MAX_SLIDES = 13   # +1 for the contents page inserted below
    if len(slides) > MAX_SLIDES:
        slides = slides[:MAX_SLIDES]

    toc = Slide(
        id="toc", type="toc", title="Contents", blocks=[],
        toc_entries=[{"title": s.title} for s in slides[1:]],
    )
    slides.insert(1, toc)

    return slides, theme, list(narrative.warnings)


def build_deck(
    profile: dict,
    repo_summaries: list[RepoSummary],
    brief: DeckBrief | None = None,
) -> tuple[list[Slide], DeckTheme]:
    """
    Assembles the deck for a specific reader.

    Slides are built as a pool of candidates keyed by section, then ordered,
    filtered and trimmed according to the brief. That matters because the
    right slides in the wrong order is still the wrong deck: a grant committee
    reading market sizing before impact has already formed a view.

    The old version had a fixed order and trimmed by slicing the end, which
    silently dropped the ask — the one slide every deck needs.
    """
    if brief is None:
        brief = build_brief(profile)

    images_by_tag = _images_by_tag(profile)

    theme = DeckTheme(
        primary_color=profile.get("brand_primary_color") or None,
        secondary_color=profile.get("brand_secondary_color") or None,
        font_style=profile.get("brand_font_style") or "serif",
    )

    def blocks_from(*keys: str) -> list[SlideBlock]:
        out: list[SlideBlock] = []
        for k in keys:
            out += _block_if_present(profile.get(k, ""))
        return out

    # ── Candidate slides, one per section. A section with no content is
    # simply absent, so nothing is ever invented to fill an outline. ──
    candidates: dict[str, Slide] = {}

    cover_image = (images_by_tag.get("cover") or [None])[0] or (profile.get("logo_data_url") or None)
    candidates["cover"] = Slide(
        id="cover", type="cover",
        title=profile.get("company_name") or "Untitled company",
        blocks=_block_if_present(profile.get("one_liner", "")),
        image_data_url=cover_image,
    )

    def add(section: str, title: str, blocks: list[SlideBlock], **kw) -> None:
        if blocks or kw.get("team_members"):
            candidates[section] = Slide(id=section, type=kw.pop("type", "text"),
                                        title=title, blocks=blocks, **kw)

    add("problem", "Problem", blocks_from("problem"))
    add("solution", "Solution", blocks_from("solution"))
    add("why_now", "Why now", blocks_from("why_now"))
    add("technology", "Why this is defensible",
        blocks_from("evidence_of_innovation", "differentiation", "patents_or_ip"))

    market_blocks = blocks_from("market_opportunity", "customer_segment")
    for label, key in [("TAM", "tam"), ("SAM", "sam"), ("SOM", "som")]:
        if profile.get(key):
            market_blocks.append(SlideBlock(text=f"{label}: {profile[key]}", source=PROFILE_SOURCE))
    add("market", "Market", market_blocks,
        image_data_url=(images_by_tag.get("market") or [None])[0])

    add("competition", "Competition", blocks_from("competitive_landscape"))
    add("traction", "Traction", blocks_from("traction", "key_metrics"),
        image_data_url=(images_by_tag.get("traction") or [None])[0])
    add("business_model", "Business model", blocks_from("business_model", "pricing_model", "unit_economics"))
    add("impact", "Impact", blocks_from("impact_outcomes"))
    add("milestones", "Milestones", blocks_from("milestones_next_12m", "go_to_market"))
    add("use_of_funds", "Use of funds", blocks_from("use_of_funds"))
    add("risks", "Risks and mitigations", blocks_from("risks_and_mitigations"))
    add("fit", f"Why {brief.programme}", blocks_from("why_this_program"))
    add("ask", "The ask", blocks_from("funding_ask")
        or blocks_from("use_of_funds"))

    if team_members := (profile.get("team_members") or []):
        candidates["team"] = Slide(id="team", type="team", title="Team", team_members=team_members)

    # One technology slide per analysed repository, appended to the section
    # rather than replacing the founder's own differentiation copy.
    for i, summary in enumerate(repo_summaries):
        key = "technology" if "technology" not in candidates else f"technology-{i}"
        content = build_technology_slide_content(summary)
        block = SlideBlock(text=content, source=f"GitHub: {summary.full_name}")
        if key in candidates:
            candidates[key].blocks = candidates[key].blocks + [block]
        else:
            candidates[key] = Slide(id=key, type="text",
                                    title=f"Technology: {summary.full_name}", blocks=[block])

    for i, image_url in enumerate(images_by_tag.get("product", [])):
        candidates[f"product-image-{i}"] = Slide(
            id=f"product-image-{i}", type="image", title="Product", image_data_url=image_url)

    # ── Order by the brief; anything it doesn't mention keeps a stable place
    # at the end so nothing the founder wrote silently disappears. ──
    ordered_keys = [k for k in brief.section_order if k in candidates]
    ordered_keys += [k for k in candidates if k not in ordered_keys and k != "contents"]

    slides = [candidates[k] for k in ordered_keys]

    # ── Trim to a length that gets read, dropping the least important first
    # and never dropping a section the programme requires. ──
    MAX_SLIDES = 13   # +1 for the contents page inserted below
    if len(slides) > MAX_SLIDES:
        protected = set(brief.required_sections) | {"cover", "ask"}
        droppable = [k for k in reversed(ordered_keys)
                     if k not in protected and k in brief.deprioritised]
        droppable += [k for k in reversed(ordered_keys) if k not in protected and k not in droppable]
        to_drop: set[str] = set()
        for k in droppable:
            if len(slides) - len(to_drop) <= MAX_SLIDES:
                break
            to_drop.add(k)
        ordered_keys = [k for k in ordered_keys if k not in to_drop]
        slides = [candidates[k] for k in ordered_keys]

    if len(slides) > 1:
        slides.insert(1, Slide(id="toc", type="toc", title="Contents",
                               toc_entries=[{"title": s.title} for s in slides[1:]]))

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
