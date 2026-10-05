import { useEffect } from "react";
import {
  TEMPLATES, COLOR_SCHEMES, getTemplate, ensureFonts,
} from "./deck/templates";
import "./template-picker.css";

export interface DeckStyle {
  templateId: string;
  schemeId: string;
}

/**
 * Live template and colour switching.
 *
 * Templates are compositional systems, so switching one restructures every
 * slide: different grid, cover architecture, title placement and rhythm.
 * Schemes only change colour. Keeping them as separate controls matters,
 * because "try a different look" and "try a different colour" are different
 * intentions and collapsing them into one list hides that.
 */
export default function TemplatePicker({
  value,
  onChange,
  brandPrimary,
}: {
  value: DeckStyle;
  onChange: (next: DeckStyle) => void;
  brandPrimary?: string | null;
}) {
  // Load the fonts for whatever is selected, and pre-load the rest so
  // switching is instant rather than flashing fallback type.
  useEffect(() => {
    ensureFonts(getTemplate(value.templateId));
    const timer = setTimeout(() => TEMPLATES.forEach(ensureFonts), 1200);
    return () => clearTimeout(timer);
  }, [value.templateId]);

  return (
    <div className="tp">
      <section className="tp-section">
        <h3>Template</h3>
        <p className="tp-hint">
          Each one is a different compositional system, not a colour change. Switching restructures
          every slide.
        </p>
        <div className="tp-templates">
          {TEMPLATES.map((t) => (
            <button
              key={t.id}
              className={`tp-template ${value.templateId === t.id ? "is-active" : ""}`}
              onClick={() => onChange({ ...value, templateId: t.id })}
            >
              <TemplateGlyph templateId={t.id} accent={t.defaults.accent} ink={t.defaults.ink} paper={t.defaults.paper} />
              <span className="tp-template-name">{t.name}</span>
              <span className="tp-template-desc">{t.description}</span>
              <span className="tp-template-best">{t.bestFor}</span>
            </button>
          ))}
        </div>
      </section>

      <section className="tp-section">
        <h3>Colour</h3>
        <p className="tp-hint">
          {brandPrimary
            ? "Your brand colour from Company profile overrides the accent in every scheme."
            : "Set brand colours in Company profile and they'll override these automatically."}
        </p>
        <div className="tp-schemes">
          {COLOR_SCHEMES.map((s) => {
            const t = getTemplate(value.templateId);
            const ink = s.id === "template" ? t.defaults.ink : s.ink;
            const paper = s.id === "template" ? t.defaults.paper : s.paper;
            const accent = brandPrimary ?? (s.id === "template" ? t.defaults.accent : s.accent);
            return (
              <button
                key={s.id}
                className={`tp-scheme ${value.schemeId === s.id ? "is-active" : ""}`}
                onClick={() => onChange({ ...value, schemeId: s.id })}
                title={s.name}
              >
                <span className="tp-swatches">
                  <span style={{ background: ink }} />
                  <span style={{ background: accent }} />
                  <span style={{ background: paper, border: "1px solid rgba(0,0,0,0.12)" }} />
                </span>
                <span className="tp-scheme-name">{s.name}</span>
              </button>
            );
          })}
        </div>
      </section>
    </div>
  );
}

/**
 * A tiny abstract diagram of each template's composition, so the choice is
 * made by looking rather than by reading six descriptions. Each glyph
 * mirrors that template's actual cover architecture.
 */
function TemplateGlyph({
  templateId, accent, ink, paper,
}: { templateId: string; accent: string; ink: string; paper: string }) {
  const common = { width: 100, height: 56 };
  switch (templateId) {
    case "modernist":
      return (
        <svg {...common} viewBox="0 0 100 56">
          <rect width="100" height="56" fill={paper} />
          <rect width="38" height="56" fill={accent} />
          <rect x="48" y="18" width="40" height="5" fill={ink} />
          <rect x="48" y="27" width="28" height="3" fill={ink} opacity="0.4" />
        </svg>
      );
    case "technical":
      return (
        <svg {...common} viewBox="0 0 100 56">
          <rect width="100" height="56" fill={paper} />
          <rect width="100" height="9" fill={accent} />
          <rect x="10" y="22" width="44" height="5" fill={ink} />
          <rect x="10" y="33" width="80" height="1" fill={ink} opacity="0.3" />
          <rect x="10" y="39" width="70" height="2" fill={ink} opacity="0.3" />
          <rect x="10" y="45" width="60" height="2" fill={ink} opacity="0.3" />
        </svg>
      );
    case "statement":
      return (
        <svg {...common} viewBox="0 0 100 56">
          <rect width="100" height="56" fill={paper} />
          <rect x="12" y="14" width="26" height="6" fill={accent} />
          <rect x="12" y="28" width="66" height="9" fill={ink} />
          <rect x="12" y="41" width="40" height="9" fill={ink} />
        </svg>
      );
    case "institutional":
      return (
        <svg {...common} viewBox="0 0 100 56">
          <rect width="100" height="56" fill={paper} />
          <rect x="30" y="14" width="40" height="1" fill={ink} opacity="0.4" />
          <rect x="26" y="22" width="48" height="5" fill={ink} />
          <rect x="34" y="32" width="32" height="2" fill={ink} opacity="0.35" />
          <rect x="30" y="42" width="40" height="1" fill={ink} opacity="0.4" />
        </svg>
      );
    case "narrative":
      return (
        <svg {...common} viewBox="0 0 100 56">
          <rect width="100" height="56" fill={ink} />
          <rect width="100" height="56" fill={accent} opacity="0.35" />
          <rect x="10" y="30" width="46" height="6" fill={paper} />
          <rect x="10" y="41" width="30" height="3" fill={paper} opacity="0.6" />
        </svg>
      );
    default: // editorial
      return (
        <svg {...common} viewBox="0 0 100 56">
          <rect width="100" height="56" fill={ink} />
          <rect x="12" y="30" width="52" height="7" fill={paper} />
          <rect x="12" y="42" width="34" height="3" fill={paper} opacity="0.55" />
          <rect x="12" y="14" width="18" height="3" fill={accent} />
        </svg>
      );
  }
}
