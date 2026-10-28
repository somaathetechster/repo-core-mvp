"""
Document generation for Provisio Docs.

Where the narrative engine (narrative_engine.py) writes terse pitch-deck copy —
one claim per slide, ruthlessly cut — a business document is the opposite shape:
professional prose, a heading and a few paragraphs per section. This engine
reuses the same AI provider and the same anti-hallucination stance (never invent
figures or partnerships the profile doesn't contain), but with its own system
prompt and section plan per document type.
"""
import json

from app.services.ai_provider import generate, GenerateRequest


DOCUMENT_SYSTEM = """You write professional business documents for founders and companies. You are given a company profile and a document type.

HARD RULES:
- Write in clear, professional prose. Not bullet points.
- Each section has a heading and 2-4 paragraphs.
- Be specific — use the company's actual name, numbers, and context from the profile.
- Never invent figures or partnerships not in the profile.
- Write as if representing the company directly.

OUTPUT FORMAT — return valid JSON only:
{
  "title": "Document title",
  "sections": [
    {
      "heading": "Section heading",
      "body": "Full prose paragraphs for this section."
    }
  ]
}

DOCUMENT TYPES:
- proposal: Executive summary, Problem we solve, Our solution, Why us, Investment/engagement ask, Next steps
- business_plan: Executive summary, Company overview, Market opportunity, Product/service, Business model, Go-to-market, Team, Financial projections, Funding ask
- investment_memo: Company snapshot, The opportunity, Product and traction, Market size, Business model, Competitive advantage, Risks, The ask
- pitch_summary: One-page — Company overview, Problem, Solution, Traction, Ask
- report: Executive summary, Background, Findings, Analysis, Recommendations, Conclusion
- general: Introduction, Main content, Conclusion
"""


# The known document types, with a human-readable label. Kept here so the
# router can validate an incoming doc_type against one list.
DOC_TYPES: dict[str, str] = {
    "proposal": "Proposal",
    "business_plan": "Business plan",
    "investment_memo": "Investment memo",
    "pitch_summary": "Pitch summary",
    "report": "Report",
    "general": "General document",
}


# The profile fields worth putting in front of the model, in a sensible reading
# order. Only non-empty ones are included, so a sparse profile produces a short
# prompt rather than a wall of empty labels.
_PROFILE_FIELDS: list[str] = [
    "company_name", "one_liner", "website_url", "industry", "stage", "location",
    "founded_date", "incorporation_status", "incorporation_country",
    "problem", "solution", "evidence_of_innovation", "differentiation",
    "patents_or_ip", "market_research", "market_opportunity", "tam", "sam",
    "som", "competitive_landscape", "go_to_market", "traction", "key_metrics",
    "business_model", "pricing_model", "unit_economics", "customer_segment",
    "funding_ask", "use_of_funds", "previous_funding", "valuation_expectation",
    "risks_and_mitigations", "why_now", "milestones_next_12m", "impact_outcomes",
]


def _build_profile_block(profile: dict) -> str:
    lines: list[str] = []
    name = (profile.get("company_name") or "").strip() or "the company"
    lines.append(f"COMPANY: {name}")

    for key in _PROFILE_FIELDS:
        if key == "company_name":
            continue
        value = (profile.get(key) or "").strip()
        if value:
            lines.append(f"\n{key.upper().replace('_', ' ')}:\n{value}")

    # Team members, flattened to a readable list so a "Team" section has
    # something concrete to draw on.
    team = profile.get("team_members") or []
    if isinstance(team, list) and team:
        lines.append("\nTEAM:")
        for member in team:
            if not isinstance(member, dict):
                continue
            n = (member.get("name") or "").strip()
            role = (member.get("role") or "").strip()
            bio = (member.get("bio") or "").strip()
            if n or role:
                lines.append(f"- {n}{f' — {role}' if role else ''}{f': {bio}' if bio else ''}")

    return "\n".join(lines)


def _strip_fences(raw: str) -> str:
    cleaned = raw.strip()
    if cleaned.startswith("```"):
        cleaned = cleaned.split("```")[1]
        if cleaned.startswith("json"):
            cleaned = cleaned[4:]
    return cleaned.strip()


def generate_document(
    profile: dict,
    doc_type: str,
    brief: str | None = None,
    api_key_override: str | None = None,
) -> dict:
    """
    Writes a document of ``doc_type`` from the company ``profile``.

    Returns ``{"title": str, "sections": [{"heading", "body"}, ...]}``. Raises
    ValueError if the model returns output that can't be parsed as JSON.
    """
    if doc_type not in DOC_TYPES:
        doc_type = "general"

    prompt_parts = [f"DOCUMENT TYPE: {doc_type}"]
    if brief and brief.strip():
        # Extra instructions from the user ride above the profile so they frame
        # how the material is used, but never license inventing facts.
        prompt_parts.append(
            "ADDITIONAL INSTRUCTIONS (follow these, but still never invent "
            f"figures or facts not in the profile):\n{brief.strip()}"
        )
    prompt_parts.append("COMPANY PROFILE:\n" + _build_profile_block(profile))
    prompt = "\n\n".join(prompt_parts)

    raw = generate(GenerateRequest(
        task="document",
        system=DOCUMENT_SYSTEM,
        prompt=prompt,
        max_tokens=3000,
        api_key_override=api_key_override,
    ))

    try:
        data = json.loads(_strip_fences(raw))
    except Exception as e:
        raise ValueError(f"The document model returned output that couldn't be parsed: {e}")

    sections: list[dict] = []
    for item in data.get("sections", []):
        if not isinstance(item, dict):
            continue
        heading = (item.get("heading") or "").strip()
        body = (item.get("body") or "").strip()
        if not heading and not body:
            continue
        sections.append({"heading": heading, "body": body})

    title = (data.get("title") or "").strip()
    return {"title": title, "sections": sections}
