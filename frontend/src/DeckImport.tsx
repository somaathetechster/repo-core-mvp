import { useRef, useState } from "react";
import { importPitchDeck, type DeckImportResult, type ImportSuggestion } from "./api";
import "./deck-import.css";

const FIELD_LABELS: Record<string, string> = {
  company_name: "Company name",
  one_liner: "One-liner",
  problem: "Problem",
  solution: "Solution",
  market_opportunity: "Market opportunity",
  competitive_landscape: "Competitive landscape",
  traction: "Traction",
  key_metrics: "Key metrics",
  business_model: "Business model",
  pricing_model: "Pricing model",
  evidence_of_innovation: "Evidence of innovation",
  risks_and_mitigations: "Risks and mitigations",
  funding_ask: "Funding ask",
};

/**
 * Imports an existing pitch deck and lets the founder accept extracted
 * content field by field.
 *
 * Nothing is applied automatically. Each suggestion shows which slides it
 * came from and how confident the extraction was, and is editable before
 * it's accepted, because an extraction that silently overwrites a profile
 * is worse than one that asks.
 */
export default function DeckImport({
  onApply,
  onClose,
}: {
  onApply: (fields: Record<string, string>) => void;
  onClose: () => void;
}) {
  const [result, setResult] = useState<DeckImportResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [accepted, setAccepted] = useState<Set<string>>(new Set());
  const [edited, setEdited] = useState<Record<string, string>>({});
  const fileRef = useRef<HTMLInputElement>(null);

  async function handleFile(file: File) {
    setBusy(true);
    setError(null);
    try {
      const r = await importPitchDeck(file);
      setResult(r);
      // Pre-accept only the high-confidence fields. Medium and low are
      // opt-in, so a loose guess never lands in the profile unnoticed.
      setAccepted(new Set(r.suggestions.filter((s) => s.confidence === "high").map((s) => s.field)));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not import that deck.");
    } finally {
      setBusy(false);
    }
  }

  function apply() {
    if (!result) return;
    const fields: Record<string, string> = {};
    for (const s of result.suggestions) {
      if (accepted.has(s.field)) fields[s.field] = edited[s.field] ?? s.value;
    }
    if (result.detected_company_name && accepted.has("company_name")) {
      fields.company_name = edited.company_name ?? result.detected_company_name;
    }
    onApply(fields);
  }

  return (
    <div className="di-overlay" onClick={onClose}>
      <div className="di-modal" onClick={(e) => e.stopPropagation()}>
        <header className="di-head">
          <h2>Import an existing deck</h2>
          <button className="di-close" onClick={onClose}>×</button>
        </header>

        {error && <p className="p-error">{error}</p>}

        {!result && (
          <>
            <p className="di-intro">
              Upload a PDF or PowerPoint pitch deck. Provisio reads it slide by slide and proposes
              which profile field each piece of content belongs to. You choose what to keep.
            </p>
            <button className="di-drop" onClick={() => fileRef.current?.click()} disabled={busy}>
              <span>{busy ? "Reading your deck…" : "Choose a deck, or drop one here"}</span>
              <em>PDF or .pptx, up to 25MB</em>
            </button>
            <input
              ref={fileRef} type="file" accept=".pdf,.pptx" hidden
              onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
            />
          </>
        )}

        {result && (
          <>
            <p className="di-summary">
              Read {result.slide_count} slides.
              {result.detected_company_name && <> Detected company: <strong>{result.detected_company_name}</strong>.</>}
            </p>

            {result.warnings.map((w, i) => (
              <p className="di-warning" key={i}>{w}</p>
            ))}

            <div className="di-suggestions">
              {result.suggestions.map((s: ImportSuggestion) => (
                <div className={`di-suggestion ${accepted.has(s.field) ? "is-accepted" : ""}`} key={s.field}>
                  <label className="di-suggestion-head">
                    <input
                      type="checkbox"
                      checked={accepted.has(s.field)}
                      onChange={(e) => {
                        const next = new Set(accepted);
                        if (e.target.checked) next.add(s.field); else next.delete(s.field);
                        setAccepted(next);
                      }}
                    />
                    <span className="di-field-name">{FIELD_LABELS[s.field] ?? s.field}</span>
                    <span className={`di-confidence di-${s.confidence}`}>{s.confidence}</span>
                    {s.source_slides.length > 0 && (
                      <span className="di-slides">slide {s.source_slides.join(", ")}</span>
                    )}
                  </label>
                  <textarea
                    className="p-input di-value"
                    rows={3}
                    value={edited[s.field] ?? s.value}
                    onChange={(e) => setEdited({ ...edited, [s.field]: e.target.value })}
                  />
                </div>
              ))}
              {result.suggestions.length === 0 && (
                <p className="di-intro">
                  No profile content could be matched from that deck. It may be mostly images, or
                  structured differently than expected.
                </p>
              )}
            </div>

            <footer className="di-actions">
              <button className="p-btn p-btn-secondary" onClick={() => setResult(null)}>Try another deck</button>
              <button className="p-btn p-btn-primary" onClick={apply} disabled={accepted.size === 0}>
                Apply {accepted.size} field{accepted.size === 1 ? "" : "s"}
              </button>
            </footer>
          </>
        )}
      </div>
    </div>
  );
}
