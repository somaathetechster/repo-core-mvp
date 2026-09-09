"""
Thin abstraction over LLM providers so the rest of the app calls generate(...)
instead of talking to a specific SDK. Makes BYOK and provider-swapping possible
later without touching business logic.
"""
from dataclasses import dataclass
from anthropic import Anthropic
from app.core.config import settings


@dataclass
class GenerateRequest:
    task: str            # e.g. "summarize_repo", "write_narrative_slide"
    system: str
    prompt: str
    max_tokens: int = 1024
    api_key_override: str | None = None  # set when a user is on BYOK


def generate(req: GenerateRequest) -> str:
    api_key = req.api_key_override or settings.anthropic_api_key
    if not api_key:
        raise RuntimeError("No Anthropic API key configured (platform key missing and no BYOK key provided).")

    client = Anthropic(api_key=api_key)
    response = client.messages.create(
        model="claude-sonnet-4-6",
        max_tokens=req.max_tokens,
        system=req.system,
        messages=[{"role": "user", "content": req.prompt}],
    )
    return "".join(block.text for block in response.content if block.type == "text")
