/**
 * Deck Review — its own page.
 *
 * Reads a saved deck the same way the editor does (stored slides converted
 * through the active template) and critiques the argument: missing sections,
 * claims without numbers, hedge words, density, rhythm, and the investor
 * questions the deck leaves unanswered. Computed locally, so it's instant.
 */
import { useEffect, useMemo, useState } from "react";
import {
  getCompanyProfile,
  getDeck,
  listDecks,
  regenerateDeck,
  type CompanyProfile,
  type DeckSummary,
} from "./api";
import { toElementSlides, type StoredSlide } from "./deck/migrate";
import { DEFAULT_TEMPLATE_ID } from "./deck/templates";
import { planFix } from "./deck/fixActions";
import type { FixAction } from "./deck/fixActions";
import { reviewDeck, unansweredQuestions, type Finding, type ProgramBrief } from "./deck/review";
import { planVariants } from "./deck/variants";
import type { ElementSlide } from "./deck/elements";
import "./deck-review.css";
import "./fix-button.css";

interface Props {
  onOpenDeck?: (id: string, slideIndex?: number) => void;
  onNavigate?: (tab: "profile", focusField?: string) => void;
}

export default function DeckReview({ onOpenDeck, onNavigate }: Props) {
  const [decks, setDecks] = useState<DeckSummary[] | null>(null);
  const [deckId, setDeckId] = useState<string | null>(null);
  const [slides, setSlides] = useState<ElementSlide[] | null>(null);
  const [brief, setBrief] = useState<ProgramBrief | null>(null);
  const [profile, setProfile] = useState<CompanyProfile | null>(null);
  const [fixing, setFixing] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | Finding["severity"]>("all");

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
    if (action.kind === "regenerate" && deckId) {
      setFixing(findingId);
      try {
        await regenerateDeck(deckId, []);
        const d = await getDeck(deckId);
        const theme = d.theme as { template_id?: string; program_brief?: ProgramBrief } | null;
        const tpl = theme?.template_id ?? DEFAULT_TEMPLATE_ID;
        setBrief(theme?.program_brief ?? null);
        setSlides(toElementSlides(d.slides as unknown as StoredSlide[], tpl, { companyName: d.name }));
      } catch (e) {
        setError(e instanceof Error ? e.message : "Regeneration failed");
      } finally {
        setFixing(null);
      }
    }
  };

  const deck = decks?.find((d) => d.id === deckId);
  const shown = review?.findings.filter((f) => filter === "all" || f.severity === filter) ?? [];
  const count = (s: Finding["severity"]) => review?.findings.filter((f) => f.severity === s).length ?? 0;
  const band = !review ? "mid" : review.score >= 80 ? "good" : review.score >= 50 ? "mid" : "low";
  const verdict = !review ? "" : review.score >= 80 ? "Ready to send" : review.score >= 50 ? "Close — fix the critical items first" : "Not ready — the argument has gaps";

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
            <div className={`rvp-score rvp-${band}`}>
              <div className="rvp-score-n">{review.score}</div>
              <div className="rvp-score-of">/ 100</div>
            </div>
            <div className={`rvp-verdict rvp-${band}`}>{verdict}</div>
            <div className="rvp-stats">
              <div><span>{count("critical")}</span>critical</div>
              <div><span>{count("important")}</span>important</div>
              <div><span>{count("polish")}</span>polish</div>
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
            <div className="rvp-filters">
              {(["all", "critical", "important", "polish"] as const).map((f) => (
                <button key={f} className={filter === f ? "is-active" : ""} onClick={() => setFilter(f)}>
                  {f === "all" ? `All (${review.findings.length})` : `${f[0].toUpperCase()}${f.slice(1)} (${count(f)})`}
                </button>
              ))}
            </div>

            {shown.length === 0 ? (
              <div className="rvp-clear">
                {review.findings.length === 0 ? "Nothing to fix. This deck holds up." : "Nothing in this category."}
              </div>
            ) : (
              <div className="rvp-findings">
                {shown.map((f) => (
                  <article key={f.id} className={`rvp-finding rvp-f-${f.severity}`}>
                    <div className="rvp-f-head">
                      <span className="rvp-f-sev">{f.severity}</span>
                      <span className="rvp-f-where">{f.slideIndex === null ? "Whole deck" : `Slide ${f.slideIndex + 1}`}</span>
                    </div>
                    <h3>{f.title}</h3>
                    <p className="rvp-f-detail">{f.detail}</p>
                    <p className="rvp-f-fix"><strong>Fix:</strong> {f.fix}</p>
                    {(() => {
                      const action = planFix(f, profile);
                      return (
                        <div className="rvp-fix-box">
                          <div className="rvp-fix-preview">{action.preview}</div>
                          <button
                            className="rvp-fix-btn"
                            disabled={fixing === f.id}
                            onClick={() => runFix(f.id, action)}
                          >
                            {fixing === f.id ? "Working…" : action.label} →
                          </button>
                        </div>
                      );
                    })()}
                  </article>
                ))}
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
    </div>
  );
}
