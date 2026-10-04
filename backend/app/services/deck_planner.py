"""
The Planner.

Runs BEFORE generation. It reads the company material and the chosen
structure and produces a strategic Brief: the one core argument, an honest
inventory of the evidence, a per-slide strategy (argument + evidence +
confidence + preferred block), a possible structure override, the founder
edge, the investor kill-shots the deck must pre-answer, and the gaps.

One LLM call. Every failure degrades to None so generation can proceed
without a brief rather than erroring the whole request.
"""
from __future__ import annotations

import json
import logging

from app.services.ai_provider import generate, GenerateRequest
from app.services.deck_structures import DeckStructure

log = logging.getLogger(__name__)


PLANNER_SYSTEM = """You are a senior pitch deck strategist who has reviewed thousands of decks and sat in hundreds of investor meetings. You are given a founder's company profile and evidence. Your job is NOT to write the deck — that comes next. Your job is to think before writing.

Produce a strategic brief that answers:
1. CORE ARGUMENT: What is the single strongest honest claim this company can make? One sentence. This becomes the spine of the deck.
2. EVIDENCE INVENTORY: For each piece of evidence in the profile, rate it: STRONG (specific, verifiable, impressive), WEAK (vague, thin, generic), or MISSING (needed but absent). Be honest.
3. SLIDE STRATEGY: For each slide role in the chosen structure, specify:
   - The specific argument this slide makes (not a topic — an argument)
   - Which evidence supports it (cite field names)
   - Confidence: HIGH (strong evidence), MEDIUM (thin evidence), LOW (no evidence — say less, not less honestly)
   - Block type recommendation: which content block (stat/comparison/timeline/chips/quote/bars) best expresses this slide's data, if any
4. STRUCTURE OVERRIDE: Should any slide be reordered, split, or dropped given this specific company's evidence? If traction is the strongest asset, say so and recommend traction-led. If a required slide has no evidence, flag it explicitly rather than letting generation pad it.
5. FOUNDER EDGE: What specifically makes this team the right people to build this? If the profile doesn't say, flag it as a gap.
6. KILL SHOTS: What are the 2-3 questions a sharp investor will ask in the first 10 minutes? The deck must pre-answer these.

Return valid JSON only:
{
  "core_argument": string,
  "evidence_inventory": [{ "field": string, "rating": "STRONG" | "WEAK" | "MISSING", "note": string }],
  "slide_briefs": [{
    "role": string,
    "argument": string,
    "evidence_fields": [string],
    "confidence": "HIGH" | "MEDIUM" | "LOW",
    "block_type": string | null,
    "notes": string
  }],
  "structure_override": string | null,
  "founder_edge": string,
  "kill_shots": [string],
  "gaps": [string]
}"""


def _parse_json(raw: str) -> dict | None:
    cleaned = raw.strip()
    if cleaned.startswith("```"):
        cleaned = cleaned.split("```")[1]
        if cleaned.startswith("json"):
            cleaned = cleaned[4:]
    try:
        data = json.loads(cleaned.strip())
        return data if isinstance(data, dict) else None
    except Exception:
        return None


def _normalise(brief: dict) -> dict:
    """Coerce the brief into the documented shape, tolerating a model that
    omits a field. Never fabricates content — missing fields become empty."""
    def _list(v):
        return v if isinstance(v, list) else []
    return {
        "core_argument": str(brief.get("core_argument") or "").strip(),
        "evidence_inventory": _list(brief.get("evidence_inventory")),
        "slide_briefs": _list(brief.get("slide_briefs")),
        "structure_override": (brief.get("structure_override") or None),
        "founder_edge": str(brief.get("founder_edge") or "").strip(),
        "kill_shots": [str(k).strip() for k in _list(brief.get("kill_shots")) if str(k).strip()],
        "gaps": [str(g).strip() for g in _list(brief.get("gaps")) if str(g).strip()],
    }


def run_planner(
    source_text: str,
    structure: DeckStructure,
    api_key_override: str | None = None,
) -> dict | None:
    """
    Makes the single Planner call and returns a normalised Brief dict, or None
    if the call or parse fails. `source_text` is the same company material
    assembled for generation (evidence + the chosen structure's role list).
    """
    roles = "\n".join(
        f"- {r.key}: {r.purpose}" for r in structure.content_roles
    )
    prompt = (
        f"{source_text}\n\n"
        f"--- CHOSEN STRUCTURE: {structure.name} ({structure.id}) ---\n"
        f"Slide roles, in order:\n{roles}\n\n"
        "Produce the strategic brief as JSON."
    )
    try:
        raw = generate(GenerateRequest(
            task="deck_planner",
            system=PLANNER_SYSTEM,
            prompt=prompt,
            max_tokens=2500,
            api_key_override=api_key_override,
        ))
    except Exception:
        log.error("Planner call failed", exc_info=True)
        return None

    brief = _parse_json(raw)
    if brief is None:
        log.warning("Planner returned unparseable output")
        return None
    return _normalise(brief)
