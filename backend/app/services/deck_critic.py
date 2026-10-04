"""
The Critic.

Runs AFTER generation. It reads the drafted slides alongside the Brief and
the original profile and returns findings — specific, actionable problems
tied to specific slides — plus an honest overall read, which kill-shots the
deck fails to pre-answer, and the strongest/weakest slide.

One LLM call. Failures degrade to None.
"""
from __future__ import annotations

import json
import logging

from app.services.ai_provider import generate, GenerateRequest

log = logging.getLogger(__name__)


CRITIC_SYSTEM = """You are a skeptical Series A investor reading a pitch deck for the first time. You have seen 500 decks this year. You are not hostile — you want to fund great companies. But you have a very low tolerance for:
- Claims that aren't backed by the evidence shown
- Vague language where a number should be
- A moat that is actually 'we work hard'
- Market sizes that don't connect to the go-to-market
- Team slides that say 'experienced' without saying experienced at what
- Any slide that would make you want to close the deck

For each slide, identify specific problems. Be surgical — one real problem is worth more than five nitpicks. If a slide is genuinely strong, say so.

Return valid JSON only:
{
  "overall": string (one honest paragraph — would you take the meeting?),
  "slide_findings": [{
    "role": string,
    "severity": "CRITICAL" | "IMPORTANT" | "POLISH",
    "finding": string,
    "suggestion": string,
    "should_rewrite": boolean
  }],
  "missing_pre_answers": [string],
  "strongest_slide": string,
  "weakest_slide": string
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


def _slides_text(slides: list) -> str:
    """A compact rendering of the drafted slides for the Critic to read."""
    out: list[str] = []
    for i, s in enumerate(slides, 1):
        kind = getattr(s, "kind", None) or (s.get("kind") if isinstance(s, dict) else "")
        title = getattr(s, "title", None) or (s.get("title") if isinstance(s, dict) else "")
        lead = getattr(s, "lead", None) or (s.get("lead") if isinstance(s, dict) else "")
        points = getattr(s, "points", None)
        if points is None and isinstance(s, dict):
            points = s.get("points") or []
        blocks = getattr(s, "blocks", None)
        if blocks is None and isinstance(s, dict):
            blocks = s.get("blocks") or []
        out.append(f"[{i}] role={kind} | title: {title}\n    lead: {lead}")
        for p in (points or []):
            out.append(f"    - {p}")
        if blocks:
            out.append(f"    blocks: {json.dumps(blocks, ensure_ascii=False)[:800]}")
    return "\n".join(out)


def run_critic(
    slides: list,
    brief: dict | None,
    profile: dict,
    api_key_override: str | None = None,
) -> dict | None:
    """
    Makes the single Critic call and returns the findings dict, or None on
    failure. `slides` is the drafted SlideCopy list (or dicts).
    """
    kill_shots = (brief or {}).get("kill_shots") or []
    core = (brief or {}).get("core_argument") or ""
    profile_lines = [
        f"{k}: {v}" for k, v in profile.items()
        if isinstance(v, str) and v.strip()
    ]
    prompt = (
        "THE DRAFTED DECK:\n" + _slides_text(slides) + "\n\n"
        + (f"CORE ARGUMENT (from the brief): {core}\n" if core else "")
        + (f"KILL SHOTS THE DECK MUST PRE-ANSWER:\n" + "\n".join(f"- {k}" for k in kill_shots) + "\n\n" if kill_shots else "")
        + "ORIGINAL FOUNDER PROFILE (the only evidence that exists):\n"
        + "\n".join(profile_lines)
        + "\n\nReturn your critique as JSON."
    )
    try:
        raw = generate(GenerateRequest(
            task="deck_critic",
            system=CRITIC_SYSTEM,
            prompt=prompt,
            max_tokens=2500,
            api_key_override=api_key_override,
        ))
    except Exception:
        log.error("Critic call failed", exc_info=True)
        return None

    findings = _parse_json(raw)
    if findings is None:
        log.warning("Critic returned unparseable output")
        return None
    # Coerce the shape defensively.
    if not isinstance(findings.get("slide_findings"), list):
        findings["slide_findings"] = []
    if not isinstance(findings.get("missing_pre_answers"), list):
        findings["missing_pre_answers"] = []
    findings.setdefault("overall", "")
    findings.setdefault("strongest_slide", "")
    findings.setdefault("weakest_slide", "")
    return findings
