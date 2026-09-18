"""
Turns a DeepRepoAnalysis into investor-grade technical assessment.

This is deliberately NOT "summarize the repo." It answers the questions a
technical partner at a fund actually asks in diligence, using real source
code as the evidence base:

  - What is this system, architecturally?
  - What's genuinely hard here, and what's commodity?
  - How deep are the integrations, really?
  - What does the data model reveal about the business?
  - Is this production infrastructure or a prototype?
  - What are the honest technical risks?

The model sees actual source code here, not just metadata. That's the whole
point: a system that has read the payment reconciliation logic can say
something an investor respects. A system that only counted bytes cannot.
"""
from dataclasses import dataclass
from app.services.deep_repo_analysis import DeepRepoAnalysis
from app.services.ai_provider import generate, GenerateRequest


DILIGENCE_SYSTEM_PROMPT = """You are a technical partner at a venture fund conducting engineering due diligence. You have been given real source code and structural analysis from a startup's private repository.

Write an assessment that a skeptical, technically literate investor would find genuinely useful. Be specific and concrete. Reference actual things you observed in the code: named services, integration patterns, data models, architectural decisions.

Rules:
- Ground every claim in what you actually observed. Never invent metrics, users, revenue, or team facts, none of that is in this data.
- Distinguish what is genuinely hard engineering from what is commodity scaffolding. Investors are paying for the hard parts.
- Be honest about weaknesses and risks. A diligence report that only flatters is worthless and destroys credibility.
- Use plain, direct language. No breathless adjectives, no "cutting-edge" or "revolutionary".
- If the evidence is thin in some area, say so rather than padding.

Output valid JSON matching exactly this shape, no markdown fences:
{
  "system_summary": "2-3 sentences: what this system actually is and does, architecturally.",
  "what_is_hard": ["specific engineering challenge this codebase solves, grounded in observed code", "..."],
  "what_is_commodity": ["parts that are standard scaffolding, honestly labeled", "..."],
  "architecture_notes": ["concrete architectural observation", "..."],
  "integration_depth": [{"system": "name", "assessment": "how deeply integrated, based on evidence"}],
  "data_model_insight": "What the stored entities reveal about the business itself.",
  "production_readiness": "Honest assessment: prototype, early production, or mature production, and why.",
  "technical_risks": ["honest risk an investor should probe", "..."],
  "investor_headline": "One sentence a technical investor would find compelling and could verify, or an honest statement if the evidence doesn't support one."
}"""


SLIDE_SYSTEM_PROMPT = """You write the Technology slide for a startup's investor pitch deck, working from a real technical analysis of their codebase.

This slide must make a technically literate investor lean forward. It should name what is actually hard about this system and why that constitutes a moat, using specifics from the analysis.

Rules:
- Only state what the analysis supports. Never invent metrics, users, revenue, or team facts.
- Lead with the hardest, most defensible thing the system does.
- Be concrete: name real integrations, real architectural decisions, real scale indicators.
- 3-5 sentences maximum. Dense, not padded.
- Confident and plain. No hype adjectives.

Return only the slide text, no JSON, no preamble."""


@dataclass
class TechnicalDiligence:
    system_summary: str
    what_is_hard: list[str]
    what_is_commodity: list[str]
    architecture_notes: list[str]
    integration_depth: list[dict]
    data_model_insight: str
    production_readiness: str
    technical_risks: list[str]
    investor_headline: str


def _build_evidence_prompt(analysis: DeepRepoAnalysis) -> str:
    """
    Assembles the real evidence package handed to the model. Source code
    excerpts are included because reading the actual logic is the entire
    difference between this and a metadata summarizer.
    """
    lines: list[str] = []
    lines.append(f"REPOSITORY: {analysis.full_name}")
    if analysis.description:
        lines.append(f"Stated description: {analysis.description}")
    lines.append(f"Primary language: {analysis.primary_language}")
    lines.append(f"Language breakdown (bytes): {analysis.languages}")
    lines.append(f"Contributors: {analysis.contributor_count}")
    lines.append(f"Commits in last 90 days: {analysis.commit_count_last_90_days}")
    lines.append(f"Approximate API endpoints declared: {analysis.api_endpoint_count}")

    if analysis.directory_structure:
        lines.append("\nDIRECTORY STRUCTURE (top areas by file count):")
        for d in analysis.directory_structure:
            lines.append(f"  {d}")

    if analysis.data_model_names:
        lines.append("\nDATA MODEL, entities/tables declared in code:")
        lines.append("  " + ", ".join(analysis.data_model_names))

    if analysis.detected_integrations:
        lines.append("\nTHIRD-PARTY SYSTEMS REFERENCED IN SOURCE:")
        for integ in analysis.detected_integrations:
            lines.append(
                f"  {integ['name']} ({integ['category']}), referenced in {integ['file_count']} file(s), "
                f"e.g. {', '.join(integ['example_paths'])}"
            )

    if analysis.maturity_signals:
        lines.append("\nENGINEERING PRACTICE MARKERS FOUND:")
        for m in analysis.maturity_signals:
            lines.append(f"  {m}")

    if analysis.dependencies_by_manifest:
        lines.append("\nDEPENDENCIES BY MANIFEST:")
        for manifest, dep_list in analysis.dependencies_by_manifest.items():
            lines.append(f"  {manifest}: {', '.join(dep_list)}")

    if analysis.source_excerpts:
        lines.append("\n=== ACTUAL SOURCE CODE ===")
        lines.append("(real file contents from the repository, read directly)")
        for ex in analysis.source_excerpts:
            lines.append(f"\n--- FILE: {ex['path']}  [category: {ex['category']}] ---")
            lines.append(ex["content"])

    return "\n".join(lines)


def generate_technical_diligence(
    analysis: DeepRepoAnalysis, api_key_override: str | None = None
) -> TechnicalDiligence:
    import json

    raw = generate(GenerateRequest(
        task="technical_diligence",
        system=DILIGENCE_SYSTEM_PROMPT,
        prompt=_build_evidence_prompt(analysis),
        max_tokens=3000,
        api_key_override=api_key_override,
    ))

    # Models occasionally wrap JSON in fences despite instructions; strip
    # them rather than failing the whole analysis on a formatting quirk.
    cleaned = raw.strip()
    if cleaned.startswith("```"):
        cleaned = cleaned.split("```")[1]
        if cleaned.startswith("json"):
            cleaned = cleaned[4:]
    cleaned = cleaned.strip()

    try:
        data = json.loads(cleaned)
    except Exception as e:
        raise ValueError(f"Diligence model returned unparseable output: {e}")

    return TechnicalDiligence(
        system_summary=data.get("system_summary", ""),
        what_is_hard=data.get("what_is_hard", []),
        what_is_commodity=data.get("what_is_commodity", []),
        architecture_notes=data.get("architecture_notes", []),
        integration_depth=data.get("integration_depth", []),
        data_model_insight=data.get("data_model_insight", ""),
        production_readiness=data.get("production_readiness", ""),
        technical_risks=data.get("technical_risks", []),
        investor_headline=data.get("investor_headline", ""),
    )


def generate_technology_slide(
    analysis: DeepRepoAnalysis,
    diligence: TechnicalDiligence,
    api_key_override: str | None = None,
) -> str:
    """
    Writes the deck's Technology slide from the diligence findings, so the
    slide inherits the depth of the full analysis rather than being
    generated from metadata independently.
    """
    prompt = f"""TECHNICAL ANALYSIS OF {analysis.full_name}:

System summary: {diligence.system_summary}

What is genuinely hard here:
{chr(10).join('- ' + h for h in diligence.what_is_hard)}

Architecture notes:
{chr(10).join('- ' + a for a in diligence.architecture_notes)}

Integration depth:
{chr(10).join(f"- {i.get('system', '')}: {i.get('assessment', '')}" for i in diligence.integration_depth)}

Data model insight: {diligence.data_model_insight}

Production readiness: {diligence.production_readiness}

Scale indicators: {analysis.api_endpoint_count} API endpoints, {len(analysis.data_model_names)} data entities, {analysis.commit_count_last_90_days} commits in 90 days.

Write the Technology slide."""

    return generate(GenerateRequest(
        task="technology_slide",
        system=SLIDE_SYSTEM_PROMPT,
        prompt=prompt,
        max_tokens=600,
        api_key_override=api_key_override,
    ))


def diligence_to_dict(d: TechnicalDiligence) -> dict:
    return {
        "system_summary": d.system_summary,
        "what_is_hard": d.what_is_hard,
        "what_is_commodity": d.what_is_commodity,
        "architecture_notes": d.architecture_notes,
        "integration_depth": d.integration_depth,
        "data_model_insight": d.data_model_insight,
        "production_readiness": d.production_readiness,
        "technical_risks": d.technical_risks,
        "investor_headline": d.investor_headline,
    }
