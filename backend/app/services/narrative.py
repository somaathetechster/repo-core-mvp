"""
Converts a RepoSummary into founder-facing narrative text for the deck.
Every sentence should be traceable to a field on RepoSummary — this is the
"evidence-backed" principle: the AI is not inventing engineering claims,
it's phrasing ones we already extracted factually.
"""
from app.services.github_extract import RepoSummary
from app.services.ai_provider import generate, GenerateRequest

SYSTEM_PROMPT = """You write concise, factual "technology" slide content for startup investor pitch decks.
Rules:
- Only state facts present in the provided data. Never invent metrics, users, revenue, or claims not given.
- Keep it to 3-4 sentences.
- Confident, investor-appropriate tone — no hype adjectives like "revolutionary" or "cutting-edge".
- If data is sparse, write less rather than pad with vague language.
"""


def build_technology_slide_content(summary: RepoSummary, api_key_override: str | None = None) -> str:
    dep_list = ", ".join(
        dep for deps in summary.detected_dependencies.values() for dep in deps[:8]
    ) or "none detected"

    prompt = f"""Repository data:
- Name: {summary.full_name}
- Description: {summary.description or "none provided"}
- Primary language: {summary.primary_language}
- Language breakdown (bytes): {summary.languages}
- Contributors: {summary.contributor_count}
- Commits in last 90 days: {summary.commit_count_last_90_days}
- Key dependencies detected: {dep_list}
- Has automated tests: {summary.has_tests}
- Last pushed: {summary.last_pushed_at}

Write the content for a "Technology" slide based only on this data."""

    return generate(GenerateRequest(
        task="write_technology_slide",
        system=SYSTEM_PROMPT,
        prompt=prompt,
        max_tokens=300,
        api_key_override=api_key_override,
    ))
