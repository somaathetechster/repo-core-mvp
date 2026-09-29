/**
 * Turns a review Finding into a concrete, actionable fix.
 *
 * The review tells a founder what's wrong. This decides what the *button*
 * does about it, and that depends entirely on the kind of finding:
 *
 *   - A missing section whose content the founder HAS already written in
 *     their profile → the deck just didn't include it. Adding the section fixes it.
 *   - A missing section with NO profile content → sending them to refresh the deck
 *     would change nothing. Send them to the exact profile field to fill.
 *   - A slide-specific problem (no numbers, hedging, too dense) → open the
 *     editor at that slide so they can fix the words themselves.
 *
 * Getting this mapping right is the difference between a Fix button that
 * helps and one that lies — the same failure the review itself had.
 */
import type { Finding } from "./review";
import type { CompanyProfile } from "../api";

export type FixKind = "add-slide" | "fill-profile" | "open-slide" | "manual";

export interface FixAction {
  kind: FixKind;
  /** Button label. */
  label: string;
  /** One line shown under the finding explaining what the button will do. */
  preview: string;
  /** For fill-profile: the profile field key to focus. */
  profileField?: string;
  /** For add-slide: the section key to append. */
  section?: string;
  /** For open-slide: the slide index to open at. */
  slideIndex?: number;
}

/**
 * Maps a missing-section id to the profile field(s) that feed it. If ANY of
 * these has content, the section can be added rather than filled.
 */
const SECTION_TO_PROFILE_FIELDS: Record<string, string[]> = {
  problem: ["problem"],
  solution: ["solution", "evidence_of_innovation"],
  market: ["market_opportunity", "customer_segment", "tam", "sam", "som", "market_research"],
  traction: ["traction", "key_metrics"],
  business_model: ["business_model", "pricing_model", "unit_economics"],
  competition: ["competitive_landscape", "differentiation"],
  team: [],  // team comes from a separate structure, not a text field
  ask: ["funding_ask"],
  impact: ["impact_outcomes"],
  use_of_funds: ["use_of_funds"],
  milestones: ["milestones_next_12m", "go_to_market"],
  risks: ["risks_and_mitigations"],
  why_now: ["why_now"],
  technology: ["evidence_of_innovation", "differentiation", "patents_or_ip"],
};

/** The primary field to send someone to when a section is empty. */
const SECTION_PRIMARY_FIELD: Record<string, string> = {
  problem: "problem",
  solution: "solution",
  market: "market_opportunity",
  traction: "traction",
  business_model: "business_model",
  competition: "competitive_landscape",
  ask: "funding_ask",
  impact: "impact_outcomes",
  use_of_funds: "use_of_funds",
  milestones: "milestones_next_12m",
  risks: "risks_and_mitigations",
  why_now: "why_now",
  technology: "evidence_of_innovation",
};

const FIELD_LABEL: Record<string, string> = {
  problem: "Problem",
  solution: "Solution",
  market_opportunity: "Market opportunity",
  customer_segment: "Customer segment",
  traction: "Traction",
  business_model: "Business model",
  pricing_model: "Pricing model",
  unit_economics: "Unit economics",
  competitive_landscape: "Competitive landscape",
  funding_ask: "Funding ask",
  use_of_funds: "Use of funds",
  impact_outcomes: "Impact and outcomes",
  milestones_next_12m: "Milestones",
  risks_and_mitigations: "Risks and mitigations",
  why_now: "Why now",
  evidence_of_innovation: "Evidence of innovation",
};

/** Extracts the section name from a missing-section finding id. */
function sectionFromId(id: string): string | null {
  const m = id.match(/^(?:prog-)?missing-(.+)$/);
  return m ? m[1] : null;
}

/** Extracts the slide index from a slide-specific finding id. */
function slideIndexFromFinding(finding: Finding): number | null {
  return finding.slideIndex;
}

function hasContent(profile: CompanyProfile | null, field: string): boolean {
  if (!profile) return false;
  const v = (profile as unknown as Record<string, unknown>)[field];
  return typeof v === "string" && v.trim().length > 0;
}

export function planFix(finding: Finding, profile: CompanyProfile | null): FixAction {
  const section = sectionFromId(finding.id);

  // ── Missing section ──
  if (section) {
    const fields = SECTION_TO_PROFILE_FIELDS[section] ?? [];
    const hasAny = fields.some((f) => hasContent(profile, f));

    if (hasAny) {
      return {
        kind: "add-slide",
        label: "Add this section",
        preview:
          `You've written this in your profile but the deck didn't include it. ` +
          `We'll add a ${section.replace(/_/g, " ")} slide without changing the rest of the deck.`,
        section,
      };
    }

    const primary = SECTION_PRIMARY_FIELD[section];
    if (primary) {
      return {
        kind: "fill-profile",
        label: `Fill ${FIELD_LABEL[primary] ?? primary} in your profile`,
        preview:
          `Your profile has nothing for this yet. ` +
          `We'll take you to the ${FIELD_LABEL[primary] ?? primary} field — fill it, then refresh the deck.`,
        profileField: primary,
      };
    }

    // team, or anything without a text field
    return {
      kind: "manual",
      label: "Add in the editor",
      preview: `Open the deck and add a ${section.replace(/_/g, " ")} slide directly.`,
    };
  }

  // ── Slide-specific issue (no numbers, hedging, dense, thin) ──
  const idx = slideIndexFromFinding(finding);
  if (idx != null) {
    return {
      kind: "open-slide",
      label: "Open this slide",
      preview: "We'll open the deck on this exact slide so you can fix the wording.",
      slideIndex: idx,
    };
  }

  // ── Deck-wide issues (too long, too short, no imagery, monotony) ──
  return {
    kind: "manual",
    label: "Open the deck",
    preview: finding.fix,
  };
}
