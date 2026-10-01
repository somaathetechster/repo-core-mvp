/**
 * Deck Review — its own page.
 *
 * Reads a saved deck the same way the editor does (stored slides converted
 * through the active template) and critiques the argument: missing sections,
 * claims without numbers, hedge words, density, rhythm, and the investor
 * questions the deck leaves unanswered. Computed locally, so it's instant.
 */
import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  getCompanyProfile,
  addSlide,
  getDeck,
  listDecks,
  askDeckCoach,
  getFindingActions,
  saveFindingAction,
  deleteFindingAction,
  type DeckCoachMessage,
  type CompanyProfile,
  type DeckSummary,
} from "./api";
import { toElementSlides, type StoredSlide } from "./deck/migrate";
import { DEFAULT_TEMPLATE_ID } from "./deck/templates";
import { buildTheme, type DeckTheme } from "./deck/theme";
import { compose } from "./deck/composers";
import { planFix } from "./deck/fixActions";
import type { FixAction } from "./deck/fixActions";
import { reviewDeck, unansweredQuestions, type Finding, type ProgramBrief } from "./deck/review";
import { planVariants } from "./deck/variants";
import SlideCanvas from "./deck/SlideCanvas";
import WordCount from "./WordCount";
import type { ElementSlide, SlideKind } from "./deck/elements";
import "./deck-review.css";
import "./fix-button.css";

interface Props {
  onOpenDeck?: (id: string, slideIndex?: number) => void;
  onNavigate?: (tab: "profile", focusField?: string) => void;
}

type FindingType = "completeness" | "evidence" | "writing" | "structure";
type SeverityFilter = "all" | Finding["severity"];

const FINDING_TYPES: { id: FindingType; label: string }[] = [
  { id: "completeness", label: "Completeness" },
  { id: "evidence", label: "Evidence" },
  { id: "writing", label: "Writing" },
  { id: "structure", label: "Structure" },
];

const SECTION_FIELDS: Record<string, string[]> = {
  problem: ["problem"],
  solution: ["solution", "evidence_of_innovation"],
  market: ["market_opportunity", "customer_segment", "tam", "sam", "som", "market_research"],
  traction: ["traction", "key_metrics"],
  business_model: ["business_model", "pricing_model", "unit_economics"],
  competition: ["competitive_landscape", "differentiation"],
  team: [],
  ask: ["funding_ask", "use_of_funds"],
  impact: ["impact_outcomes"],
  use_of_funds: ["use_of_funds"],
  milestones: ["milestones_next_12m", "go_to_market"],
  risks: ["risks_and_mitigations"],
  why_now: ["why_now"],
  technology: ["evidence_of_innovation", "differentiation", "patents_or_ip"],
};

const SECTION_LABELS: Record<string, string> = {
  business_model: "business model",
  use_of_funds: "use of funds",
  why_now: "why now",
};

function findingType(finding: Finding): FindingType {
  if (/^(?:prog-)?missing-|^prog-q-/.test(finding.id)) return "completeness";
  if (finding.id.startsWith("no-numbers-")) return "evidence";
  if (/^(hedging|dense|thin)-/.test(finding.id)) return "writing";
  return "structure";
}

function sectionFromFinding(finding: Finding): string | null {
  const match = finding.id.match(/^(?:prog-)?missing-(.+)$/);
  return match?.[1] ?? null;
}

function sectionTitle(section: string): string {
  return SECTION_LABELS[section] ?? section.replace(/_/g, " ");
}

function profileText(profile: CompanyProfile | null, section: string): string {
  const values = (SECTION_FIELDS[section] ?? [])
    .map((field) => (profile as unknown as Record<string, unknown> | null)?.[field])
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0);
  return values.join(" ");
}

function ghostSlide(
  section: string,
  templateId: string,
  profile: CompanyProfile | null,
): ElementSlide {
  const supportedKinds = new Set<SlideKind>([
    "problem", "solution", "market", "traction", "business_model", "competition",
    "team", "ask", "technology", "product", "data", "custom",
  ]);
  const kind = (supportedKinds.has(section as SlideKind) ? section : "custom") as SlideKind;
  const content = profileText(profile, section) || `Your ${sectionTitle(section)} evidence goes here.`;
  return compose(templateId, {
    kind,
    title: sectionTitle(section),
    paragraphs: [
      { text: content },
      { text: "Add the specific proof, figures, or customer detail that makes this credible." },
    ],
    companyName: profile?.company_name || "Your company",
    pageNumber: 3,
    totalPages: 10,
  });
}

function reviewTheme(raw: {
  primary_color?: string | null;
  secondary_color?: string | null;
  font_pairing?: string | null;
  type_scale?: number | null;
} | null): DeckTheme {
  return buildTheme({
    ink: raw?.secondary_color || "#161412",
    paper: "#faf8f3",
    accent: raw?.primary_color || "#b8860b",
    fontPairing: raw?.font_pairing || "fraunces-inter",
    typeScale: raw?.type_scale || 1,
  });
}

const THUMB_W = 220;

function Thumbnail({
  slide,
  theme,
  slideNumber,
  className = "",
  overlay,
  caption = true,
}: {
  slide: ElementSlide;
  theme: DeckTheme;
  slideNumber?: number;
  className?: string;
  overlay?: ReactNode;
  caption?: boolean;
}) {
  return (
    <div className={`rvp-thumbnail ${className}`}>
      <div className="rvp-thumb-media">
        <SlideCanvas
          slide={slide}
          theme={theme}
          interactive={false}
          containerWidth={THUMB_W}
          onChange={() => undefined}
        />
        {overlay}
      </div>
      {caption && (
        <div className="rvp-thumbnail-caption">
          <span>{slide.title}</span>
          <span>{slideNumber != null ? `Slide ${slideNumber + 1}` : "Suggested layout"}</span>
        </div>
      )}
    </div>
  );
}

/** Pulls the quoted hedge words out of a hedging finding's detail string. */
function hedgeWords(detail: string): string[] {
  return [...detail.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
}

/** Reads the word count a density finding reports in its title. */
function slideWordCount(finding: Finding): number {
  return Number(finding.title.match(/(\d+)\s+words?/)?.[1] ?? 0);
}

function FindingVisual({
  finding,
  slides,
  theme,
  templateId,
  profile,
}: {
  finding: Finding;
  slides: ElementSlide[];
  theme: DeckTheme;
  templateId: string;
  profile: CompanyProfile | null;
}) {
  const coverIndex = Math.max(0, slides.findIndex((slide) => slide.kind === "cover"));
  const section = sectionFromFinding(finding);
  const missing = findingType(finding) === "completeness" && section;

  // For a missing section there is no current slide to point at; everything
  // else anchors to the slide the finding names.
  const currentIndex = finding.slideIndex != null ? finding.slideIndex : coverIndex;
  const current = slides[currentIndex] ?? slides[coverIndex];

  const isNoNumbers = finding.id.startsWith("no-numbers-");
  const isHedging = finding.id.startsWith("hedging-");
  const isDense = finding.id.startsWith("dense-");

  // A slide-specific finding we can render a meaningful "after" for, versus a
  // whole-deck finding where a repeated cover thumbnail would mislead.
  const hasSlide = finding.slideIndex != null && !!current;

  // Missing section: show the current deck beside a ghost of the slide to add.
  if (missing) {
    if (!current) return null;
    return (
      <div className="rvp-visual-split">
        <div className="rvp-visual-column">
          <div className="rvp-visual-label">What is there now</div>
          <Thumbnail slide={current} theme={theme} slideNumber={currentIndex} />
        </div>
        <div className="rvp-visual-arrow" aria-hidden="true">→</div>
        <div className="rvp-visual-column">
          <div className="rvp-visual-label">What a {sectionTitle(section)} slide could look like</div>
          <Thumbnail slide={ghostSlide(section, templateId, profile)} theme={theme} className="rvp-ghost" caption={false} />
          <div className="rvp-ghost-label">This is what a {sectionTitle(section)} slide looks like in your template</div>
        </div>
      </div>
    );
  }

  // Findings with no slide to point at (whole-deck structure/completeness):
  // no thumbnail — the finding detail and the fix box already carry it.
  if (!hasSlide || !current) return null;

  // no-numbers: same slide, gold highlight wash, and a concrete-figure prompt
  // pinned to the bottom of the "after".
  if (isNoNumbers) {
    return (
      <div className="rvp-visual-split">
        <div className="rvp-visual-column">
          <div className="rvp-visual-label">What is there now</div>
          <Thumbnail slide={current} theme={theme} slideNumber={currentIndex} />
        </div>
        <div className="rvp-visual-arrow" aria-hidden="true">→</div>
        <div className="rvp-visual-column">
          <div className="rvp-visual-label">What needs to change</div>
          <Thumbnail
            slide={current}
            theme={theme}
            slideNumber={currentIndex}
            overlay={(
              <>
                <div className="rvp-highlight-wash" aria-hidden="true" />
                <div className="rvp-thumb-annotation">
                  Add a specific figure here — e.g. “₦2.3M processed” or “1,350 transactions”
                </div>
              </>
            )}
          />
        </div>
      </div>
    );
  }

  // hedging: same slide, and the actual hedge words struck through with a
  // replacement instruction.
  if (isHedging) {
    const words = hedgeWords(finding.detail);
    return (
      <div className="rvp-visual-split">
        <div className="rvp-visual-column">
          <div className="rvp-visual-label">What is there now</div>
          <Thumbnail slide={current} theme={theme} slideNumber={currentIndex} />
        </div>
        <div className="rvp-visual-arrow" aria-hidden="true">→</div>
        <div className="rvp-visual-column">
          <div className="rvp-visual-label">What needs to change</div>
          <Thumbnail
            slide={current}
            theme={theme}
            slideNumber={currentIndex}
            className="rvp-hedged"
            overlay={(
              <div className="rvp-thumb-annotation">
                {words.length > 0 && (
                  <div className="rvp-hedge-words">
                    {words.map((word) => <s key={word}>{word}</s>)}
                  </div>
                )}
                Replace each with the specific figure or fact it stands in for.
              </div>
            )}
          />
        </div>
      </div>
    );
  }

  // dense: no "after" slide — a word-count badge and the one-claim message.
  if (isDense) {
    const words = slideWordCount(finding);
    return (
      <div className="rvp-visual-split">
        <div className="rvp-visual-column">
          <div className="rvp-visual-label">What is there now</div>
          <Thumbnail slide={current} theme={theme} slideNumber={currentIndex} />
        </div>
        <div className="rvp-visual-arrow" aria-hidden="true">→</div>
        <div className="rvp-visual-column">
          <div className="rvp-visual-label">What needs to change</div>
          <div className="rvp-density-fix">
            <div className="rvp-wordcount-badge">
              <strong>{words || "—"}</strong> words
            </div>
            <p>Aim for under 60 words. Cut to the one claim.</p>
          </div>
        </div>
      </div>
    );
  }

  // Everything else that is slide-specific: show the slide, but no repeated
  // "after" — a fix-only panel instead of a misleading identical thumbnail.
  return (
    <div className="rvp-visual-split">
      <div className="rvp-visual-column">
        <div className="rvp-visual-label">What is there now</div>
        <Thumbnail slide={current} theme={theme} slideNumber={currentIndex} />
      </div>
      <div className="rvp-visual-arrow" aria-hidden="true">→</div>
      <div className="rvp-visual-column">
        <div className="rvp-visual-label">What needs to change</div>
        <div className="rvp-fix-only">{finding.fix}</div>
      </div>
    </div>
  );
}

export default function DeckReview({ onOpenDeck, onNavigate }: Props) {
  const [decks, setDecks] = useState<DeckSummary[] | null>(null);
  const [deckId, setDeckId] = useState<string | null>(null);
  const [slides, setSlides] = useState<ElementSlide[] | null>(null);
  const [brief, setBrief] = useState<ProgramBrief | null>(null);
  const [templateId, setTemplateId] = useState(DEFAULT_TEMPLATE_ID);
  const [deckTheme, setDeckTheme] = useState<DeckTheme>(() => reviewTheme(null));
  const [profile, setProfile] = useState<CompanyProfile | null>(null);
  const [fixing, setFixing] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [severityFilter, setSeverityFilter] = useState<SeverityFilter>("all");
  const [typeFilter, setTypeFilter] = useState<FindingType | "all">("all");
  // Done / Ignored findings, persisted per-user-per-deck on the backend so the
  // state survives a reload (it used to live only in sessionStorage, which
  // reset on every load and wasn't even deck-scoped).
  const [approvedIds, setApprovedIds] = useState<Set<string>>(new Set());
  const [rejectedIds, setRejectedIds] = useState<Set<string>>(new Set());
  const [coachOpen, setCoachOpen] = useState(false);
  const [coachInput, setCoachInput] = useState("");
  const [coachMessages, setCoachMessages] = useState<DeckCoachMessage[]>([]);
  const [coachLoading, setCoachLoading] = useState(false);

  // Load saved finding actions whenever the deck changes. Clear first so one
  // deck's actions never flash while another's load.
  useEffect(() => {
    setApprovedIds(new Set());
    setRejectedIds(new Set());
    if (!deckId) return;
    let cancelled = false;
    getFindingActions(deckId)
      .then((actions) => {
        if (cancelled) return;
        setApprovedIds(new Set(actions.filter((a) => a.action === "done").map((a) => a.finding_id)));
        setRejectedIds(new Set(actions.filter((a) => a.action === "ignored").map((a) => a.finding_id)));
      })
      .catch(() => { /* non-fatal: the review still renders, just without saved actions */ });
    return () => { cancelled = true; };
  }, [deckId]);

  useEffect(() => {
    getCompanyProfile().then(setProfile).catch(() => setProfile(null));
  }, []);

  useEffect(() => {
    listDecks()
      .then((d) => {
        const stored = sessionStorage.getItem("provisio:review-deck");
        const preferred = stored ? d.find((x) => x.id === stored) : null;
        setDecks(d);
        if (d.length) setDeckId(preferred?.id ?? d[0].id);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Couldn't load decks"));
  }, []);

  useEffect(() => {
    if (deckId) sessionStorage.setItem("provisio:review-deck", deckId);
  }, [deckId]);

  useEffect(() => {
    if (!deckId) return;
    let cancelled = false;
    setLoading(true); setError(null);
    getDeck(deckId)
      .then((d) => {
        if (cancelled) return;
        const theme = d.theme as { template_id?: string; program_brief?: ProgramBrief } | null;
        const tpl = theme?.template_id ?? DEFAULT_TEMPLATE_ID;
        setTemplateId(tpl);
        setDeckTheme(reviewTheme(d.theme as {
          primary_color?: string | null;
          secondary_color?: string | null;
          font_pairing?: string | null;
          type_scale?: number | null;
        } | null));
        setBrief(theme?.program_brief ?? null);
        setSlides(toElementSlides(d.slides as unknown as StoredSlide[], tpl, { companyName: d.name }));
      })
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : "Couldn't load deck"))
      .finally(() => !cancelled && setLoading(false));
    return () => { cancelled = true; };
  }, [deckId]);

  const review = useMemo(() => {
    if (!slides) return null;
    const variants = planVariants(slides.map((sl) => ({
      kind: sl.kind,
      paragraphs: sl.elements
        .filter((e) => !e.locked && ["text", "statement", "quote", "list"].includes(e.type))
        .map((e) => ({ text: e.text ?? "" })),
      image: sl.elements.find((e) => e.type === "image" && e.src)?.src ?? null,
      chart: sl.elements.find((e) => e.type === "chart")?.chart ?? null,
    })));
    return { ...reviewDeck(slides, variants, brief), questions: unansweredQuestions(slides) };
  }, [slides, brief]);

  const scoredReview = useMemo(() => {
    if (!review) return null;
    const excluded = new Set([...approvedIds, ...rejectedIds]);
    const removedPenalty = review.findings
      .filter((finding) => excluded.has(finding.id))
      .reduce((total, finding) => total + (finding.severity === "critical" ? 11 : finding.severity === "important" ? 6 : 2), 0);
    return { ...review, score: Math.min(100, review.score + removedPenalty) };
  }, [review, approvedIds, rejectedIds]);

  const runFix = async (findingId: string, action: FixAction) => {
    if (action.kind === "fill-profile" && action.profileField) {
      onNavigate?.("profile", action.profileField);
      return;
    }
    if (action.kind === "open-slide") {
      if (deckId) onOpenDeck?.(deckId, action.slideIndex);
      return;
    }
    if (action.kind === "manual") {
      if (deckId) onOpenDeck?.(deckId);
      return;
    }
    if (action.kind === "add-slide" && action.section && deckId) {
      setFixing(findingId);
      try {
        const d = await addSlide(deckId, action.section);
        const theme = d.theme as { template_id?: string; program_brief?: ProgramBrief } | null;
        const tpl = theme?.template_id ?? DEFAULT_TEMPLATE_ID;
        setTemplateId(tpl);
        setBrief(theme?.program_brief ?? null);
        setDeckTheme(reviewTheme(d.theme as {
          primary_color?: string | null;
          secondary_color?: string | null;
          font_pairing?: string | null;
          type_scale?: number | null;
        } | null));
        setSlides(toElementSlides(d.slides as unknown as StoredSlide[], tpl, { companyName: d.name }));
      } catch (e) {
        setError(e instanceof Error ? e.message : "Regeneration failed");
      } finally {
        setFixing(null);
      }
    }
  };

  const deck = decks?.find((d) => d.id === deckId);
  const shown = review?.findings.filter((f) => (
    (severityFilter === "all" || f.severity === severityFilter) &&
    (typeFilter === "all" || findingType(f) === typeFilter)
  )) ?? [];
  const countSeverity = (s: Finding["severity"]) => review?.findings.filter((f) => f.severity === s).length ?? 0;
  const countType = (type: FindingType) => review?.findings.filter((f) => findingType(f) === type).length ?? 0;
  const band = !scoredReview ? "mid" : scoredReview.score >= 80 ? "good" : scoredReview.score >= 50 ? "mid" : "low";
  const verdict = !scoredReview ? "" : scoredReview.score >= 80 ? "Ready to send" : scoredReview.score >= 50 ? "Close — fix the critical items first" : "Not ready — the argument has gaps";

  // Fire-and-forget persistence: the UI updates immediately; a failed write is
  // surfaced quietly without blocking the interaction.
  function persistAction(id: string, action: "done" | "ignored") {
    if (!deckId) return;
    saveFindingAction(deckId, id, action).catch(() =>
      setError("Couldn't save that action — it may not stick after a reload."));
  }
  function clearAction(id: string) {
    if (!deckId) return;
    deleteFindingAction(deckId, id).catch(() =>
      setError("Couldn't update that action — it may not stick after a reload."));
  }

  function markApproved(id: string) {
    setRejectedIds((previous) => { const next = new Set(previous); next.delete(id); return next; });
    setApprovedIds((previous) => new Set(previous).add(id));
    persistAction(id, "done");
  }

  function markRejected(id: string) {
    setApprovedIds((previous) => { const next = new Set(previous); next.delete(id); return next; });
    setRejectedIds((previous) => new Set(previous).add(id));
    persistAction(id, "ignored");
  }

  function undoRejected(id: string) {
    setRejectedIds((previous) => { const next = new Set(previous); next.delete(id); return next; });
    clearAction(id);
  }

  function undoApproved(id: string) {
    setApprovedIds((previous) => { const next = new Set(previous); next.delete(id); return next; });
    clearAction(id);
  }

  async function sendCoachMessage(message: string) {
    const content = message.trim();
    if (!content || coachLoading || !review) return;
    const nextMessages: DeckCoachMessage[] = [...coachMessages, { role: "user", content }];
    setCoachMessages(nextMessages);
    setCoachInput("");
    setCoachLoading(true);
    try {
      const response = await askDeckCoach(nextMessages, {
        findings: review.findings.map(({ id, title, detail, severity }) => ({ id, title, detail, severity })),
        approved_ids: [...approvedIds],
        rejected_ids: [...rejectedIds],
        brief,
        profile,
        deck_name: deck?.name ?? "your deck",
      });
      setCoachMessages((previous) => [...previous, { role: "assistant", content: response.reply }]);
    } catch (e) {
      setCoachMessages((previous) => [...previous, { role: "assistant", content: e instanceof Error ? e.message : "The deck coach is unavailable right now." }]);
    } finally {
      setCoachLoading(false);
    }
  }

  return (
    <div className="rvp">
      <header className="rvp-header">
        <div>
          <div className="rvp-eyebrow">Deck review</div>
          <h1 className="rvp-title">How your pitch reads to an investor</h1>
          <p className="rvp-sub">This reads your argument, not your formatting — evidence, completeness, density and the questions you'll be asked.</p>
          {brief && (
            <div className="rvp-aimed">
              Judged as a submission to <strong>{brief.programme}</strong> ({brief.audience_label}), against what they select on.
            </div>
          )}
        </div>
        {decks && decks.length > 0 && (
          <div className="rvp-picker">
            <label>Reviewing</label>
            <select value={deckId ?? ""} onChange={(e) => setDeckId(e.target.value)}>
              {decks.map((d) => <option key={d.id} value={d.id}>{d.name} · {d.slide_count} slides</option>)}
            </select>
          </div>
        )}
      </header>

      {error && <p className="rvp-error">{error}</p>}
      {decks && decks.length === 0 && (
        <div className="rvp-empty">No decks yet. Build one in the Deck tab, then come back to review it.</div>
      )}
      {(loading || (decks === null && !error)) && <div className="rvp-loading"><span className="rvp-spin" />Reading the deck…</div>}

      {review && !loading && (
        <div className="rvp-body">
          <aside className="rvp-summary">
            <div className={`rvp-score-meter rvp-${band}`}>
              <div className="rvp-score-topline">
                <span className="rvp-label">Deck signal</span>
                <span className="rvp-score-n">{scoredReview?.score ?? review.score}<small>/100</small></span>
              </div>
              <div
                className="rvp-score-track"
                role="progressbar"
                aria-label="Deck review score"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={scoredReview?.score ?? review.score}
              >
                <div className="rvp-score-fill" style={{ width: `${scoredReview?.score ?? review.score}%` }} />
              </div>
            </div>
            <div className={`rvp-verdict rvp-${band}`}>{verdict}</div>
            <div className="rvp-resolution">Resolved {approvedIds.size} / Ignored {rejectedIds.size}</div>
            <div className="rvp-stats">
              <div><span>{countSeverity("critical")}</span>critical</div>
              <div><span>{countSeverity("important")}</span>important</div>
              <div><span>{countSeverity("polish")}</span>polish</div>
            </div>
            <div className="rvp-meta">
              <div><em>Slides</em>{slides?.length}</div>
              <div><em>Words</em>{review.wordsTotal}</div>
              <div><em>Spoken</em>~{review.readingMinutes} min</div>
            </div>
            {deck && onOpenDeck && (
              <button className="rvp-open" onClick={() => onOpenDeck(deck.id)}>Open {deck.name} in editor →</button>
            )}
            {brief?.selection_criteria?.length ? (
              <div className="rvp-criteria">
                <div className="rvp-label">What {brief.programme} selects on</div>
                {brief.selection_criteria.map((c, i) => <p key={i}>{c}</p>)}
              </div>
            ) : null}

            {review.strengths.length > 0 && (
              <div className="rvp-strengths">
                <div className="rvp-label">What's working</div>
                {review.strengths.map((s, i) => <p key={i}>{s}</p>)}
              </div>
            )}
          </aside>

          <main className="rvp-main">
            <div className="rvp-filter-groups">
              <div className="rvp-filter-group">
                <span className="rvp-filter-label">Severity</span>
                {(["all", "critical", "important", "polish"] as const).map((f) => (
                  <button key={f} className={severityFilter === f ? "is-active" : ""} onClick={() => setSeverityFilter(f)}>
                    {f === "all" ? `All (${review.findings.length})` : `${f[0].toUpperCase()}${f.slice(1)} (${countSeverity(f)})`}
                  </button>
                ))}
              </div>
              <div className="rvp-filter-group">
                <span className="rvp-filter-label">Type</span>
                <button className={typeFilter === "all" ? "is-active" : ""} onClick={() => setTypeFilter("all")}>
                  All types
                </button>
                {FINDING_TYPES.map((type) => (
                  <button key={type.id} className={typeFilter === type.id ? "is-active" : ""} onClick={() => setTypeFilter(type.id)}>
                    {type.label} ({countType(type.id)})
                  </button>
                ))}
              </div>
            </div>

            <div className="rvp-filter-summary">
              Showing {shown.length} of {review.findings.length} findings
            </div>

            {shown.length === 0 ? (
              <div className="rvp-clear">
                {review.findings.length === 0 ? "Nothing to fix. This deck holds up." : "Nothing in this filter combination."}
              </div>
            ) : (
              <div className="rvp-findings">
                {shown.map((f) => {
                  const type = findingType(f);
                  const approved = approvedIds.has(f.id);
                  const rejected = rejectedIds.has(f.id);
                  if (approved) {
                    return (
                      <article key={f.id} className="rvp-finding rvp-finding-collapsed rvp-approved">
                        <span className="rvp-collapsed-title"><span>✓</span>{f.title}</span>
                        <button className="rvp-undo-btn" onClick={() => undoApproved(f.id)}>Undo</button>
                      </article>
                    );
                  }
                  if (rejected) {
                    return (
                      <article key={f.id} className="rvp-finding rvp-finding-collapsed rvp-rejected">
                        <span className="rvp-collapsed-title">{f.title}</span>
                        <button className="rvp-undo-btn" onClick={() => undoRejected(f.id)}>Undo</button>
                      </article>
                    );
                  }
                  const action = planFix(f, profile);
                  return (
                    <article key={f.id} className={`rvp-finding rvp-f-${f.severity} rvp-type-${type}`}>
                      <div className="rvp-f-head">
                        <span className="rvp-f-type">{FINDING_TYPES.find((item) => item.id === type)?.label}</span>
                        <span className="rvp-f-sev">{f.severity}</span>
                        <span className="rvp-f-where">{f.slideIndex === null ? "Whole deck" : `Slide ${f.slideIndex + 1}`}</span>
                      </div>
                      <h3>{f.title}</h3>
                      <p className="rvp-f-detail">{f.detail}</p>
                      <FindingVisual
                        finding={f}
                        slides={slides ?? []}
                        theme={deckTheme}
                        templateId={templateId}
                        profile={profile}
                      />
                      <div className="rvp-fix-box">
                        <div className="rvp-fix-preview">{action.preview}</div>
                        <button
                          className="rvp-fix-btn"
                          disabled={fixing === f.id}
                          onClick={() => runFix(f.id, action)}
                        >
                          {fixing === f.id ? "Working…" : action.label} →
                        </button>
                        <button className="rvp-done-btn" onClick={() => markApproved(f.id)}>✓ Done</button>
                        <button className="rvp-ignore-btn" onClick={() => markRejected(f.id)}>✕ Ignore</button>
                      </div>
                    </article>
                  );
                })}
              </div>
            )}

            {review.questions.length > 0 && (
              <section className="rvp-questions">
                <div className="rvp-label">Questions this deck doesn't answer yet</div>
                <p className="rvp-q-hint">An investor will ask these. Better answered on a slide than in the room.</p>
                <ol>{review.questions.map((q, i) => <li key={i}>{q}</li>)}</ol>
              </section>
            )}
          </main>
        </div>
      )}

      <button className="rvp-ask-ai" onClick={() => setCoachOpen(true)}>Ask AI</button>
      <aside className={`rvp-coach ${coachOpen ? "is-open" : ""}`} aria-label="Deck coach">
        <div className="rvp-coach-header">
          <div>
            <div className="rvp-label">Deck coach</div>
            <strong>Talk through your review</strong>
          </div>
          <button className="rvp-coach-close" onClick={() => setCoachOpen(false)} aria-label="Close deck coach">×</button>
        </div>
        <div className="rvp-coach-thread">
          {coachMessages.length === 0 && (
            <div className="rvp-coach-starters">
              <p>Ask about this deck:</p>
              {[
                "Why did you flag the traction slide?",
                "How do I improve my score?",
                `What does ${brief?.programme ?? "the programme"} actually care about?`,
                "Which finding should I fix first?",
              ].map((question) => (
                <button key={question} onClick={() => sendCoachMessage(question)}>{question}</button>
              ))}
            </div>
          )}
          {coachMessages.map((message, index) => (
            <div key={`${message.role}-${index}`} className={`rvp-coach-message rvp-coach-${message.role}`}>
              {message.content}
            </div>
          ))}
          {coachLoading && (
            <div className="rvp-coach-typing" aria-label="Deck coach is typing"><i /><i /><i /></div>
          )}
        </div>
        <form className="rvp-coach-composer" onSubmit={(e) => { e.preventDefault(); void sendCoachMessage(coachInput); }}>
          <textarea
            value={coachInput}
            placeholder="Ask about a finding…"
            rows={2}
            onChange={(e) => setCoachInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void sendCoachMessage(coachInput);
              }
            }}
          />
          <WordCount text={coachInput} />
          <button type="submit" disabled={coachLoading || !coachInput.trim()}>Send</button>
        </form>
      </aside>
    </div>
  );
}
