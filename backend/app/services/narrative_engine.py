"""
The narrative engine.

Until now the deck builder passed the founder's profile text through almost
verbatim. That was a deliberate anti-hallucination stance, and it was too
blunt: there is a wide gap between inventing facts and writing well. A
founder writes "we help people send money cheaper". An investor-grade slide
says something structurally different built on the same truth, with the
claim sharpened, the evidence attached, and the sentence carrying weight.

So this rewrites. What it may not do is invent. The distinction is enforced
three ways: the prompt states it explicitly, every claim must trace to a
supplied fact, and a verification pass checks the output's numbers against
the input before anything reaches a slide.
"""
import json
import re
from dataclasses import dataclass, field

from app.services.ai_provider import generate, GenerateRequest
from app.services.deck_structures import DeckStructure, SlideRole, get_structure, GLOBAL_BARS


@dataclass
class SlideCopy:
    kind: str
    title: str
    lead: str
    points: list[str] = field(default_factory=list)
    # Evidence the copy rests on, surfaced under the slide.
    sources: list[str] = field(default_factory=list)
    # Optional typed content blocks (stat/comparison/timeline/logos/chips/
    # quote/bars) the model may emit where the content is naturally
    # structured. Kept as validated raw dicts — see _KNOWN_BLOCK_TYPES.
    blocks: list[dict] = field(default_factory=list)


@dataclass
class DeckNarrative:
    slides: list[SlideCopy]
    warnings: list[str] = field(default_factory=list)


NARRATIVE_SYSTEM = """You write investor pitch deck copy. You are given a founder's own description of their company, plus any technical evidence extracted from their codebase.

Your job is to make the strongest honest case, in the sharpest possible prose. That means rewriting, restructuring, and cutting, not paraphrasing.

HOW TO WRITE
- Lead with the claim, then the evidence. Never build up to the point.
- Prefer the concrete to the abstract. "1,136 fiat withdrawals settled" beats "significant transaction volume".
- One idea per sentence. Short sentences carry more weight than long ones.
- Cut every adjective that isn't doing work. No "innovative", "cutting-edge", "revolutionary", "seamless", "robust", "world-class".
- Write like a person who knows the business, not like marketing copy.
- A slide's lead line should be able to stand alone as the single thing a reader remembers.

WHAT YOU MAY NOT DO
- Never invent a number, a customer, a partnership, a date, or a credential. If the founder didn't supply it, it does not exist.
- Never imply scale the evidence doesn't support. "Growing fast" is not available to you unless there are figures showing it.
- Never state a competitor's weakness as fact unless the founder supplied it.
- If a section has thin input, write less rather than padding. A short honest slide beats a full invented one.
- Do not soften a genuine weakness into a strength.

For each slide, list in "sources" which input fields you drew on, so every claim can be traced back.

CONTENT BLOCKS
Where a slide's content is naturally structured, express it as a content block instead of prose. A traction slide's numbers become `stat` blocks. A competition slide becomes a `comparison` table. A roadmap becomes a `timeline`. A team slide becomes `chips`. Press/customers become `logos`. A testimonial becomes a `quote`. Use-of-funds or projections become `bars`. NEVER invent data for a block — every value must come from the founder's input or the technical evidence. If the data for a block does not exist, write prose instead. A block with real numbers always beats a paragraph describing them.
Any block carrying data must list its source fields in that block's own "sources", exactly as the slide does.

Return valid JSON only, no markdown fences:
{
  "slides": [
    {
      "kind": "problem",
      "title": "Short, specific slide title",
      "lead": "The one sentence that carries the slide.",
      "points": ["Supporting point.", "Supporting point."],
      "sources": ["problem", "traction"],
      "blocks": [
        { "type": "stat", "value": "54%", "label": "week-1 retention", "sublabel": "8-week cohort", "sources": ["traction"] },
        { "type": "comparison", "columns": ["", "Us", "Incumbent"], "rows": [{ "cells": ["Onboarding", "2 min", "2 weeks"] }], "sources": ["competitive_landscape"] },
        { "type": "timeline", "items": [{ "period": "H1 2026", "points": ["Launch in Lagos", "First 1,000 users"] }], "sources": ["milestones_next_12m"] },
        { "type": "logos", "items": [{ "name": "TechCrunch", "note": "Featured" }], "sources": ["traction"] },
        { "type": "chips", "items": [{ "name": "Ada Obi", "role": "CEO", "note": "ex-Paystack" }], "sources": ["team_members"] },
        { "type": "quote", "text": "It cut our settlement time from days to minutes.", "author": "Chidi N.", "role": "CFO, Acme", "sources": ["traction"] },
        { "type": "bars", "items": [{ "label": "Engineering", "value": 60, "max": 100 }, { "label": "Go-to-market", "value": 40, "max": 100 }], "sources": ["use_of_funds"] }
      ]
    }
  ]
}
The "blocks" array is OPTIONAL. Omit it entirely on slides whose content is prose. Include only the block types that fit the slide, never all of them, and only when every value is real."""


def _field_text(profile: dict, key: str) -> str:
    value = profile.get(key)
    return value.strip() if isinstance(value, str) else ""


#: Roles whose case is strengthened by independent codebase evidence even when
#: the founder left the matching profile fields thin.
_DILIGENCE_ROLES = {"product", "solution", "solution_demo", "moat", "technology", "evidence"}


def _role_has_material(profile: dict, role: SlideRole, diligence: dict | None) -> bool:
    if any(_field_text(profile, f) for f in role.source_fields):
        return True
    # team_members is a list, not a text field.
    if "team_members" in role.source_fields and (profile.get("team_members") or []):
        return True
    if diligence and role.key in _DILIGENCE_ROLES:
        return True
    return False


def _build_input(
    profile: dict, diligence: dict | None, structure: DeckStructure,
) -> tuple[str, list[str]]:
    """
    Assembles the evidence and, from the chosen structure, the ordered list of
    slides to write — each with its purpose and role-level quality bar inline.

    Returns the prompt text and the roles that came out empty, so the caller can
    warn the founder which sections had nothing behind them.
    """
    lines: list[str] = []
    empty: list[str] = []

    name = _field_text(profile, "company_name") or "the company"
    lines.append(f"COMPANY: {name}")
    if one := _field_text(profile, "one_liner"):
        lines.append(f"ONE-LINER: {one}")

    # Every profile field a role in this structure draws on, de-duplicated and
    # kept in a stable order, so the evidence block always carries what the
    # slides-to-write section will reference.
    evidence_keys: list[str] = []
    for role in structure.content_roles:
        for f in role.source_fields:
            if f not in evidence_keys and f != "company_image_data_urls":
                evidence_keys.append(f)
    for key in evidence_keys:
        value = _field_text(profile, key)
        if value:
            lines.append(f"\n{key.upper().replace('_', ' ')}:\n{value}")

    # Technical diligence, when a repo has been analysed, is the strongest
    # available evidence for the technology slide and usually the only
    # independent evidence in the whole deck.
    if diligence:
        lines.append("\n--- TECHNICAL EVIDENCE, extracted from the company's own codebase ---")
        if summary := diligence.get("system_summary"):
            lines.append(f"System: {summary}")
        for hard in diligence.get("what_is_hard", [])[:5]:
            lines.append(f"Hard problem solved: {hard}")
        for note in diligence.get("architecture_notes", [])[:4]:
            lines.append(f"Architecture: {note}")
        if insight := diligence.get("data_model_insight"):
            lines.append(f"Data model: {insight}")
        if readiness := diligence.get("production_readiness"):
            lines.append(f"Production readiness: {readiness}")
        for integ in diligence.get("integration_depth", [])[:5]:
            lines.append(f"Integration: {integ.get('system')} — {integ.get('assessment')}")

    plan_lines: list[str] = []
    for role in structure.content_roles:
        has_input = _role_has_material(profile, role, diligence)
        if has_input:
            plan_lines.append(
                f"- kind \"{role.key}\": {role.purpose}\n"
                f"    Quality bar: {role.quality_bar_detailed}"
            )
        elif role.requirement in ("required", "recommended"):
            empty.append(role.key)

    lines.append(
        f"\n--- SLIDES TO WRITE ({structure.name} structure) ---"
    )
    lines.append(
        f"Write between {structure.min_slides} and {structure.max_slides} slides "
        f"(the cover is added separately, so it is not in this count). Use each role's "
        f"exact key as the slide's \"kind\". Keep them in the order listed."
    )
    lines.extend(plan_lines)
    lines.append(
        "\nWrite only the slides listed. Do not write slides for sections with no input."
    )

    return "\n".join(lines), empty


_NUMBER_RE = re.compile(r"\b\d[\d,.]*\s*(?:%|k|m|bn?|million|billion)?\b", re.I)


def _verify_numbers(copy_text: str, source_text: str) -> list[str]:
    """
    Flags figures in the output that don't appear in the input.

    A model told not to invent numbers will still occasionally round, merge,
    or transpose one. Since a wrong figure in an investor deck is the most
    damaging possible failure, every number is checked against the source
    and anything unmatched is reported rather than quietly shipped.
    """
    def normalise(v: str) -> str:
        return re.sub(r"[,\s]", "", v.lower()).rstrip(".")

    source_numbers = {normalise(m.group()) for m in _NUMBER_RE.finditer(source_text)}
    # Bare digits inside the source, to catch "1,350" vs "1350" and years.
    source_numbers |= {re.sub(r"[^\d.]", "", n) for n in source_numbers}

    unmatched: list[str] = []
    for match in _NUMBER_RE.finditer(copy_text):
        raw = match.group().strip()
        norm = normalise(raw)
        digits = re.sub(r"[^\d.]", "", norm)
        # Small bare integers are usually ordinals or list counts, not
        # claims, and checking them produces noise. But a magnitude suffix
        # makes even a single digit a real figure: "$5M" is exactly the kind
        # of number that must never be invented, so it is always checked.
        has_magnitude = bool(re.search(r"[%kmb]|million|billion", norm))
        if len(digits.replace(".", "")) <= 1 and not has_magnitude:
            continue
        if norm in source_numbers or digits in source_numbers:
            continue
        unmatched.append(raw)

    return sorted(set(unmatched))


_KNOWN_BLOCK_TYPES = {"stat", "comparison", "timeline", "logos", "chips", "quote", "bars"}


def _sanitize_blocks(raw) -> list[dict]:
    """
    Keeps only well-formed blocks of a known type, discarding anything the
    model returned in the wrong shape. This never adds data — it only drops
    malformed entries — so the never-invent guarantee is unaffected.
    """
    if not isinstance(raw, list):
        return []
    out: list[dict] = []
    for b in raw:
        if not isinstance(b, dict):
            continue
        t = b.get("type")
        if t not in _KNOWN_BLOCK_TYPES:
            continue
        # Minimal shape check per type; a block missing its payload is dropped
        # rather than rendered empty.
        if t == "stat" and not (b.get("value") and b.get("label")):
            continue
        if t == "comparison" and not (isinstance(b.get("columns"), list) and isinstance(b.get("rows"), list) and b["rows"]):
            continue
        if t == "timeline" and not (isinstance(b.get("items"), list) and b["items"]):
            continue
        if t in ("logos", "chips") and not (isinstance(b.get("items"), list) and b["items"]):
            continue
        if t == "quote" and not (b.get("text") and b.get("author")):
            continue
        if t == "bars" and not (isinstance(b.get("items"), list) and b["items"]):
            continue
        out.append(b)
    return out


def _block_text(blocks: list[dict]) -> str:
    """
    Flattens every value a block carries into one string, so the number
    verification pass checks figures inside blocks the same way it checks
    prose. An invented stat value or bar figure must be caught too.
    """
    parts: list[str] = []
    for b in blocks:
        t = b.get("type")
        if t == "stat":
            parts += [str(b.get("value", "")), str(b.get("label", "")), str(b.get("sublabel", ""))]
        elif t == "comparison":
            parts += [str(c) for c in (b.get("columns") or [])]
            for row in b.get("rows") or []:
                parts += [str(c) for c in (row.get("cells") or [])]
        elif t == "timeline":
            for it in b.get("items") or []:
                parts.append(str(it.get("period", "")))
                parts += [str(p) for p in (it.get("points") or [])]
        elif t in ("logos", "chips"):
            for it in b.get("items") or []:
                parts += [str(it.get("name", "")), str(it.get("role", "")), str(it.get("note", ""))]
        elif t == "quote":
            parts += [str(b.get("text", "")), str(b.get("author", "")), str(b.get("role", ""))]
        elif t == "bars":
            for it in b.get("items") or []:
                parts += [str(it.get("label", "")), str(it.get("value", "")), str(it.get("max", ""))]
    return " ".join(p for p in parts if p)


def _system_prompt() -> str:
    """The writing rules, verbatim, plus the two global bars from the structure
    engine so there is one source of truth for them."""
    bars = "\n".join(f"- {b}" for b in GLOBAL_BARS)
    return NARRATIVE_SYSTEM.replace(
        "WHAT YOU MAY NOT DO",
        f"TWO BARS APPLY TO EVERY SLIDE\n{bars}\n\nWHAT YOU MAY NOT DO",
        1,
    )


def _minimal_slide(profile: dict, role: SlideRole) -> SlideCopy:
    """
    A honest stand-in for a required role the model skipped. It never invents:
    if the founder supplied source text we lead with it, otherwise we leave a
    visible prompt to fill it rather than silently dropping the slide.
    """
    for f in role.source_fields:
        text = _field_text(profile, f)
        if text:
            first = text.strip().split("\n")[0][:240]
            return SlideCopy(kind=role.key, title=role.label, lead=first, sources=[f])
    return SlideCopy(
        kind=role.key,
        title=role.label,
        lead=f"(Add your {role.label.lower()}: {role.purpose})",
        sources=[],
    )


def _enforce_structure(
    slides: list[SlideCopy], profile: dict, structure: DeckStructure, diligence: dict | None,
) -> list[SlideCopy]:
    """
    Reorders the model's slides to the structure's role sequence.

    Required roles the model skipped are kept as a minimal honest slide rather
    than silently dropped. Optional/recommended roles with no source material are
    dropped. Any slide the model produced that is not in the structure is kept at
    the end rather than discarded.
    """
    by_kind: dict[str, SlideCopy] = {}
    for s in slides:
        by_kind.setdefault(s.kind, s)

    ordered: list[SlideCopy] = []
    for role in structure.content_roles:
        if role.key in by_kind:
            ordered.append(by_kind.pop(role.key))
        elif role.requirement == "required":
            ordered.append(_minimal_slide(profile, role))
        # recommended/optional with nothing returned → dropped.

    # Preserve anything extra the model wrote that we didn't place.
    ordered.extend(by_kind.values())
    return ordered


def generate_narrative(
    profile: dict,
    diligence: dict | None = None,
    api_key_override: str | None = None,
    structure_id: str | None = None,
) -> DeckNarrative:
    structure = get_structure(structure_id)
    source_text, empty_sections = _build_input(profile, diligence, structure)

    # The same facts must be written differently for different readers. The
    # brief says who is reading, what they select on, and what the programme
    # explicitly asked for, so the copy is aimed rather than generic.
    try:
        from app.services.program_intelligence import build_brief, brief_for_prompt
        brief_block = brief_for_prompt(build_brief(profile))
        source_text = f"{brief_block}\n\n---\n\nCOMPANY MATERIAL:\n\n{source_text}"
    except Exception:
        # Never let audience tailoring break generation outright.
        pass

    raw = generate(GenerateRequest(
        task="deck_narrative",
        system=_system_prompt(),
        prompt=source_text,
        max_tokens=3500,
        api_key_override=api_key_override,
    ))

    cleaned = raw.strip()
    if cleaned.startswith("```"):
        cleaned = cleaned.split("```")[1]
        if cleaned.startswith("json"):
            cleaned = cleaned[4:]
    try:
        data = json.loads(cleaned.strip())
    except Exception as e:
        raise ValueError(f"The narrative model returned output that couldn't be parsed: {e}")

    slides: list[SlideCopy] = []
    for item in data.get("slides", []):
        lead = (item.get("lead") or "").strip()
        if not lead:
            continue
        slides.append(SlideCopy(
            kind=item.get("kind", "custom"),
            title=(item.get("title") or "").strip() or item.get("kind", "Slide").title(),
            lead=lead,
            points=[p.strip() for p in item.get("points", []) if p and p.strip()],
            sources=item.get("sources", []),
            blocks=_sanitize_blocks(item.get("blocks")),
        ))

    # CRITICAL: the model's returned order is not trusted. Reorder to the
    # structure's role sequence, keep missing required roles as honest stubs,
    # and drop optional roles it skipped.
    slides = _enforce_structure(slides, profile, structure, diligence)

    warnings: list[str] = []
    if empty_sections:
        warnings.append(
            "No content was written for: "
            + ", ".join(s.replace("_", " ") for s in empty_sections)
            + ". Fill those fields in your profile and regenerate."
        )

    # Verify numbers in the prose AND inside any content blocks: an invented
    # stat value or bar figure is exactly as damaging as an invented sentence.
    all_copy = "\n".join(
        s.lead + " " + " ".join(s.points) + " " + _block_text(s.blocks) for s in slides
    )
    unmatched = _verify_numbers(all_copy, source_text)
    if unmatched:
        warnings.append(
            "These figures appear in the generated copy but not in what you supplied: "
            + ", ".join(unmatched[:8])
            + ". Check them before sending this deck."
        )

    return DeckNarrative(slides=slides, warnings=warnings)


def narrative_to_dict(n: DeckNarrative) -> dict:
    return {
        "slides": [
            {
                "kind": s.kind,
                "title": s.title,
                "lead": s.lead,
                "points": s.points,
                "sources": s.sources,
                "blocks": s.blocks,
            }
            for s in n.slides
        ],
        "warnings": n.warnings,
    }
