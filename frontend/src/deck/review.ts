/**
 * The deck review.
 *
 * Every other tool in this category stops at producing slides. Provisio knows
 * what is on each slide as structured content rather than as pixels, which
 * means it can read the deck the way a partner would and say what is wrong
 * with the argument.
 *
 * The rules here are not stylistic preferences. They encode what actually
 * causes a deck to fail in a room: claims with no numbers behind them, an ask
 * that is never stated, a problem asserted rather than evidenced, twelve
 * slides that all look and read the same, and text density no one will read
 * off a projector.
 *
 * Everything is computed locally and instantly. No model call, so the review
 * updates as the founder edits rather than being a thing they wait for.
 */
import type { ElementSlide, SlideKind } from "./elements";
import { textStats } from "./measure";
import type { LayoutVariant } from "./variants";

export type Severity = "critical" | "important" | "polish";

export interface Finding {
  id: string;
  severity: Severity;
  /** Which slide it concerns; null when it is about the deck as a whole. */
  slideIndex: number | null;
  title: string;
  detail: string;
  /** What to actually do about it. */
  fix: string;
}

export interface DeckReview {
  findings: Finding[];
  /** 0-100. Deliberately not a grade: it is a completeness signal. */
  score: number;
  strengths: string[];
  wordsTotal: number;
  readingMinutes: number;
}

/* ------------------------------------------------------------------ */

/** The slides an investor expects, and why each exists. */
const EXPECTED: { kind: SlideKind; name: string; why: string }[] = [
  { kind: "problem", name: "Problem", why: "Without it, nothing that follows has a reason to exist." },
  { kind: "solution", name: "Solution", why: "What you actually built, concretely enough to picture." },
  { kind: "market", name: "Market", why: "Investors need to believe the outcome can be large." },
  { kind: "traction", name: "Traction", why: "Evidence that anyone wants this." },
  { kind: "business_model", name: "Business model", why: "How the money is made, not just that it will be." },
  { kind: "competition", name: "Competition", why: "Silence here reads as not having looked." },
  { kind: "team", name: "Team", why: "At early stage this is often the whole decision." },
  { kind: "ask", name: "Ask", why: "A deck that never says what it wants is asking the reader to guess." },
];

function slideText(slide: ElementSlide): string {
  return slide.elements
    .filter((e) => !e.locked)
    .filter((e) => ["text", "statement", "quote", "list", "metric", "caption", "heading"].includes(e.type))
    .map((e) => e.text ?? "")
    .join(" ");
}

function bodyText(slide: ElementSlide): string {
  return slide.elements
    .filter((e) => !e.locked && ["text", "statement", "quote", "list"].includes(e.type))
    .map((e) => e.text ?? "")
    .join(" ");
}

const NUMBER_RE = /\d[\d,.]*\s*(?:%|k|m|bn?|x|million|billion)?/i;

/** Vague claims that sound like evidence but contain none. */
const HEDGE_RE = /\b(significant|substantial|numerous|various|many|several|rapidly|massive|huge|tremendous|leading|innovative|cutting[- ]edge|revolutionary|world[- ]class|seamless|robust|game[- ]chang\w+|best[- ]in[- ]class|state[- ]of[- ]the[- ]art|synerg\w+|disrupt\w+)\b/gi;

export interface ProgramBrief {
  audience_label: string;
  programme: string;
  required_sections: string[];
  selection_criteria: string[];
  question_map: { question: string; section: string | null }[];
}

/** The chosen deck structure, as stored on the deck's theme. Drives which
 *  roles are required, the per-slide quality bars, and the length bounds. */
export interface ReviewStructureRole {
  key: string;
  requirement: "required" | "recommended" | "optional";
  quality_bar: string;
  label?: string;
}
export interface ReviewStructure {
  id: string;
  name: string;
  min_slides: number;
  max_slides: number;
  required_roles: string[];
  roles: ReviewStructureRole[];
}

/** Maps a structure's role key to the content signal that detects it. "cover"
 *  means the role is the title page (always present); null means there is no
 *  content signal to check (optional flourishes like a closing slide). */
const ROLE_SIGNAL: Record<string, string | null> = {
  title: "cover", title_mission: "cover",
  market_opportunity: "market",
  solution_demo: "product", approach: "solution",
  problem_insight: "problem", statement_of_need: "problem",
  traction_snapshot: "traction", progress: "traction", evidence: "traction",
  timeline_milestones: "milestones", goals_objectives: "milestones",
  budget: "use_of_funds",
  capacity: "team", why_you: "team",
  ask_batch: "ask", ask_contact: "ask",
  closing: null, press: null, testimonials: null,
  // product, moat, unit_economics, go_to_market, roadmap, financials,
  // sustainability, why_now, impact each have their own SECTION_SIGNAL and so
  // resolve to themselves via the fallthrough below.
};

function roleSignalSection(roleKey: string): string | null | undefined {
  if (roleKey in ROLE_SIGNAL) return ROLE_SIGNAL[roleKey];
  return roleKey; // keys that already match a SECTION_SIGNAL (problem, market, …)
}

const MOM_RE = /\b(month[- ]over[- ]month|mom\b|retention|churn|cohort|returning|repeat|week[- ]over[- ]week|\d+\s*%\s*(?:growth|retention|mom)?)\b/i;
const UNIT_ECON_RE = /\b(cac|ltv|payback|gross margin|contribution margin|unit econom)\b/i;
const FIRST_MOVER_RE = /\bfirst[- ](?:mover|to market)\b/i;
const CITATION_RE = /\b(according to|study|studies|research|survey|census|report|\d+\s*%|data (?:from|shows)|statistics?|documented|cited?)\b/i;


const SECTION_SIGNALS: Record<string, RegExp> = {
  problem: /\b(problem|pain|broken|fails?|failing|struggle|frustrat|inefficien|bottleneck|gap|lack of|no way to|difficult to|too (?:slow|expensive|hard)|underserved|friction|barrier)\b/i,
  solution: /\b(solution|we (?:built|make|offer|provide|enable)|our (?:product|platform|approach|technology)|how it works|introduc\w+|lets? (?:you|them|users)|so that|enables?|automat\w+)\b/i,
  market: /\b(market|tam|sam|som|addressable|billion|trillion|\$\s?\d|industry|segment|customers? (?:in|across)|opportunity|demand|sector)\b/i,
  traction: /\b(traction|users?|customers?|revenue|growth|mrr|arr|signed up|transactions?|volume|retention|waitlist|pilot|paying|active users?|downloads?|\d+\s*%|month[- ]over[- ]month|already)\b/i,
  business_model: /\b(business model|revenue model|we charge|pricing|subscription|per (?:seat|user|month|transaction)|commission|take rate|monetiz|unit econom|margin|fee|how we make money)\b/i,
  competition: /\b(competit|alternative|versus|vs\.?|unlike|incumbents?|existing (?:solutions|players|tools)|differ\w+|moat|defensib|better than|compared to)\b/i,
  team: /\b(team|founder|co[- ]?founder|ceo|cto|we are|our background|previously (?:at|built)|years? of experience|led|built .* at|ex[- ])\b/i,
  ask: /\b(raising|the ask|seeking|looking to raise|round|investment|funding|\$\s?\d[\d,.]*\s*(?:k|m|million|bn|billion)|runway|use of (?:the )?funds|in exchange for|equity)\b/i,
  impact: /\b(impact|beneficiar|outcome|social|people (?:reached|served|affected)|lives|community|sdg|sustainab|carbon|emissions|reduce\w*|improv\w+ (?:access|outcomes)|underserved)\b/i,
  use_of_funds: /\b(use of funds|use of the funds|allocat|budget|spend|we will (?:use|invest|hire|build)|proceeds|capital will|breakdown of)\b/i,
  milestones: /\b(milestone|roadmap|next (?:6|12|twelve|six) months|by (?:q[1-4]|end of|20\d\d)|timeline|phase|deliverable|targets?|goals? for)\b/i,
  risks: /\b(risk|mitigat|challeng|assumption|dependency|contingency|what could go wrong|regulatory|threat)\b/i,
  why_now: /\b(why now|timing|recently|shift|regulat\w+ change|new (?:law|regulation|technology)|inflection|tailwind|just became possible)\b/i,
  technology: /\b(technolog|architecture|built (?:on|with)|patent|proprietary|algorithm|infrastructure|api|model|engine|stack)\b/i,
  product: /\b(product|screenshot|demo|dashboard|interface|features?|how it works|workflow|the app|user experience|ui)\b/i,
  moat: /\b(moat|defensib|proprietary|network effect|switching cost|lock[- ]in|hard to (?:copy|replicate)|barrier to entry|data advantage|first[- ](?:mover|to market))\b/i,
  unit_economics: /\b(cac|ltv|payback|gross margin|contribution margin|unit econom|customer acquisition cost|lifetime value)\b/i,
  go_to_market: /\b(go[- ]to[- ]market|gtm|acquisition channel|sales motion|distribution|funnel|outbound|inbound|channel strategy)\b/i,
  roadmap: /\b(roadmap|milestone|next (?:6|12|twelve|18|eighteen|six) months|phase|timeline|deliverable|by (?:q[1-4]|end of|20\d\d))\b/i,
  financials: /\b(projection|forecast|financial|p&l|revenue (?:plan|projection)|burn|runway|ebitda|three[- ]year|5[- ]year)\b/i,
  sustainability: /\b(sustainab|ongoing funding|after the (?:grant|funding|programme|program)|continue(?:d|s)? (?:after|beyond)|long[- ]term funding|self[- ]sustain|diversif\w+ (?:funding|revenue)|earned income)\b/i,
};

function sectionCovered(section: string, slides: ElementSlide[], kinds: string[]): boolean {
  if (kinds.includes(section as SlideKind)) return true;
  const signal = SECTION_SIGNALS[section];
  if (!signal) return false;
  return slides.some((sl) => signal.test(slideText(sl)));
}

export function reviewDeck(
  slides: ElementSlide[],
  variants: LayoutVariant[] = [],
  brief?: ProgramBrief | null,
  structure?: ReviewStructure | null,
): DeckReview {
  const findings: Finding[] = [];
  const strengths: string[] = [];
  const kinds = slides.map((s) => s.kind);

  /* --- 1. Is the argument complete? ------------------------------- */

  // The chosen structure decides what "complete" means. A grant deck is
  // required to carry a statement of need, not a moat; a seed deck the reverse.
  // When no structure is stored (legacy decks), fall back to the programme
  // brief and then to the generic investor expectations below.
  const structureRequiredCovered: boolean[] = [];
  if (structure?.required_roles?.length) {
    for (const roleKey of structure.required_roles) {
      const section = roleSignalSection(roleKey);
      if (section === "cover") { structureRequiredCovered.push(true); continue; }
      if (section == null) continue; // no content signal to check
      const covered = sectionCovered(section, slides, kinds);
      structureRequiredCovered.push(covered);
      if (covered) continue;
      const role = structure.roles.find((r) => r.key === roleKey);
      const label = (role?.label ?? roleKey).replace(/_/g, " ");
      findings.push({
        id: `struct-missing-${roleKey}`,
        severity: "critical",
        slideIndex: null,
        title: `Nothing in the deck covers ${label}, which the ${structure.name} structure requires`,
        detail: role?.quality_bar
          ? `This is a required slide for this deck structure. ${role.quality_bar}`
          : `This is a required slide for this deck structure. The review checked both slide titles and the text on every slide.`,
        fix: `Add a ${label} slide, or fill that section of your company profile and regenerate.`,
      });
    }
  } else if (brief?.required_sections?.length) {
    for (const section of brief.required_sections) {
      if (sectionCovered(section, slides, kinds)) continue;
      const label = section.replace(/_/g, " ");
      findings.push({
        id: `prog-missing-${section}`,
        severity: "critical",
        slideIndex: null,
        title: `Nothing in the deck covers ${label}, and ${brief.programme} asks for it`,
        detail: `This is a requirement of the programme you're applying to. The review checked both slide titles and the text on every slide.`,
        fix: `Add a ${label} slide, or fill that section of your company profile and regenerate.`,
      });
    }
  }

  // Application questions still need answering regardless of structure.
  if (brief?.question_map?.length) {
    for (const q of brief.question_map ?? []) {
      if (q.section) continue;
      findings.push({
        id: `prog-q-${q.question.slice(0, 24)}`,
        severity: "important",
        slideIndex: null,
        title: "An application question has no slide answering it",
        detail: `"${q.question}"`,
        fix: "Add the answer to the closest slide, or add a slide for it.",
      });
    }
  }

  // The generic investor expectations only apply when no structure (and no
  // programme brief) has already defined what this deck must contain —
  // otherwise a grant deck would be penalised for lacking a market slide.
  for (const expected of EXPECTED) {
    if (structure?.required_roles?.length) break;
    if (brief?.required_sections?.length && !brief.required_sections.includes(expected.kind)) continue;
    if (!sectionCovered(expected.kind, slides, kinds)) {
      findings.push({
        id: `missing-${expected.kind}`,
        severity: expected.kind === "ask" || expected.kind === "traction" ? "critical" : "important",
        slideIndex: null,
        title: `No ${expected.name.toLowerCase()} slide`,
        detail: expected.why,
        fix: `Add one, or fill the ${expected.name.toLowerCase()} section of your company profile and regenerate.`,
      });
    }
  }

  /* --- 2. Claims without evidence --------------------------------- */

  const EVIDENCE_KINDS: SlideKind[] = ["traction", "market", "business_model"];
  slides.forEach((slide, i) => {
    const text = slideText(slide);
    if (!text.trim()) return;

    if (EVIDENCE_KINDS.includes(slide.kind) && !NUMBER_RE.test(text)) {
      findings.push({
        id: `no-numbers-${i}`,
        severity: "critical",
        slideIndex: i,
        title: `"${slide.title}" contains no numbers`,
        detail:
          slide.kind === "traction"
            ? "A traction slide without figures reads as having no traction. This is the slide investors scrutinise hardest."
            : "This section is judged on magnitude, and magnitude needs a figure.",
        fix: "Add the specific numbers you have, even small ones. A real figure beats an impressive adjective.",
      });
    }

    const hedges = [...text.matchAll(HEDGE_RE)].map((m) => m[0].toLowerCase());
    const unique = [...new Set(hedges)];
    if (unique.length >= 2) {
      findings.push({
        id: `hedging-${i}`,
        severity: "important",
        slideIndex: i,
        title: `"${slide.title}" leans on words that carry no information`,
        detail: `Uses ${unique.slice(0, 4).map((h) => `"${h}"`).join(", ")}. A reader discounts claims they cannot check.`,
        fix: "Replace each with the specific thing it is standing in for, or cut the sentence.",
      });
    }
  });

  /* --- 2b. Structure quality bars --------------------------------- */

  // Each role carries a specific bar. Where a bar is checkable from the slide
  // text, apply it to the slide that plays that role — e.g. a traction slide
  // with no month-over-month figure, a unit-economics slide with no CAC/LTV.
  if (structure?.roles?.length) {
    const hasRole = (key: string) => structure.roles.some((r) => r.key === key);
    const barFor = (key: string) => structure.roles.find((r) => r.key === key)?.quality_bar ?? "";
    // The index of the first slide whose text matches a content signal.
    const slideForSection = (section: string): number => {
      if (kinds.includes(section as SlideKind)) return kinds.indexOf(section as SlideKind);
      const signal = SECTION_SIGNALS[section];
      if (!signal) return -1;
      return slides.findIndex((sl) => signal.test(slideText(sl)));
    };

    // Traction family: numbers alone are not enough — the bar asks for a rate.
    for (const key of ["traction", "traction_snapshot", "progress"]) {
      if (!hasRole(key)) continue;
      const idx = slideForSection(roleSignalSection(key) as string);
      if (idx < 0) break; // missing entirely is the completeness check's job
      if (!MOM_RE.test(slideText(slides[idx]))) {
        findings.push({
          id: `bar-traction-${idx}`,
          severity: "important",
          slideIndex: idx,
          title: `"${slides[idx].title}" shows totals but no rate of change`,
          detail: barFor(key) || "Returning or recommending users beat signups.",
          fix: "Add month-over-month growth or retention — a cohort that comes back, not just a cumulative total.",
        });
      }
      break;
    }

    // Unit economics: the bar is explicit about the maths it wants.
    if (hasRole("unit_economics")) {
      const idx = slideForSection("unit_economics");
      if (idx >= 0 && !UNIT_ECON_RE.test(slideText(slides[idx]))) {
        findings.push({
          id: `bar-unit-econ-${idx}`,
          severity: "important",
          slideIndex: idx,
          title: "The unit economics don't show the math",
          detail: barFor("unit_economics"),
          fix: "State CAC, LTV, the LTV:CAC ratio (aim >3:1), payback period and gross margin.",
        });
      }
    }

    // Moat: "first mover" is explicitly called out as not a moat.
    if (hasRole("moat")) {
      const idx = slides.findIndex((sl) => FIRST_MOVER_RE.test(slideText(sl)));
      if (idx >= 0) {
        findings.push({
          id: `bar-moat-${idx}`,
          severity: "important",
          slideIndex: idx,
          title: `"${slides[idx].title}" rests on being first`,
          detail: barFor("moat") || "'First mover' is not a moat.",
          fix: "Name what actually defends this — distribution, proprietary data, network effects, switching costs.",
        });
      }
    }

    // Statement of need (grant): the most-scored section must be evidenced.
    if (hasRole("statement_of_need")) {
      const idx = slideForSection("problem");
      if (idx >= 0 && !CITATION_RE.test(slideText(slides[idx]))) {
        findings.push({
          id: `bar-need-${idx}`,
          severity: "critical",
          slideIndex: idx,
          title: "The statement of need isn't backed by evidence",
          detail: barFor("statement_of_need"),
          fix: "Lead with documented, cited figures that the need is real, local and measurable.",
        });
      }
    }
  }

  /* --- 3. Density: what nobody will read -------------------------- */

  let totalWords = 0;
  slides.forEach((slide, i) => {
    const words = textStats(bodyText(slide)).words;
    totalWords += words;
    if (slide.kind === "cover" || slide.kind === "contents") return;

    if (words > 90) {
      findings.push({
        id: `dense-${i}`,
        severity: words > 140 ? "important" : "polish",
        slideIndex: i,
        title: `"${slide.title}" is ${words} words`,
        detail:
          "A slide is read in under ten seconds while you are talking over it. Past roughly sixty words, the audience stops reading and stops listening.",
        fix: "Cut to the one claim that matters and move the detail into what you say out loud.",
      });
    }
    if (words > 0 && words < 6 && slide.kind !== "team" && slide.kind !== "data") {
      findings.push({
        id: `thin-${i}`,
        severity: "polish",
        slideIndex: i,
        title: `"${slide.title}" is nearly empty`,
        detail: "A slide carrying almost nothing spends the audience's attention without returning anything.",
        fix: "Give it a real claim, merge it into the slide beside it, or cut it.",
      });
    }
  });

  /* --- 4. Length -------------------------------------------------- */

  const content = slides.filter((s) => s.kind !== "cover" && s.kind !== "contents").length;
  // The chosen structure sets the length it was designed for; fall back to the
  // generic 6–14 band for legacy decks with no structure stored.
  const maxLen = structure?.max_slides ?? 14;
  const minLen = structure?.min_slides ?? 6;
  if (content > maxLen) {
    findings.push({
      id: "too-long",
      severity: "important",
      slideIndex: null,
      title: `${content} content slides is more than the ${structure?.name ?? "deck"} structure is built for`,
      detail: structure
        ? `The ${structure.name} structure runs to ${maxLen} slides. Past that, the later slides are rarely reached.`
        : "Seed decks that get meetings are usually ten to twelve slides. Past that, the later slides are rarely reached.",
      fix: "Move supporting detail to an appendix, and keep the main deck to the argument.",
    });
  } else if (content < minLen) {
    findings.push({
      id: "too-short",
      severity: "important",
      slideIndex: null,
      title: `Only ${content} content slides${structure ? `, below the ${structure.name} structure's ${minLen}` : ""}`,
      detail: "There is probably an obvious question this deck does not answer yet.",
      fix: "Check the missing sections above before sending it.",
    });
  }

  /* --- 5. Visual rhythm ------------------------------------------- */

  if (variants.length === slides.length && slides.length > 4) {
    let run = 1;
    for (let i = 1; i < variants.length; i++) {
      if (variants[i] === variants[i - 1] && slides[i].kind !== "cover") {
        run += 1;
        if (run === 3) {
          findings.push({
            id: `monotony-${i}`,
            severity: "polish",
            slideIndex: i - 2,
            title: "Three slides in a row share the same layout",
            detail: "A deck with no visual rhythm reads as one long slide, and the audience stops registering that the page changed.",
            fix: "Vary the content shape: a single strong sentence, a figure, or an image will each pick a different layout.",
          });
        }
      } else {
        run = 1;
      }
    }
  }

  /* --- 6. Imagery -------------------------------------------------- */

  const withImages = slides.filter((s) =>
    s.elements.some((e) => (e.type === "image" || e.type === "portrait") && e.src),
  ).length;
  if (slides.length >= 6 && withImages === 0) {
    findings.push({
      id: "no-imagery",
      severity: "important",
      slideIndex: null,
      title: "No images anywhere in the deck",
      detail:
        "Showing the product does more than describing it. A deck of pure text asks the reader to imagine what you have built.",
      fix: "Add a product screenshot, a diagram, or team photos in the Images panel.",
    });
  }

  /* --- 7. Sourcing -------------------------------------------------- */

  const sourced = slides.filter((s) => s.elements.some((e) => e.source)).length;
  if (sourced >= Math.ceil(slides.length * 0.5)) {
    strengths.push("Most claims record where they came from, which holds up under questioning.");
  }

  /* --- strengths ---------------------------------------------------- */

  const covered = EXPECTED.filter((e) => sectionCovered(e.kind, slides, kinds)).length;
  if (structure?.required_roles?.length) {
    if (structureRequiredCovered.length && structureRequiredCovered.every(Boolean)) {
      strengths.push(`Every slide the ${structure.name} structure requires is present.`);
    }
  } else if (covered === EXPECTED.length) {
    strengths.push("Every section an investor expects is present.");
  }
  if (content >= 8 && content <= 12) strengths.push(`${content} content slides is the length that gets read.`);
  if (withImages >= 3) strengths.push("Imagery appears throughout rather than on one slide.");
  const numbered = slides.filter((s) => NUMBER_RE.test(slideText(s))).length;
  if (numbered >= Math.ceil(slides.length * 0.4)) {
    strengths.push("Specific figures appear across the deck, not only on the traction slide.");
  }
  if (new Set(variants).size >= 4) strengths.push("The deck has genuine visual variety.");

  /* --- score --------------------------------------------------------- */

  // Weighted by how much each class of problem actually costs a founder.
  const penalty =
    findings.filter((f) => f.severity === "critical").length * 11 +
    findings.filter((f) => f.severity === "important").length * 6 +
    findings.filter((f) => f.severity === "polish").length * 2;
  // The floor rewards a deck that covers what it is required to. When a
  // structure is chosen, "required" means its required roles; otherwise the
  // generic investor expectations.
  const coverageRatio = structure?.required_roles?.length && structureRequiredCovered.length
    ? structureRequiredCovered.filter(Boolean).length / structureRequiredCovered.length
    : covered / EXPECTED.length;
  const floor = coverageRatio >= 0.6 ? 15 : 0;
  const score = Math.max(floor, Math.min(100, 100 - penalty));

  const order: Record<Severity, number> = { critical: 0, important: 1, polish: 2 };
  findings.sort((a, b) => order[a.severity] - order[b.severity] || (a.slideIndex ?? -1) - (b.slideIndex ?? -1));

  return {
    findings,
    score,
    strengths,
    wordsTotal: totalWords,
    // Roughly 130 spoken words a minute, plus time on each slide.
    readingMinutes: Math.max(1, Math.round((totalWords / 130 + slides.length * 0.35) * 10) / 10),
  };
}

/**
 * The questions an investor will ask that this deck does not answer.
 *
 * Derived from what is missing rather than generated, so it is specific to
 * the deck in front of the founder and costs nothing to compute.
 */
export function unansweredQuestions(slides: ElementSlide[]): string[] {
  const kinds = slides.map((s) => s.kind);
  const all = slides.map(slideText).join(" ").toLowerCase();
  const out: string[] = [];

  if (!kinds.includes("ask")) out.push("How much are you raising, and what does it buy you?");
  if (!kinds.includes("competition")) out.push("Who else is doing this, and why will you win?");
  if (!kinds.includes("business_model")) out.push("How do you make money?");
  if (!kinds.includes("traction")) out.push("What evidence do you have that anyone wants this?");
  if (!/\b(retention|churn|repeat|returning|cohort)\b/.test(all)) {
    out.push("Do customers come back, or do you keep buying new ones?");
  }
  if (!/\b(cost|margin|unit econom|cac|ltv|gross)\b/.test(all)) {
    out.push("What does it cost you to serve a customer?");
  }
  if (!/\b(why now|timing|recently|shift|regulation|newly)\b/.test(all)) {
    out.push("Why is now the right moment for this, rather than three years ago?");
  }
  if (!/\b(risk|challenge|hard|difficult|barrier|moat|defensib)\b/.test(all)) {
    out.push("What is the hardest part of this, and what happens if it goes wrong?");
  }

  return out.slice(0, 6);
}
