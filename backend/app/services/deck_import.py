"""
Importing an existing pitch deck into the company profile.

Founders rarely start from nothing: they have a deck already, and retyping
it into a form is the fastest way to make them abandon the product. This
reads a PDF or PPTX, recovers the text slide by slide, and proposes which
profile field each piece of content belongs to.

Everything is a proposal. The import endpoint returns suggestions with the
slide they came from and a confidence signal, and the founder accepts field
by field. Silently overwriting a profile with a model's guesses would be
worse than making them type.
"""
import io
import re
from dataclasses import dataclass, field

from app.services.ai_provider import generate, GenerateRequest


@dataclass
class ImportedSlide:
    index: int
    title: str
    body: str
    notes: str = ""

    @property
    def combined(self) -> str:
        parts = [self.title, self.body]
        if self.notes:
            parts.append(f"(speaker notes) {self.notes}")
        return "\n".join(p for p in parts if p.strip())


@dataclass
class FieldSuggestion:
    field: str
    value: str
    source_slides: list[int] = field(default_factory=list)
    confidence: str = "medium"   # high | medium | low


@dataclass
class DeckImport:
    slides: list[ImportedSlide]
    suggestions: list[FieldSuggestion]
    detected_company_name: str | None = None
    warnings: list[str] = field(default_factory=list)


# ---------------------------------------------------------------------------
# Extraction
# ---------------------------------------------------------------------------

def extract_pptx(file_bytes: bytes) -> list[ImportedSlide]:
    from pptx import Presentation

    prs = Presentation(io.BytesIO(file_bytes))
    slides: list[ImportedSlide] = []

    for i, slide in enumerate(prs.slides, start=1):
        title = ""
        body_parts: list[str] = []

        for shape in slide.shapes:
            if not shape.has_text_frame:
                continue
            text = "\n".join(p.text for p in shape.text_frame.paragraphs).strip()
            if not text:
                continue
            # The title placeholder is the reliable signal when present;
            # otherwise the largest text block at the top usually is one.
            is_title = False
            try:
                if shape.placeholder_format is not None and shape.placeholder_format.idx == 0:
                    is_title = True
            except (ValueError, AttributeError):
                pass
            if is_title and not title:
                title = text
            else:
                body_parts.append(text)

        if not title and body_parts:
            title = body_parts[0].split("\n")[0][:120]

        notes = ""
        try:
            if slide.has_notes_slide:
                notes = (slide.notes_slide.notes_text_frame.text or "").strip()
        except Exception:
            pass

        slides.append(ImportedSlide(index=i, title=title, body="\n".join(body_parts), notes=notes))

    return slides


def extract_pdf(file_bytes: bytes) -> list[ImportedSlide]:
    import pdfplumber

    slides: list[ImportedSlide] = []
    with pdfplumber.open(io.BytesIO(file_bytes)) as pdf:
        for i, page in enumerate(pdf.pages, start=1):
            text = (page.extract_text() or "").strip()
            if not text:
                continue
            lines = [l.strip() for l in text.split("\n") if l.strip()]
            title = lines[0][:120] if lines else ""
            body = "\n".join(lines[1:])
            slides.append(ImportedSlide(index=i, title=title, body=body))
    return slides


def extract_deck(file_bytes: bytes, filename: str) -> list[ImportedSlide]:
    lower = filename.lower()
    if lower.endswith(".pptx") or lower.endswith(".potx"):
        return extract_pptx(file_bytes)
    if lower.endswith(".pdf"):
        return extract_pdf(file_bytes)
    raise ValueError("Only PDF and PowerPoint (.pptx) decks can be imported.")


# ---------------------------------------------------------------------------
# Mapping to profile fields
# ---------------------------------------------------------------------------

PROFILE_FIELDS = {
    "company_name": "The company's name.",
    "one_liner": "A single sentence describing what the company does.",
    "problem": "The problem being solved, and who has it.",
    "solution": "How the company solves it.",
    "market_opportunity": "Market size, segments, why now.",
    "competitive_landscape": "Competitors and how this differs.",
    "traction": "Evidence of progress: users, revenue, partnerships, pilots.",
    "key_metrics": "Specific numbers the company reports.",
    "business_model": "How it makes money.",
    "pricing_model": "What customers pay and how.",
    "evidence_of_innovation": "What is technically or operationally hard here.",
    "risks_and_mitigations": "Known risks and how they're addressed.",
    "funding_ask": "How much is being raised and what for.",
}

MAPPING_SYSTEM = """You are extracting a startup's company profile from their existing pitch deck.

You will be given the text of each slide. Map the content onto the profile fields listed. 

Rules:
- Use the founder's own words wherever possible. Lightly tidy grammar and remove slide-formatting artefacts (bullet markers, stray line breaks), but do not rewrite their claims, invent numbers, or add detail that isn't in the deck.
- Only fill a field if the deck actually contains that content. Leave it out entirely otherwise. A missing field is fine; a fabricated one is not.
- For each field, record which slide numbers it came from.
- Mark confidence: "high" when a slide clearly covers that field, "medium" when you inferred it from related content, "low" when it's a loose guess.
- If several slides contribute, combine them into coherent prose rather than concatenating fragments.

Return valid JSON only, no markdown fences:
{
  "company_name": "...",
  "suggestions": [
    {"field": "problem", "value": "...", "source_slides": [3], "confidence": "high"}
  ]
}"""


def map_to_profile(slides: list[ImportedSlide], api_key_override: str | None = None) -> DeckImport:
    if not slides:
        raise ValueError("No text could be read from that deck. If it's a PDF of images, the text isn't selectable.")

    # Keep the prompt inside a sane token budget: decks can run long, and
    # the later slides (appendix, financial detail) carry less profile
    # signal than the first twenty.
    budget = 24_000
    lines: list[str] = []
    used = 0
    truncated = False
    for s in slides:
        block = f"--- SLIDE {s.index} ---\n{s.combined}\n"
        if used + len(block) > budget:
            truncated = True
            break
        lines.append(block)
        used += len(block)

    field_list = "\n".join(f"- {k}: {v}" for k, v in PROFILE_FIELDS.items())
    prompt = f"PROFILE FIELDS TO FILL:\n{field_list}\n\nDECK CONTENT:\n\n" + "\n".join(lines)

    raw = generate(GenerateRequest(
        task="deck_import",
        system=MAPPING_SYSTEM,
        prompt=prompt,
        max_tokens=3000,
        api_key_override=api_key_override,
    ))

    import json
    cleaned = raw.strip()
    if cleaned.startswith("```"):
        cleaned = cleaned.split("```")[1]
        if cleaned.startswith("json"):
            cleaned = cleaned[4:]
    try:
        data = json.loads(cleaned.strip())
    except Exception as e:
        raise ValueError(f"Could not parse the extraction result: {e}")

    suggestions: list[FieldSuggestion] = []
    for item in data.get("suggestions", []):
        name = item.get("field")
        value = (item.get("value") or "").strip()
        if name in PROFILE_FIELDS and value:
            suggestions.append(FieldSuggestion(
                field=name,
                value=value,
                source_slides=item.get("source_slides", []),
                confidence=item.get("confidence", "medium"),
            ))

    warnings: list[str] = []
    if truncated:
        warnings.append(
            f"Only the first {len(lines)} of {len(slides)} slides were read, to stay within model limits. "
            "Later slides may contain detail that wasn't captured."
        )
    missing = [f for f in PROFILE_FIELDS if not any(s.field == f for s in suggestions)]
    if missing:
        warnings.append(
            "No content was found for: " + ", ".join(m.replace("_", " ") for m in missing) + "."
        )

    return DeckImport(
        slides=slides,
        suggestions=suggestions,
        detected_company_name=(data.get("company_name") or "").strip() or None,
        warnings=warnings,
    )


def import_to_dict(result: DeckImport) -> dict:
    return {
        "detected_company_name": result.detected_company_name,
        "slide_count": len(result.slides),
        "slides": [
            {"index": s.index, "title": s.title, "excerpt": s.body[:300]} for s in result.slides
        ],
        "suggestions": [
            {
                "field": s.field,
                "value": s.value,
                "source_slides": s.source_slides,
                "confidence": s.confidence,
            }
            for s in result.suggestions
        ],
        "warnings": result.warnings,
    }
