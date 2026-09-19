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


@dataclass
class SlideCopy:
    kind: str
    title: str
    lead: str
    points: list[str] = field(default_factory=list)
    # Evidence the copy rests on, surfaced under the slide.
    sources: list[str] = field(default_factory=list)


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

Return valid JSON only, no markdown fences:
{
  "slides": [
    {
      "kind": "problem",
      "title": "Short, specific slide title",
      "lead": "The one sentence that carries the slide.",
      "points": ["Supporting point.", "Supporting point."],
      "sources": ["problem", "traction"]
    }
  ]
}"""


# The spine of a deck. Each entry says what the slide must accomplish, which
# is more useful to the model than a bare label.
SLIDE_PLAN: list[tuple[str, str, list[str]]] = [
    ("problem", "Establish that a real, expensive problem exists and who has it.", ["problem", "market_opportunity"]),
    ("solution", "Explain what the company does, concretely enough to picture it.", ["solution", "one_liner"]),
    ("technology", "Show why this is hard to build and hard to copy.", ["evidence_of_innovation"]),
    ("market", "Size the opportunity and explain why now.", ["market_opportunity"]),
    ("traction", "Present evidence that it is working.", ["traction", "key_metrics"]),
    ("business_model", "Explain how it makes money.", ["business_model", "pricing_model"]),
    ("competition", "Position against alternatives honestly.", ["competitive_landscape"]),
    ("ask", "State what is being raised and what it buys.", ["funding_ask"]),
]


def _field_text(profile: dict, key: str) -> str:
    return (profile.get(key) or "").strip()


def _build_input(profile: dict, diligence: dict | None) -> tuple[str, list[str]]:
    """Assembles the evidence, and reports which slides have nothing behind them."""
    lines: list[str] = []
    empty: list[str] = []

    name = _field_text(profile, "company_name") or "the company"
    lines.append(f"COMPANY: {name}")
    if one := _field_text(profile, "one_liner"):
        lines.append(f"ONE-LINER: {one}")

    for key in [
        "problem", "solution", "market_opportunity", "competitive_landscape",
        "traction", "key_metrics", "business_model", "pricing_model",
        "evidence_of_innovation", "risks_and_mitigations", "funding_ask",
    ]:
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

    plan_lines = []
    for kind, purpose, needs in SLIDE_PLAN:
        has_input = any(_field_text(profile, n) for n in needs) or (
            kind == "technology" and diligence
        )
        if has_input:
            plan_lines.append(f"- {kind}: {purpose}")
        else:
            empty.append(kind)

    lines.append("\n--- SLIDES TO WRITE ---")
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


def generate_narrative(
    profile: dict,
    diligence: dict | None = None,
    api_key_override: str | None = None,
) -> DeckNarrative:
    source_text, empty_sections = _build_input(profile, diligence)

    raw = generate(GenerateRequest(
        task="deck_narrative",
        system=NARRATIVE_SYSTEM,
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
        ))

    warnings: list[str] = []
    if empty_sections:
        warnings.append(
            "No content was written for: "
            + ", ".join(s.replace("_", " ") for s in empty_sections)
            + ". Fill those fields in your profile and regenerate."
        )

    all_copy = "\n".join(s.lead + " " + " ".join(s.points) for s in slides)
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
            }
            for s in n.slides
        ],
        "warnings": n.warnings,
    }
