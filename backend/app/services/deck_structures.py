"""
Deck structures: the single source of truth for what a deck is made of.

For a long time the shape of a deck lived in three places at once — a hardcoded
SLIDE_PLAN in the narrative engine, an `order` list per audience in
program_intelligence, and a candidate-ordering pass in deck_builder. They drifted,
and none of them was something a founder could see or choose.

This module replaces all three. A `DeckStructure` is a first-class, named thing:
who it is for, how long it runs, and an ordered list of slide roles, each with the
one question it answers and a specific, role-level quality bar that is fed straight
into the writing prompt and the review. Generation, ordering, slide count and
review all read from here. One source of truth.

Everything is deterministic data. No model call, so the set of structures is
stable, inspectable and free, and the picker in the UI shows exactly what each
structure is built around.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Literal

Requirement = Literal["required", "recommended", "optional"]


@dataclass(frozen=True)
class SlideRole:
    """One slide's job within a structure."""

    #: Stable key. Also the `kind` the narrative model is asked to emit, and the
    #: id the deterministic builder keys its candidate slide on.
    key: str
    requirement: Requirement
    #: The single question this slide answers for the reader.
    purpose: str
    #: Specific, role-level guidance fed into the LLM prompt and the review. Not
    #: generic — see each structure below.
    quality_bar: str
    #: Which company-profile / evidence fields feed this role.
    source_fields: tuple[str, ...] = ()

    @property
    def label(self) -> str:
        return self.key.replace("_", " ").strip().title()

    @property
    def quality_bar_detailed(self) -> str:
        """The quality bar, with the preferred content-block hint appended when
        this role has one. One source of truth for both the writing prompt and
        the structure the picker/review read."""
        hint = block_hint_for(self.key)
        return f"{self.quality_bar} {hint}".strip() if hint else self.quality_bar

    def to_dict(self) -> dict:
        return {
            "key": self.key,
            "requirement": self.requirement,
            "purpose": self.purpose,
            "quality_bar": self.quality_bar_detailed,
            "source_fields": list(self.source_fields),
            "label": self.label,
        }


@dataclass(frozen=True)
class DeckStructure:
    id: str
    name: str
    description: str
    target_audience: str
    min_slides: int
    max_slides: int
    roles: tuple[SlideRole, ...]

    #: Roles treated as the cover/title page — built deterministically from the
    #: profile rather than written by the narrative model.
    TITLE_KEYS = ("title", "title_mission")

    @property
    def title_role(self) -> SlideRole | None:
        for r in self.roles:
            if r.key in self.TITLE_KEYS:
                return r
        return None

    @property
    def content_roles(self) -> tuple[SlideRole, ...]:
        """Every role the narrative model writes — i.e. all but the cover."""
        return tuple(r for r in self.roles if r.key not in self.TITLE_KEYS)

    @property
    def required_roles(self) -> list[str]:
        return [r.key for r in self.roles if r.requirement == "required"]

    def role(self, key: str) -> SlideRole | None:
        for r in self.roles:
            if r.key == key:
                return r
        return None

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "name": self.name,
            "description": self.description,
            "target_audience": self.target_audience,
            "min_slides": self.min_slides,
            "max_slides": self.max_slides,
            "required_roles": self.required_roles,
            "roles": [r.to_dict() for r in self.roles],
        }


# ---------------------------------------------------------------------------
# Global bars — true of every slide in every structure. Added to the system
# prompt and applied as deck-wide review checks.
# ---------------------------------------------------------------------------

GLOBAL_BARS: list[str] = [
    "Headline each slide with its conclusion, not its topic.",
    "Each slide must stand alone when read out of order.",
]


# ---------------------------------------------------------------------------
# Preferred content block per role. Where a slide's content is naturally
# structured, the generator should emit a typed block (stat/comparison/…)
# rather than prose. This maps the role to the block that fits it, and the
# hint sentence is appended to that role's quality bar.
# ---------------------------------------------------------------------------

PREFERRED_BLOCK: dict[str, str] = {
    "traction": "stat", "traction_snapshot": "stat", "progress": "stat",
    "evidence": "stat",
    "competition": "comparison",
    "roadmap": "timeline", "timeline_milestones": "timeline", "goals_objectives": "timeline",
    "team": "chips", "why_you": "chips", "capacity": "chips",
    "press": "logos",
    "testimonials": "quote",
    "financials": "bars", "budget": "bars", "ask": "bars",
    "unit_economics": "bars", "use_of_funds": "bars", "ask_contact": "bars",
}

_BLOCK_HINT: dict[str, str] = {
    "stat": "Lead with stat blocks for the key figures.",
    "comparison": "Place yourself against the alternatives in a comparison table.",
    "timeline": "Express the sequence as a timeline block.",
    "chips": "Present the people as chips (name, role).",
    "logos": "Present these as a logos row.",
    "quote": "Carry it as a quote block with its attribution.",
    "bars": "Show the split or projection as labeled bars.",
}


def block_hint_for(role_key: str) -> str:
    """The preferred-block hint sentence for a role, or '' if it has none."""
    return _BLOCK_HINT.get(PREFERRED_BLOCK.get(role_key, ""), "")


# ---------------------------------------------------------------------------
# Role shorthand. `r(...)` keeps the structures below readable while every
# role still carries its full purpose, quality bar and source fields.
# ---------------------------------------------------------------------------

def r(key: str, requirement: Requirement, purpose: str, quality_bar: str,
      source_fields: tuple[str, ...] = ()) -> SlideRole:
    return SlideRole(key=key, requirement=requirement, purpose=purpose,
                     quality_bar=quality_bar, source_fields=source_fields)


# Common source-field groupings, named so the structures stay legible.
_TITLE = ("company_name", "one_liner")
_PROBLEM = ("problem",)
_SOLUTION = ("solution",)
_PRODUCT = ("solution", "evidence_of_innovation")
_TRACTION = ("traction", "key_metrics")
_MARKET = ("market_opportunity", "customer_segment", "tam", "sam", "som", "market_research")
_BIZ = ("business_model", "pricing_model")
_COMP = ("competitive_landscape",)
_TEAM = ("team_members",)
_ASK = ("funding_ask", "use_of_funds")
_WHYNOW = ("why_now",)
_MOAT = ("differentiation", "patents_or_ip", "evidence_of_innovation")
_ROADMAP = ("milestones_next_12m", "go_to_market")
_UNIT = ("unit_economics", "key_metrics")
_GTM = ("go_to_market", "customer_segment")
_FINANCIALS = ("key_metrics", "unit_economics", "business_model")
_IMPACT = ("impact_outcomes",)


# ---------------------------------------------------------------------------
# The seven structures.
# ---------------------------------------------------------------------------

_STRUCTURE_LIST: list[DeckStructure] = [
    DeckStructure(
        id="teaser",
        name="Teaser",
        description="A seven-slide first touch. Enough to earn the meeting, nothing more.",
        target_audience="Cold outreach to investors you have not met",
        min_slides=6, max_slides=8,
        roles=(
            r("title", "required", "Who you are and what you do, in one line.",
              "One sentence a stranger understands with no context. Name the category and the outcome, not the mechanism.", _TITLE),
            r("problem", "required", "What is broken, and who pays for it today.",
              "Make the pain specific and expensive. One concrete sufferer beats a market abstraction.", _PROBLEM),
            r("solution", "required", "What you built and why it beats the status quo.",
              "Describe it concretely enough to picture. Lead with the change for the user, not the architecture.", _SOLUTION),
            r("traction", "required", "The evidence it is already working.",
              "Carry month-over-month retention or growth, not just totals. Returning/recommending users beat signups.", _TRACTION),
            r("market", "recommended", "Why the outcome can be large.",
              "One credible bottom-up number beats a borrowed trillion-dollar TAM. Show how you reach the number.", _MARKET),
            r("team", "recommended", "Why you are the ones to build this.",
              "Name the specific, earned insight or unfair advantage. Titles are not credentials here.", _TEAM),
            r("ask", "required", "What you want from the reader next.",
              "Connect the raise amount to specific milestones it unlocks. For a teaser, the ask is often simply the meeting.", _ASK),
        ),
    ),
    DeckStructure(
        id="seed",
        name="Seed",
        description="The Sequoia/YC baseline: the eleven slides a seed investor expects, in the order they expect them.",
        target_audience="Seed and pre-seed venture investors",
        min_slides=10, max_slides=12,
        roles=(
            r("title", "required", "Who you are and what you do.",
              "One sentence a stranger understands with no context. Category plus outcome.", _TITLE),
            r("problem", "required", "The expensive problem and who has it.",
              "Make the pain specific, frequent and costly. Evidence it is real, do not assert it.", _PROBLEM),
            r("solution", "required", "What you do about it, concretely.",
              "Show the before/after for the user. Concrete beats clever.", _SOLUTION),
            r("why_now", "recommended", "What changed that makes this possible today.",
              "Name the specific shift — a regulation, a cost curve, a behaviour change. 'The time is right' is not a reason.", _WHYNOW),
            r("market", "required", "How large the opportunity is.",
              "Bottom-up sizing the reader can check. Show the arithmetic from users and price, not a top-down slice.", _MARKET),
            r("product", "recommended", "What the thing actually is.",
              "Show it working — a real screen, a real flow, a real output. Demonstrate, do not describe.", _PRODUCT),
            r("business_model", "required", "How you make money.",
              "State price, who pays, and the unit that scales. 'Freemium' is not a model without the conversion.", _BIZ),
            r("traction", "required", "Evidence it is working.",
              "Carry month-over-month retention or growth, not just totals. Returning/recommending users beat signups.", _TRACTION),
            r("competition", "recommended", "Why you win against the alternatives.",
              "Place yourself honestly against real incumbents on the axis that matters. 'We have no competitors' reads as naivety.", _COMP),
            r("team", "required", "Why this team.",
              "Name the specific earned insight or unfair advantage. Why you, why now, why not the incumbent.", _TEAM),
            r("ask", "required", "What you are raising and what it buys.",
              "Connect the raise amount to specific milestones it unlocks. State the number plainly.", _ASK),
        ),
    ),
    DeckStructure(
        id="traction_led",
        name="Traction-led",
        description="Opens on the numbers. For when the metrics are the strongest thing you have.",
        target_audience="Investors where strong, defensible metrics are the lead argument",
        min_slides=12, max_slides=12,
        roles=(
            r("title", "required", "Who you are and what you do.",
              "One sentence a stranger understands. Category plus outcome.", _TITLE),
            r("traction", "required", "The numbers, up front, because they are the argument.",
              "Lead with month-over-month growth or retention and absolute scale together. The single most important figure goes largest.", _TRACTION),
            r("problem", "required", "What those numbers are solving.",
              "Now that they believe it works, show why it matters. Specific and expensive.", _PROBLEM),
            r("solution", "required", "What you built.",
              "Concrete before/after for the user.", _SOLUTION),
            r("product", "recommended", "What it actually is.",
              "Show it working — real screens, real output.", _PRODUCT),
            r("why_now", "recommended", "Why the growth is happening now.",
              "Tie the traction curve to a specific external shift that is still playing out.", _WHYNOW),
            r("market", "required", "How large this can get.",
              "Bottom-up from the traction you just showed: this cohort, this price, this many more of them.", _MARKET),
            r("business_model", "required", "How the growth turns into money.",
              "Price, payer, and the unit that scales. Tie it to the traction numbers.", _BIZ),
            r("competition", "recommended", "Why the lead holds.",
              "Honest placement against incumbents on the axis that matters, plus why your growth outpaces theirs.", _COMP),
            r("team", "required", "Why this team sustains it.",
              "The earned insight behind the execution that produced these numbers.", _TEAM),
            r("ask", "required", "What you are raising and what it buys.",
              "Connect the raise to the next traction milestone it unlocks.", _ASK),
            r("closing", "optional", "The one line to remember you by.",
              "Restate the single strongest number and the vision it implies. No new claims.", ("one_liner", "traction")),
        ),
    ),
    DeckStructure(
        id="premium",
        name="Premium",
        description="The comprehensive investor reading deck. Sixteen slides, built to be read alone without you in the room. Series A and up.",
        target_audience="Series A+ investors reading the deck on their own time",
        min_slides=14, max_slides=18,
        roles=(
            r("title", "required", "Who you are and what you do.",
              "One sentence a stranger understands. Category plus outcome.", _TITLE),
            r("problem", "required", "The expensive problem and who has it.",
              "Specific, frequent, costly, and evidenced. This is read without you to narrate it, so it must carry itself.", _PROBLEM),
            r("market_opportunity", "required", "How large the opportunity is.",
              "Bottom-up sizing the reader can check, with the arithmetic shown. Separate TAM from the wedge you take first.", _MARKET),
            r("why_now", "recommended", "What changed that makes this the moment.",
              "A specific, dated shift — regulation, cost curve, behaviour. Still playing out, not already over.", _WHYNOW),
            r("solution", "required", "What you do about it.",
              "Concrete before/after. The mechanism, not just the promise.", _SOLUTION),
            r("product", "recommended", "What it actually is.",
              "Show it working across the core flow — real screens, real output.", _PRODUCT),
            r("moat", "recommended", "What specifically defends this.",
              "Name what defends this — distribution, data, network effects, switching costs. 'First mover' is not a moat.", _MOAT),
            r("business_model", "required", "How you make money.",
              "Price, payer, unit that scales, and the margin at scale.", _BIZ),
            r("traction", "required", "Evidence it is working.",
              "Month-over-month retention and growth with absolute scale. A chart that trends up and to the right, labelled.", _TRACTION),
            r("competition", "recommended", "Why you win.",
              "Honest placement against real incumbents on the deciding axis. A 2x2 only if the axes are the ones buyers use.", _COMP),
            r("roadmap", "recommended", "Where this goes next.",
              "The next 12–18 months as outcomes, not features. Each milestone should move a metric the reader cares about.", _ROADMAP),
            r("ask", "required", "What you are raising and what it buys.",
              "Connect the raise to the specific milestones it unlocks and the metrics those hit.", _ASK),
            r("team", "required", "Why this team.",
              "Earned insight and unfair advantage per founder. Relevant, specific, not a LinkedIn summary.", _TEAM),
            r("press", "optional", "Third-party validation.",
              "Only real, attributable coverage. One credible outlet beats five logos no one recognises.", ("company_image_data_urls",)),
            r("testimonials", "optional", "Customers in their own words.",
              "Named customers with a specific outcome quoted. Anonymous praise is worth nothing here.", ()),
            r("closing", "optional", "The one line to remember you by.",
              "Restate the thesis in a sentence. No new claims.", ("one_liner",)),
        ),
    ),
    DeckStructure(
        id="series_a",
        name="Series A",
        description="Evidence-led and rigorous, carrying unit economics and go-to-market as first-class slides.",
        target_audience="Series A investors underwriting a scaling business",
        min_slides=14, max_slides=17,
        roles=(
            r("title", "required", "Who you are and what you do.",
              "One sentence a stranger understands. Category plus outcome.", _TITLE),
            r("traction_snapshot", "required", "The state of the business, in numbers, up front.",
              "ARR, growth rate, retention and logo count on one slide. The headline metrics a partner screens on in ten seconds.", _TRACTION),
            r("problem", "required", "The expensive problem and who has it.",
              "Specific and evidenced. At Series A the reader assumes the problem is real — prove you understand it precisely.", _PROBLEM),
            r("solution", "required", "What you do about it.",
              "Concrete mechanism and before/after.", _SOLUTION),
            r("product", "recommended", "What it actually is.",
              "Show it working across the core workflow.", _PRODUCT),
            r("market", "required", "How large this can get.",
              "Bottom-up sizing with the arithmetic shown, and the wedge you have already proven.", _MARKET),
            r("business_model", "required", "How you make money.",
              "Price, payer, unit that scales, margin at scale.", _BIZ),
            r("unit_economics", "required", "Whether the economics work as it scales.",
              "CAC, LTV, LTV:CAC ratio (aim >3:1), payback period, gross margin. Show the math.", _UNIT),
            r("go_to_market", "required", "How you acquire customers repeatably.",
              "Name the channel that works, its CAC, and the evidence it repeats. 'We'll do sales and marketing' is not a GTM.", _GTM),
            r("competition", "recommended", "Why you win.",
              "Honest placement against real incumbents on the deciding axis, with your proof of advantage.", _COMP),
            r("financials", "recommended", "Where the numbers go.",
              "A three-year projection tied to the drivers you have shown, not a hockey stick. State the assumptions.", _FINANCIALS),
            r("team", "required", "Why this team.",
              "Earned insight and the hires that de-risk the next stage.", _TEAM),
            r("roadmap", "recommended", "Where this goes next.",
              "Next 12–18 months as metric-moving outcomes, not a feature list.", _ROADMAP),
            r("ask", "required", "What you are raising and what it buys.",
              "Connect the raise to the specific milestones it unlocks and the metrics those hit.", _ASK),
            r("closing", "optional", "The one line to remember you by.",
              "Restate the thesis. No new claims.", ("one_liner",)),
        ),
    ),
    DeckStructure(
        id="grant",
        name="Grant",
        description="Built for a funder scoring against a rubric: need, feasibility, impact, budget, capacity, sustainability. No moat, no market-for-returns, no money-making model.",
        target_audience="Government and foundation grant committees",
        min_slides=11, max_slides=11,
        roles=(
            r("title_mission", "required", "Who you are and the mission the funding serves.",
              "Lead with the mission and the population served, not the organisation. One line a reviewer remembers.", ("company_name", "one_liner", "impact_outcomes")),
            r("statement_of_need", "required", "Why this need is real, local and urgent.",
              "The single most-scored section. Lead with documented, cited evidence that the need is real, local, and measurable.", ("problem", "market_research", "impact_outcomes")),
            r("goals_objectives", "required", "What specifically you will achieve.",
              "SMART objectives: specific, measurable, time-bound. Each objective maps to an activity and a measured outcome.", ("milestones_next_12m", "impact_outcomes")),
            r("approach", "required", "How you will do the work.",
              "A credible method a non-expert reviewer can follow. Tie each activity to an objective and to evidence it works.", ("solution", "go_to_market")),
            r("impact", "required", "Who benefits and by how much.",
              "Quantify in people reached and cost per outcome. Name the measurable change, not the activity count.", _IMPACT),
            r("evidence", "recommended", "Proof the approach works.",
              "Cite prior results, pilots, or research. Evidence of feasibility is scored directly — do not assert, cite.", ("traction", "key_metrics", "evidence_of_innovation")),
            r("timeline_milestones", "required", "When each thing happens.",
              "A dated workplan with deliverables against each phase. Reviewers score deliverability; vagueness reads as risk.", ("milestones_next_12m",)),
            r("budget", "required", "What the money is spent on.",
              "A line-item budget proportionate to the outcomes, with each cost justified against an activity. No round-number hand-waving.", ("use_of_funds", "funding_ask")),
            r("capacity", "required", "Why you can deliver this.",
              "Show the team and organisational track record of delivering comparable work. Capacity is scored, not assumed.", _TEAM),
            r("sustainability", "required", "What continues after the grant ends.",
              "Name how the work is sustained once funding stops. Committees read a one-off spend as low value.", ("business_model", "go_to_market")),
            r("ask_contact", "required", "The amount requested and how to reach you.",
              "State the exact amount requested and tie it to the budget. Make the contact and next step unambiguous.", _ASK),
        ),
    ),
    DeckStructure(
        id="accelerator",
        name="Accelerator",
        description="YC/Techstars style: founder-and-momentum weighted. Short, concrete, and about why you.",
        target_audience="Accelerator and fellowship selection panels",
        min_slides=10, max_slides=10,
        roles=(
            r("title", "required", "Who you are and what you do.",
              "One sentence a tired reviewer on their fortieth deck understands instantly.", _TITLE),
            r("problem_insight", "required", "The non-obvious thing you know that others miss.",
              "Lead with the insight, not the problem statement. What do you understand that the incumbents do not?", _PROBLEM),
            r("solution_demo", "required", "The thing, working.",
              "Show it, do not pitch it. A real screen or a specific example beats any description of the vision.", _PRODUCT),
            r("why_you", "required", "Why this team will not stop.",
              "Founder-market fit: the specific, earned reason you of all people are doing this. Momentum and obsession over pedigree.", ("team_members", "evidence_of_innovation")),
            r("progress", "required", "What you have done lately, and how fast.",
              "Show velocity: what shipped and what you learned in the last weeks, with dates. Rate of change beats absolute scale here.", _TRACTION),
            r("why_now", "recommended", "Why this moment.",
              "A specific shift that just opened the window. Dated and still live.", _WHYNOW),
            r("market", "recommended", "How large this can get.",
              "A credible bottom-up number. Keep it tight — the panel is betting on you, not the TAM slide.", _MARKET),
            r("business_model", "recommended", "How you will make money.",
              "Price, payer, unit that scales. A plausible model, honestly stated, beats a fabricated one.", _BIZ),
            r("team", "required", "Who is on the team.",
              "Who does what and why they are rare. Keep it to the people actually building.", _TEAM),
            r("ask_batch", "required", "Why you want in, and what you would do with the batch.",
              "Be specific about what you need from the programme. Generic enthusiasm reads as not having thought about it.", _ASK),
        ),
    ),
]


STRUCTURES: dict[str, DeckStructure] = {s.id: s for s in _STRUCTURE_LIST}

DEFAULT_STRUCTURE_ID = "seed"


def get_structure(structure_id: str | None) -> DeckStructure:
    """Resolve a structure id to a structure, falling back to the seed baseline."""
    if structure_id and structure_id in STRUCTURES:
        return STRUCTURES[structure_id]
    return STRUCTURES[DEFAULT_STRUCTURE_ID]


def all_structures() -> list[dict]:
    """Every structure as plain dicts, for the picker."""
    return [s.to_dict() for s in _STRUCTURE_LIST]


# ---------------------------------------------------------------------------
# Mapping an audience (classified from the programme) to a structure, so the
# existing brief path and the deterministic fallback agree with the picker.
# ---------------------------------------------------------------------------

STRUCTURE_FOR_AUDIENCE: dict[str, str] = {
    "grant": "grant",
    "accelerator": "accelerator",
    "competition": "accelerator",
    "vc": "seed",
    "corporate": "seed",
    "bank": "seed",
    "general": "seed",
}


def structure_for_audience(audience: str) -> DeckStructure:
    return get_structure(STRUCTURE_FOR_AUDIENCE.get(audience, DEFAULT_STRUCTURE_ID))


# ---------------------------------------------------------------------------
# Auto-recommend
# ---------------------------------------------------------------------------

_METRIC_SIGNAL = re.compile(
    r"\b(arr|mrr|\d+\s*%|month[- ]over[- ]month|retention|churn|cohort|growth|"
    r"\$\s?\d|revenue|paying|\d{3,})\b", re.I)
_UNIT_SIGNAL = re.compile(r"\b(arr|mrr|ltv|cac|payback|gross margin|unit econom)\b", re.I)
_COLD_SIGNAL = re.compile(
    r"\b(cold|first touch|teaser|just need something short|keep it short|one[- ]pager|"
    r"intro deck|short deck)\b", re.I)
_WARM_SIGNAL = re.compile(r"\b(warm|intro(?:duced)? by|referred|existing relationship|met at)\b", re.I)


def _profile_blob(profile: dict, keys: tuple[str, ...]) -> str:
    out = []
    for k in keys:
        v = profile.get(k)
        if isinstance(v, str):
            out.append(v)
    return "\n".join(out)


def recommend_structure(profile: dict) -> tuple[str, str]:
    """
    Picks the best structure for this company and its target programme, with a
    one-line reason. Deterministic — the same inputs always give the same pick.

    Ordering matters: the most decisive signals (a named grant/accelerator) are
    tested before the softer ones (metric strength, warmth of the intro).
    """
    from app.services.program_intelligence import classify_audience

    program_type = (profile.get("program_type") or "").strip()
    program_name = (profile.get("program_name") or "").strip()
    requirements = (profile.get("program_requirements") or "").strip()
    context = " ".join([program_type, program_name, requirements]).lower()

    audience = classify_audience(program_type, program_name, requirements)

    if audience == "grant":
        return "grant", "This is a grant or foundation application, scored on need, impact and budget — not returns."
    if audience == "accelerator":
        return "accelerator", "This targets an accelerator, which bets on founders and momentum over a polished reading deck."

    metrics_text = _profile_blob(profile, ("traction", "key_metrics", "unit_economics"))
    has_metrics = bool(_METRIC_SIGNAL.search(metrics_text))
    has_unit_econ = bool(_UNIT_SIGNAL.search(metrics_text)) or bool((profile.get("unit_economics") or "").strip())

    if _COLD_SIGNAL.search(context):
        return "teaser", "A cold or short-format outreach — a seven-slide teaser earns the meeting without overreaching."

    warm_vc = audience == "vc" and _WARM_SIGNAL.search(context)
    if warm_vc and has_metrics:
        if has_unit_econ:
            return "series_a", "A warm investor conversation with unit economics in hand — Series A carries CAC/LTV and GTM as first-class slides."
        return "traction_led", "A warm investor conversation with strong metrics — lead with the numbers."

    if has_metrics and not program_name:
        return "premium", "Strong metrics and no single named target — a comprehensive reading deck covers every angle."

    if audience == "vc" and has_unit_econ:
        return "series_a", "Venture target with unit economics present — Series A is the evidence-led fit."

    return "seed", "The seed baseline — the eleven slides a first institutional investor expects."
