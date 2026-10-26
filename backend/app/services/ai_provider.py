"""
Thin abstraction over LLM providers so the rest of the app calls generate(...)
instead of talking to a specific SDK. Makes BYOK and provider-swapping possible
later without touching business logic.

Provider is picked via config (AI_PROVIDER=anthropic|openai) or per-request override.
"""
import time
from dataclasses import dataclass
from anthropic import Anthropic
from openai import OpenAI
from app.core.config import settings


@dataclass
class GenerateRequest:
    task: str            # e.g. "summarize_repo", "write_narrative_slide"
    system: str
    prompt: str
    max_tokens: int = 1024
    api_key_override: str | None = None  # set when a user is on BYOK
    provider_override: str | None = None  # "anthropic" | "openai" — defaults to settings.ai_provider


def generate(req: GenerateRequest, max_retries: int = 3) -> str:
    """
    Runs a generation, retrying on rate limits with exponential backoff.

    Per-minute token limits are a normal operating condition on smaller
    accounts, not an error: a request that would succeed thirty seconds
    later shouldn't surface to the user as a failed analysis.
    """
    provider = req.provider_override or settings.ai_provider

    last_error: Exception | None = None
    for attempt in range(max_retries):
        try:
            if provider == "openai":
                return _generate_openai(req)
            elif provider == "anthropic":
                return _generate_anthropic(req)
            else:
                raise RuntimeError(
                    f"Unknown AI_PROVIDER '{provider}'. Expected 'anthropic' or 'openai'."
                )
        except Exception as e:
            message = str(e).lower()
            is_rate_limit = "rate limit" in message or "429" in message or "tokens per min" in message
            if not is_rate_limit or attempt == max_retries - 1:
                if is_rate_limit:
                    raise RuntimeError(
                        "The AI provider's rate limit was hit repeatedly. This usually means the "
                        "account's tokens-per-minute allowance is low for a request this size. "
                        "Wait a minute and try again, or raise the limit on the provider account."
                    ) from e
                raise
            last_error = e
            # 2s, 8s, 18s: long enough for a per-minute window to refill.
            time.sleep(2 * (attempt + 1) ** 2)

    raise RuntimeError(f"Generation failed after {max_retries} attempts: {last_error}")


def _generate_anthropic(req: GenerateRequest) -> str:
    api_key = req.api_key_override or settings.anthropic_api_key
    if not api_key:
        raise RuntimeError("No Anthropic API key configured (platform key missing and no BYOK key provided).")

    client = Anthropic(api_key=api_key)
    response = client.messages.create(
        model="claude-sonnet-4-6",
        max_tokens=req.max_tokens,
        temperature=0.3,
        system=req.system,
        messages=[{"role": "user", "content": req.prompt}],
    )
    return "".join(block.text for block in response.content if block.type == "text")


def _generate_openai(req: GenerateRequest) -> str:
    api_key = req.api_key_override or settings.openai_api_key
    if not api_key:
        raise RuntimeError("No OpenAI API key configured (platform key missing and no BYOK key provided).")

    client = OpenAI(api_key=api_key)
    response = client.chat.completions.create(
        model="gpt-4o",
        max_tokens=req.max_tokens,
        temperature=0.3,
        messages=[
            {"role": "system", "content": req.system},
            {"role": "user", "content": req.prompt},
        ],
    )
    return response.choices[0].message.content or ""
