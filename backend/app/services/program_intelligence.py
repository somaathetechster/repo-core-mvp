"""
Program intelligence.

A pitch deck is not a document about a company. It is an argument aimed at a
specific reader, and different readers select on different things. A seed VC
is underwriting a return and reads for market size, unit economics and the
ask. A grant committee is disbursing public money and reads for impact,
beneficiaries, budget discipline and delivery risk. An accelerator is betting
on founders and reads for speed of learning, insight and team. A competition
judge is scoring against a rubric and reads for innovation and evidence.

The same company facts, arranged the same way, are a weak submission to three
of those four. This module turns what we know about the target programme into
a `DeckBrief`: which sections must appear, what order they appear in, what to
lead with, what to cut, and what the copy should emphasise. The brief then
drives slide selection in the deck builder, the prompt in the narrative
engine, and the criteria in the deck review.

Everything here is deterministic. No model call, so the brief is stable,
inspectable and free, and a founder who changes their programme sees the deck
change for a reason they can read.
"""
from __future__ import annotations

from dataclasses import dataclass, field, asdict
from typing import Literal

Audience = Literal[
    "vc",           # seed / venture fund
    "accelerator",  # YC, Techstars, fellowship with equity
    "grant",        # government, foundation, non-dilutive
    "competition",  # pitch competition, award, scored rubric
    "corporate",    # corporate innovation / partnership programme
    "bank",         # debt, credit facility
    "general",      # no programme named
]


@dataclass
class DeckBrief:
    """What this specific deck has to do to succeed with this specific reader."""

    audience: Audience
    audience_label: str
    programme: str

    #: Slide kinds in the order they should appear.
    section_order: list[str]
    #: Sections that must exist. Missing ones are flagged by the review.
    required_sections: list[str]
    #: Sections this reader does not weight heavily. Kept, but not led with.
    deprioritised: list[str]
    #: What this reader is actually selecting on, in their words.
    selection_criteria: list[str]
    #: Instructions injected into the narrative engine's prompt.
    tone_directives: list[str]
    #: Requirements detected verbatim in the programme's own text.
    explicit_requirements: list[str] = field(default_factory=list)
    #: Application questions the founder pasted, mapped to the slide that answers each.
    question_map: list[dict] = field(default_factory=list)

    def to_dict(self) -> dict:
        return asdict(self)


# ---------------------------------------------------------------------------
# Audience models
#
# Each entry encodes how that reader actually reads, not a generic best
# practice. The orders differ because the first three slides are where the
# decision usually starts to form, and they should not be the same three.
# ---------------------------------------------------------------------------

_AUDIENCES: dict[Audience, dict] = {
    "vc": {
        "label": "Venture fund",
        "order": [
            "cover", "contents", "problem", "solution", "why_now", "market",
            "business_model", "traction", "competition", "technology",
            "team", "ask",
        ],
        "required": ["problem", "solution", "market", "traction", "business_model", "team", "ask"],
        "deprioritised": ["impact"],
        "criteria": [
            "Can this become a very large company, not just a good one?",
            "Is there evidence customers want it, however early?",
            "Do the unit economics work as it scales?",
            "Why is this team the one to do it?",
            "What exactly is being raised, and what does it buy?",
        ],
        "tone": [
            "Lead with the size of the opportunity and the evidence it is real.",
            "Every claim about growth must carry a number the founder can defend.",
            "State the ask plainly: amount, what it funds, and the milestone it reaches.",
        ],
    },
    "accelerator": {
        "label": "Accelerator",
        "order": [
            "cover", "problem", "solution", "traction", "why_now", "team",
            "fit", "market", "business_model", "technology", "competition", "ask",
        ],
        "required": ["problem", "solution", "traction", "team", "why_now"],
        "deprioritised": ["competition", "impact"],
        "criteria": [
            "Do these founders understand the problem better than anyone else?",
            "How fast are they shipping and learning?",
            "Is there a real insight here that is not obvious?",
            "Would this team keep going without us?",
        ],
        "tone": [
            "Lead with the insight: the thing the founders know that others do not.",
            "Show velocity — what was built and learned recently, with dates.",
            "Be concrete and unpolished rather than corporate. Specifics beat adjectives.",
            "Keep it short. Assume the reader spends two minutes on the first pass.",
        ],
    },
    "grant": {
        "label": "Grant programme",
        "order": [
            "cover", "problem", "impact", "solution", "technology",
            "milestones", "team", "use_of_funds", "fit", "market", "traction", "ask",
        ],
        "required": ["problem", "solution", "impact", "use_of_funds", "milestones", "team"],
        "deprioritised": ["competition", "business_model"],
        "criteria": [
            "Who specifically benefits, and how many of them?",
            "Is the outcome measurable, and how will it be reported?",
            "Is the budget proportionate and well reasoned?",
            "Can this team deliver on time, and what happens if they cannot?",
            "Does the work continue after the funding ends?",
        ],
        "tone": [
            "Lead with the beneficiary and the measurable outcome, not the product.",
            "Quantify impact in people reached, cost per outcome, or time saved.",
            "Be explicit about how the money is spent and against which milestones.",
            "Name delivery risks openly with the mitigation. Committees read hedging as inexperience.",
            "Avoid venture language. 'Scale' and 'disrupt' read badly here; 'reach' and 'sustain' read well.",
        ],
    },
    "competition": {
        "label": "Pitch competition",
        "order": [
            "cover", "problem", "solution", "technology", "traction",
            "market", "competition", "team", "business_model", "ask",
        ],
        "required": ["problem", "solution", "technology", "traction", "team"],
        "deprioritised": ["use_of_funds"],
        "criteria": [
            "How innovative is this, genuinely?",
            "Is the solution demonstrably working, not just described?",
            "Is the presentation clear enough to score quickly against a rubric?",
            "Is the team credible on delivery?",
        ],
        "tone": [
            "Lead with what is novel and why it was hard to build.",
            "Judges score against a rubric under time pressure — one idea per slide.",
            "Show the thing working: evidence, a demo reference, a number.",
        ],
    },
    "corporate": {
        "label": "Corporate programme",
        "order": [
            "cover", "problem", "solution", "technology", "fit",
            "traction", "team", "business_model", "market", "ask",
        ],
        "required": ["problem", "solution", "technology", "fit", "traction"],
        "deprioritised": ["market"],
        "criteria": [
            "Where does this plug into our existing business?",
            "Is it secure, compliant and integrable at our scale?",
            "Has it worked with anyone comparable to us?",
            "What is the commercial shape of working together?",
        ],
        "tone": [
            "Lead with the fit: the specific workflow or product this attaches to.",
            "Address integration, security and compliance directly rather than waiting to be asked.",
            "Reference comparable deployments and the results.",
        ],
    },
    "bank": {
        "label": "Lender",
        "order": [
            "cover", "business_model", "traction", "use_of_funds",
            "risks", "team", "market", "solution", "ask",
        ],
        "required": ["business_model", "traction", "use_of_funds", "risks", "ask"],
        "deprioritised": ["technology", "competition"],
        "criteria": [
            "Is there predictable cash flow to service the facility?",
            "What is the security, and what is the downside case?",
            "Is the use of funds tied to revenue-generating activity?",
        ],
        "tone": [
            "Lead with revenue, margin and repayment capacity.",
            "Present the downside case explicitly. Optimism without a floor reads as risk.",
        ],
    },
    "general": {
        "label": "Investors",
        "order": [
            "cover", "contents", "problem", "solution", "market",
            "business_model", "traction", "competition", "technology", "team", "ask",
        ],
        "required": ["problem", "solution", "market", "traction", "team", "ask"],
        "deprioritised": [],
        "criteria": [
            "Is the problem real and worth solving?",
            "Does the solution work, with evidence?",
            "Can this be a business?",
            "Why this team?",
        ],
        "tone": [
            "Lead with the claim, then the evidence for it.",
            "Prefer concrete figures over adjectives throughout.",
        ],
    },
}


# ---------------------------------------------------------------------------
# Classification
# ---------------------------------------------------------------------------

#: Ordered most-specific first: "accelerator fund" should read as accelerator.
_TYPE_HINTS: list[tuple[Audience, tuple[str, ...]]] = [
    ("grant", ("grant", "non-dilutive", "nondilutive", "foundation", "subsidy",
               "development fund", "innovate uk", "sbir", "horizon", "ngo",
               "donor", "philanthrop", "bursary", "public funding")),
    ("competition", ("competition", "challenge", "prize", "award", "pitch contest",
                     "hackathon", "demo day contest", "rubric")),
    ("accelerator", ("accelerator", "incubator", "fellowship", "cohort", "bootcamp",
                     "y combinator", "ycombinator", "techstars", "antler", "startupbootcamp",
                     "programme cohort", "residency")),
    ("corporate", ("corporate", "partnership programme", "partner program", "vendor",
                   "procurement", "innovation lab", "pilot programme", "supplier")),
    ("bank", ("loan", "debt", "credit facility", "lender", "bank", "working capital",
              "revenue-based", "venture debt")),
    ("vc", ("vc", "venture", "fund", "seed round", "pre-seed", "series a",
            "angel", "investor", "capital partners")),
]


def classify_audience(program_type: str, program_name: str = "", requirements: str = "") -> Audience:
    """
    Works out who is reading. The explicit type wins; the programme name and
    its requirements text are fallbacks, because founders often leave the type
    blank but write 'Innovate UK grant' in the name.
    """
    haystacks = [program_type or "", program_name or "", (requirements or "")[:1200]]
    blob = " ".join(haystacks).lower()
    if not blob.strip():
        return "general"

    for audience, hints in _TYPE_HINTS:
        if any(h in blob for h in hints):
            return audience
    return "general"


# ---------------------------------------------------------------------------
# Reading the programme's own words
# ---------------------------------------------------------------------------

#: Phrases a programme uses → the slide that answers them. Detecting these is
#: what makes the deck respond to *this* programme rather than its category.
_REQUIREMENT_SIGNALS: list[tuple[str, tuple[str, ...]]] = [
    ("impact",         ("impact", "beneficiar", "social outcome", "sdg", "sustainable development",
                        "underserved", "community", "inclusion", "public benefit")),
    ("milestones",     ("milestone", "workplan", "work plan", "timeline", "deliverable",
                        "project plan", "gantt", "phases")),
    ("use_of_funds",   ("budget", "use of funds", "cost breakdown", "spend", "financial plan",
                        "how the funds", "allocation")),
    ("risks",          ("risk", "mitigation", "assumption", "dependency", "contingency")),
    ("technology",     ("technical", "technology readiness", "trl", "architecture",
                        "intellectual property", "patent", "r&d", "research")),
    ("traction",       ("traction", "validation", "pilot", "customers", "users",
                        "revenue", "proof of concept", "evidence of demand")),
    ("market",         ("market size", "tam", "addressable market", "market opportunity",
                        "competitor", "landscape")),
    ("team",           ("team", "founder", "track record", "capability", "cv", "bios")),
    ("business_model", ("business model", "revenue model", "unit econom", "pricing",
                        "commercial", "sustainability of the business", "path to profitability")),
    ("why_now",        ("why now", "timing", "regulatory change", "market shift")),
    ("fit",            ("alignment", "fit with", "relevance to", "why our programme",
                        "why this programme", "strategic fit")),
    ("esg",            ("environmental", "carbon", "climate", "esg", "green", "net zero")),
    ("compliance",     ("compliance", "regulat", "licence", "license", "data protection",
                        "gdpr", "security review")),
]


def detect_requirements(requirements_text: str) -> list[str]:
    """
    Reads the programme's own requirements and returns the sections it asks
    for. A programme that says 'describe your workplan and budget' should get
    a milestones slide and a use-of-funds slide whether or not its category
    normally calls for them.
    """
    if not requirements_text:
        return []
    text = requirements_text.lower()
    found: list[str] = []
    for section, phrases in _REQUIREMENT_SIGNALS:
        if any(p in text for p in phrases) and section not in found:
            found.append(section)
    return found


#: Where an application question is answered, by what it asks about.
_QUESTION_ROUTING: list[tuple[str, tuple[str, ...]]] = [
    ("problem",        ("what problem", "problem are you", "pain point", "need are you addressing")),
    ("solution",       ("what does your", "describe your solution", "how does it work",
                        "what are you building", "describe the product")),
    ("impact",         ("impact", "who benefits", "beneficiaries", "social", "change will")),
    ("market",         ("market", "customers are", "who are your customers", "demand")),
    ("traction",       ("progress", "traction", "achieved so far", "milestones to date",
                        "validation", "results so far")),
    ("business_model", ("revenue", "make money", "business model", "pricing", "sustainab")),
    ("competition",    ("competitors", "alternatives", "differentiat", "unique")),
    ("team",           ("team", "who are you", "founders", "experience", "why you")),
    ("technology",     ("technology", "technical", "innovation", "novel", "how is it built")),
    ("use_of_funds",   ("use the funding", "use of funds", "budget", "spend the")),
    ("milestones",     ("next 12 months", "plan for", "roadmap", "workplan", "next steps")),
    ("ask",            ("how much", "amount requested", "funding required", "seeking")),
    ("fit",            ("why this programme", "why our programme", "why are you applying",
                        "how do you align", "fit with")),
    ("risks",          ("risks", "what could go wrong", "challenges", "barriers")),
    ("why_now",        ("why now", "timing")),
]


def map_questions(program_questions: str) -> list[dict]:
    """
    Maps each application question the founder pasted to the slide that should
    answer it.

    This is the most direct form of the idea: if a programme asks eight
    questions, the deck should visibly answer those eight questions. Anything
    unmatched is returned with ``section: None`` so the founder is told
    plainly that nothing in the deck answers it yet.
    """
    if not program_questions:
        return []

    # Split on newlines and numbered/bulleted list markers.
    raw_lines = [ln.strip(" \t-*•") for ln in program_questions.splitlines()]
    questions = [ln for ln in raw_lines if len(ln) > 12]

    mapped: list[dict] = []
    for q in questions[:20]:
        low = q.lower()
        section = None
        for candidate, phrases in _QUESTION_ROUTING:
            if any(p in low for p in phrases):
                section = candidate
                break
        mapped.append({"question": q, "section": section})
    return mapped


# ---------------------------------------------------------------------------
# Building the brief
# ---------------------------------------------------------------------------

def _order_with(base: list[str], additions: list[str]) -> list[str]:
    """
    Inserts required-but-missing sections into a sensible place rather than
    appending them to the end, where a reader who was told to expect them
    would never reach.
    """
    preferred_after = {
        "impact": "problem",
        "milestones": "team",
        "use_of_funds": "ask",
        "risks": "team",
        "fit": "solution",
        "why_now": "solution",
        "esg": "impact",
        "compliance": "technology",
    }
    out = list(base)
    for section in additions:
        if section in out:
            continue
        anchor = preferred_after.get(section)
        if anchor and anchor in out:
            out.insert(out.index(anchor) + 1, section)
        else:
            # Before the ask, which should stay last.
            out.insert(len(out) - 1 if out and out[-1] == "ask" else len(out), section)
    return out


def build_brief(profile: dict) -> DeckBrief:
    """
    Turns the founder's programme answers into the brief that shapes the deck.

    Safe on an empty profile: with no programme named it returns the general
    investor brief, which is what the product did before this existed.
    """
    program_type = (profile.get("program_type") or "").strip()
    program_name = (profile.get("program_name") or "").strip()
    requirements = (profile.get("program_requirements") or "").strip()
    questions = (profile.get("program_questions") or "").strip()

    audience = classify_audience(program_type, program_name, requirements)
    spec = _AUDIENCES[audience]

    explicit = detect_requirements(requirements)
    question_map = map_questions(questions)
    from_questions = [m["section"] for m in question_map if m["section"]]

    # Required = what this audience always needs, plus whatever the programme
    # explicitly asked for, plus whatever its questions imply.
    required: list[str] = list(spec["required"])
    for section in explicit + from_questions:
        if section not in required:
            required.append(section)

    order = _order_with(list(spec["order"]), explicit + from_questions)

    tone = list(spec["tone"])
    if program_name:
        tone.append(
            f"This deck is a submission to {program_name}. Where the company genuinely "
            f"fits what they fund, make the fit explicit rather than leaving it inferred."
        )
    if explicit:
        readable = ", ".join(s.replace("_", " ") for s in explicit)
        tone.append(f"The programme's own materials ask about: {readable}. Cover each of these.")

    return DeckBrief(
        audience=audience,
        audience_label=spec["label"],
        programme=program_name or spec["label"],
        section_order=order,
        required_sections=required,
        deprioritised=list(spec["deprioritised"]),
        selection_criteria=list(spec["criteria"]),
        tone_directives=tone,
        explicit_requirements=explicit,
        question_map=question_map,
    )


def brief_for_prompt(brief: DeckBrief) -> str:
    """Renders the brief as the block injected into the narrative engine."""
    lines = [
        f"TARGET READER: {brief.audience_label}"
        + (f" — {brief.programme}" if brief.programme != brief.audience_label else ""),
        "",
        "THIS READER SELECTS ON:",
    ]
    lines += [f"- {c}" for c in brief.selection_criteria]
    lines += ["", "HOW TO WRITE FOR THEM:"]
    lines += [f"- {t}" for t in brief.tone_directives]

    if brief.explicit_requirements:
        lines += ["", "THE PROGRAMME EXPLICITLY ASKS ABOUT:"]
        lines += [f"- {s.replace('_', ' ')}" for s in brief.explicit_requirements]

    answered = [m for m in brief.question_map if m["section"]]
    if answered:
        lines += ["", "APPLICATION QUESTIONS THIS DECK MUST ANSWER:"]
        lines += [f"- \"{m['question']}\" → the {m['section'].replace('_', ' ')} slide"
                  for m in answered[:10]]

    if brief.deprioritised:
        lines += [
            "",
            "DE-EMPHASISE (include if the founder has real material, but do not lead with): "
            + ", ".join(s.replace("_", " ") for s in brief.deprioritised),
        ]
    return "\n".join(lines)
