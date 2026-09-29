"""AI assistance endpoints."""
from typing import Any, Literal

from anthropic import Anthropic
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from app.core.config import settings
from app.core.deps import get_current_user_id

router = APIRouter(prefix="/ai", tags=["ai"])


class CoachMessage(BaseModel):
    role: Literal["user", "assistant"]
    content: str


class DeckCoachRequest(BaseModel):
    messages: list[CoachMessage] = Field(min_length=1)
    deck_context: dict[str, Any] = Field(default_factory=dict)


def coach_system_prompt(context: dict[str, Any]) -> str:
    deck_name = context.get("deck_name") or "this deck"
    brief = context.get("brief") or {}
    programme = brief.get("programme") if isinstance(brief, dict) else None
    criteria = brief.get("selection_criteria", []) if isinstance(brief, dict) else []
    findings = context.get("findings", [])
    approved = context.get("approved_ids", [])
    rejected = context.get("rejected_ids", [])
    profile = context.get("profile") or {}
    finding_lines = "\n".join(
        f"- {item.get('title', 'Untitled')} ({item.get('severity', 'unknown')})"
        for item in findings if isinstance(item, dict)
    ) or "- No findings"
    criteria_text = "; ".join(str(item) for item in criteria) or "None provided"
    one_liner = profile.get("one_liner", "") if isinstance(profile, dict) else ""

    return f"""You are a pitch deck coach reviewing {deck_name} for {programme or 'investors'}.
The deck has these findings:
{finding_lines}
{len(approved)} findings are marked Done. {len(rejected)} are dismissed.
Programme context: {criteria_text}.
Company: {one_liner or 'No one-line company description provided.'}

Answer the founder's questions directly and specifically. Reference their actual findings by name.
If they ask why a finding was raised, explain exactly what the reviewer checked and what was missing.
If they ask how to fix something, give them the specific words or numbers to add, drawn from their profile where possible.
Be direct. No filler. Max 3 paragraphs per reply."""


@router.post("/deck-coach")
async def deck_coach(body: DeckCoachRequest, _user_id: str = Depends(get_current_user_id)):
    if not settings.anthropic_api_key:
        raise HTTPException(status_code=503, detail="AI coach is not configured.")
    try:
        client = Anthropic(api_key=settings.anthropic_api_key)
        response = client.messages.create(
            model="claude-sonnet-4-6",
            max_tokens=900,
            system=coach_system_prompt(body.deck_context),
            messages=[message.model_dump() for message in body.messages],
        )
        reply = "".join(block.text for block in response.content if block.type == "text")
        return {"reply": reply}
    except Exception as exc:
        raise HTTPException(status_code=502, detail="The AI coach could not answer right now.") from exc
