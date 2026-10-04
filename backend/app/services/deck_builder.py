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
from app.services.deck_structures import DeckStructure, SlideRole, get_structure


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
    structure: DeckStructure | None = None,
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

    # Slide count comes from the chosen structure rather than a hardcoded cap,
    # so the narrative path and the structure agree on length.
    max_slides = structure.max_slides if structure else 13
    if len(slides) > max_slides:
        slides = slides[:max_slides]

    toc = Slide(
        id="toc", type="toc", title="Contents", blocks=[],
        toc_entries=[{"title": s.title} for s in slides[1:]],
    )
    slides.insert(1, toc)

    return slides, theme, list(narrative.warnings)


def _role_blocks(profile: dict, role: SlideRole) -> list[SlideBlock]:
    """
    Turns a role's declared source fields into slide blocks, pulling text
    straight from the profile. TAM/SAM/SOM are labelled rather than dumped
    bare, since a lone number means nothing without its tier.
    """
    out: list[SlideBlock] = []
    labels = {"tam": "TAM", "sam": "SAM", "som": "SOM"}
    for key in role.source_fields:
        if key in ("company_name", "one_liner", "team_members", "company_image_data_urls"):
            continue
        value = (profile.get(key) or "").strip() if isinstance(profile.get(key), str) else ""
        if not value:
            continue
        if key in labels:
            out.append(SlideBlock(text=f"{labels[key]}: {value}", source=PROFILE_SOURCE))
        else:
            out.append(SlideBlock(text=value, source=PROFILE_SOURCE))
    return out


def build_deck(
    profile: dict,
    repo_summaries: list[RepoSummary],
    brief: DeckBrief | None = None,
    structure: DeckStructure | None = None,
) -> tuple[list[Slide], DeckTheme]:
    """
    Assembles the deck deterministically, driven by a chosen DeckStructure.

    Slides are built as a pool of candidates keyed by the structure's role keys,
    then ordered and trimmed according to that same structure. This is the
    fallback path when the narrative engine can't run, so it reads from the one
    source of truth the LLM path reads from — the structure decides order, slide
    set and length, not a list duplicated here.

    The old version had a fixed order and trimmed by slicing the end, which
    silently dropped the ask — the one slide every deck needs.
    """
    if brief is None:
        brief = build_brief(profile)
    if structure is None:
        structure = get_structure(brief.structure_id)

    images_by_tag = _images_by_tag(profile)

    theme = DeckTheme(
        primary_color=profile.get("brand_primary_color") or None,
        secondary_color=profile.get("brand_secondary_color") or None,
        font_style=profile.get("brand_font_style") or "serif",
    )

    # Images matched to the role they were tagged for.
    tag_for_role = {
        "solution": "product", "product": "product", "solution_demo": "product",
        "technology": "diagram", "moat": "diagram",
        "problem": "customer", "problem_insight": "customer",
        "traction": "press", "progress": "press", "traction_snapshot": "press",
        "market": "background", "market_opportunity": "background",
    }

    # ── Candidate slides, one per role that has content. A role with no
    # material is simply absent, so nothing is invented to fill an outline. ──
    candidates: dict[str, Slide] = {}

    cover_image = (images_by_tag.get("cover") or [None])[0] or (profile.get("logo_data_url") or None)
    candidates["cover"] = Slide(
        id="cover", type="cover",
        title=profile.get("company_name") or "Untitled company",
        blocks=_block_if_present(profile.get("one_liner", "")),
        image_data_url=cover_image,
    )

    team_members = profile.get("team_members") or []

    for role in structure.content_roles:
        if "team_members" in role.source_fields and team_members:
            candidates[role.key] = Slide(
                id=role.key, type="team", title=role.label, team_members=team_members)
            continue
        blocks = _role_blocks(profile, role)
        if not blocks:
            continue
        image = (images_by_tag.get(tag_for_role.get(role.key, "")) or [None])[0]
        candidates[role.key] = Slide(
            id=role.key, type="text", title=role.label, blocks=blocks, image_data_url=image)

    # One technology slide per analysed repository. Attach the evidence to the
    # product/moat/solution slide if the structure has one, otherwise stand it
    # up as its own slide so the independent evidence is never lost.
    attach_to = next((k for k in ("product", "moat", "solution", "technology")
                      if k in candidates), None)
    for i, summary in enumerate(repo_summaries):
        content = build_technology_slide_content(summary)
        block = SlideBlock(text=content, source=f"GitHub: {summary.full_name}")
        if attach_to and i == 0:
            candidates[attach_to].blocks = candidates[attach_to].blocks + [block]
        else:
            candidates[f"technology-{i}"] = Slide(
                id=f"technology-{i}", type="text",
                title=f"Technology: {summary.full_name}", blocks=[block])

    for i, image_url in enumerate(images_by_tag.get("product", [])):
        candidates[f"product-image-{i}"] = Slide(
            id=f"product-image-{i}", type="image", title="Product", image_data_url=image_url)

    # ── Order by the structure; the title role is the cover. Extra slides the
    # structure doesn't name (repo evidence, product images) keep a stable
    # place at the end so nothing the founder supplied disappears. ──
    ordered_keys = ["cover"]
    for role in structure.content_roles:
        if role.key in candidates and role.key not in ordered_keys:
            ordered_keys.append(role.key)
    ordered_keys += [k for k in candidates if k not in ordered_keys and k != "contents"]

    # ── Trim to the structure's max, dropping the least important first and
    # never dropping a required role, the cover, or the ask. ──
    max_slides = structure.max_slides
    if len(ordered_keys) > max_slides:
        ask_keys = {r.key for r in structure.roles if r.key.startswith("ask")}
        protected = set(structure.required_roles) | {"cover"} | ask_keys
        droppable = [k for k in reversed(ordered_keys) if k not in protected]
        to_drop: set[str] = set()
        for k in droppable:
            if len(ordered_keys) - len(to_drop) <= max_slides:
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
