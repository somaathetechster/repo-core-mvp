import type { CSSProperties, ReactNode } from "react";
import { type DeckTemplate } from "./templates";
import { mix, type DeckPalette } from "./design";
import type { SlideContent } from "./SlideLayouts";
import { chooseLayout, type SlideLayout } from "./design";

export const SLIDE_W = 1280;
export const SLIDE_H = 720;

export interface TemplatedSlideProps {
  slide: SlideContent;
  template: DeckTemplate;
  palette: DeckPalette;
  logo?: string | null;
  companyName?: string;
  pageNumber?: number;
  totalPages?: number;
  chartNode?: ReactNode;
  layoutOverride?: SlideLayout | null;
}

/** Density scales margins and leading, so the same layout breathes
 *  differently across templates without separate implementations. */
function densityScale(t: DeckTemplate): number {
  return t.traits.density === "generous" ? 1.15 : t.traits.density === "dense" ? 0.82 : 1;
}

function gridX(t: DeckTemplate, col: number): number {
  const content = SLIDE_W - t.grid.margin * 2;
  const unit = (content - t.grid.gutter * (t.grid.columns - 1)) / t.grid.columns;
  return t.grid.margin + (unit + t.grid.gutter) * col;
}

function gridW(t: DeckTemplate, span: number): number {
  const content = SLIDE_W - t.grid.margin * 2;
  const unit = (content - t.grid.gutter * (t.grid.columns - 1)) / t.grid.columns;
  return unit * span + t.grid.gutter * (span - 1);
}

export default function TemplatedSlide(props: TemplatedSlideProps) {
  const { template, palette } = props;
  const layout = props.layoutOverride ?? chooseLayout(props.slide);

  const frame: CSSProperties = {
    position: "relative",
    width: SLIDE_W,
    height: SLIDE_H,
    background: palette.paper,
    color: palette.ink,
    overflow: "hidden",
    fontFamily: template.fonts.body,
  };

  return <div style={frame}>{render(layout, props)}</div>;
}

function render(layout: SlideLayout, p: TemplatedSlideProps): ReactNode {
  switch (layout) {
    case "cover": return <Cover {...p} />;
    case "statement": return <Statement {...p} />;
    case "points": return <Points {...p} />;
    case "split": return <Split {...p} />;
    case "team": return <Team {...p} />;
    case "contents": return <Contents {...p} />;
    case "chart": return <Chart {...p} />;
    case "image": return <FullImage {...p} />;
    default: return <Argument {...p} />;
  }
}

/* ------------------------------------------------------------------ */
/* Shared structural devices, driven by traits                         */
/* ------------------------------------------------------------------ */

function Rule({ template, palette, width = 44 }: { template: DeckTemplate; palette: DeckPalette; width?: number }) {
  const r = template.traits.rule;
  if (r === "none") return null;
  if (r === "hairline-full") {
    return <div style={{ height: 1, background: palette.rule, width: "100%", marginBottom: 20 }} />;
  }
  if (r === "block-fill") {
    return <div style={{ height: 10, width: width * 1.4, background: palette.accent, marginBottom: 24 }} />;
  }
  if (r === "column-divider") {
    return <div style={{ height: 1, background: palette.accent, width: "100%", marginBottom: 16, opacity: 0.5 }} />;
  }
  return <div style={{ height: 3, width, background: palette.accent, marginBottom: 20 }} />;
}

function SlideTitle({
  text, template, palette, maxSpan = 8,
}: { text: string; template: DeckTemplate; palette: DeckPalette; maxSpan?: number }) {
  const centered = template.traits.align === "centered";
  return (
    <h2 style={{
      fontFamily: template.fonts.display,
      fontSize: template.type.headline,
      lineHeight: template.leading.tight * 1.12,
      margin: 0,
      fontWeight: 600,
      letterSpacing: template.fonts.display.includes("Inter") ? "-0.02em" : "-0.01em",
      maxWidth: centered ? "100%" : gridW(template, maxSpan),
      textAlign: centered ? "center" : "left",
      color: palette.ink,
    }}>
      {text}
    </h2>
  );
}

function Footer({ template, palette, companyName, pageNumber, totalPages, logo, inverted }: {
  template: DeckTemplate; palette: DeckPalette;
  companyName?: string; pageNumber?: number; totalPages?: number;
  logo?: string | null; inverted?: boolean;
}) {
  if (template.traits.numbering === "none" && !companyName) return null;
  const color = inverted ? mix(palette.inverse, palette.ink, 0.45) : palette.muted;
  const label =
    template.traits.numbering === "sectioned" && pageNumber
      ? String(pageNumber).padStart(2, "0")
      : template.traits.numbering === "numeric" && pageNumber
        ? `${pageNumber}${totalPages ? ` / ${totalPages}` : ""}`
        : "";

  return (
    <div style={{
      position: "absolute", left: template.grid.margin, right: template.grid.margin, bottom: 38,
      display: "flex", alignItems: "center",
      justifyContent: template.traits.align === "centered" ? "center" : "space-between",
      gap: 16,
      fontFamily: template.fonts.label, fontSize: template.type.micro, color,
    }}>
      <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
        {logo && <img src={logo} alt="" style={{ height: 15, width: "auto", opacity: 0.7 }} />}
        {companyName}
      </span>
      {label && <span style={{ fontVariantNumeric: "tabular-nums" }}>{label}</span>}
    </div>
  );
}

function Sources({ blocks, template, palette }: { blocks: { source: string }[]; template: DeckTemplate; palette: DeckPalette }) {
  const unique = [...new Set(blocks.map((b) => b.source).filter(Boolean))];
  if (unique.length === 0) return null;
  return (
    <div style={{
      position: "absolute", left: template.grid.margin, right: template.grid.margin, bottom: 66,
      fontFamily: template.fonts.label, fontSize: template.type.micro,
      color: mix(palette.muted, palette.paper, 0.35),
      textAlign: template.traits.align === "centered" ? "center" : "left",
    }}>
      {unique.join("  ·  ")}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Cover: six genuinely different architectures                        */
/* ------------------------------------------------------------------ */

function Cover(p: TemplatedSlideProps) {
  const { slide, template: t, palette, logo } = p;
  const tagline = slide.blocks[0]?.text;
  const style = t.traits.cover;

  if (style === "split-vertical") {
    return (
      <>
        <div style={{ position: "absolute", inset: 0, display: "flex" }}>
          <div style={{ width: "38%", background: palette.accent }} />
          <div style={{ width: "62%", background: palette.paper }} />
        </div>
        <div style={{
          position: "absolute", left: "38%", top: 0, bottom: 0,
          paddingLeft: 72, paddingRight: t.grid.margin,
          display: "flex", flexDirection: "column", justifyContent: "center",
        }}>
          {logo && <img src={logo} alt="" style={{ height: 36, width: "auto", marginBottom: 40, alignSelf: "flex-start" }} />}
          <h1 style={{
            fontFamily: t.fonts.display, fontSize: t.type.display,
            lineHeight: t.leading.tight, margin: 0, fontWeight: 700,
            letterSpacing: "-0.03em", color: palette.ink,
          }}>
            {slide.title}
          </h1>
          {tagline && (
            <p style={{
              fontFamily: t.fonts.body, fontSize: t.type.subhead,
              lineHeight: t.leading.normal, margin: "28px 0 0",
              color: mix(palette.ink, palette.paper, 0.3), maxWidth: 480,
            }}>
              {tagline}
            </p>
          )}
        </div>
      </>
    );
  }

  if (style === "paper-minimal") {
    return (
      <div style={{
        position: "absolute", inset: 0, padding: t.grid.margin,
        display: "flex", flexDirection: "column", justifyContent: "flex-end",
      }}>
        <div style={{ height: 14, width: 120, background: palette.accent, marginBottom: 48 }} />
        <h1 style={{
          fontFamily: t.fonts.display, fontSize: t.type.display,
          lineHeight: t.leading.tight, margin: 0, fontWeight: 800,
          letterSpacing: "-0.04em", color: palette.ink, maxWidth: gridW(t, 7),
        }}>
          {slide.title}
        </h1>
        {tagline && (
          <p style={{
            fontFamily: t.fonts.body, fontSize: t.type.subhead,
            margin: "32px 0 0", maxWidth: gridW(t, 5),
            color: mix(palette.ink, palette.paper, 0.35), lineHeight: t.leading.normal,
          }}>
            {tagline}
          </p>
        )}
      </div>
    );
  }

  if (style === "centered-formal") {
    return (
      <div style={{
        position: "absolute", inset: 0, padding: t.grid.margin,
        display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
        textAlign: "center",
      }}>
        {logo && <img src={logo} alt="" style={{ height: 40, width: "auto", marginBottom: 44 }} />}
        <div style={{ height: 1, width: 180, background: palette.rule, marginBottom: 36 }} />
        <h1 style={{
          fontFamily: t.fonts.display, fontSize: t.type.display,
          lineHeight: t.leading.tight, margin: 0, fontWeight: 600, color: palette.ink,
        }}>
          {slide.title}
        </h1>
        {tagline && (
          <p style={{
            fontFamily: t.fonts.body, fontSize: t.type.subhead,
            margin: "24px 0 0", maxWidth: 620, lineHeight: t.leading.relaxed,
            color: mix(palette.ink, palette.paper, 0.3),
          }}>
            {tagline}
          </p>
        )}
        <div style={{ height: 1, width: 180, background: palette.rule, marginTop: 36 }} />
      </div>
    );
  }

  if (style === "banded") {
    return (
      <>
        <div style={{ position: "absolute", left: 0, right: 0, top: 0, height: 86, background: palette.accent }} />
        <div style={{
          position: "absolute", left: t.grid.margin, right: t.grid.margin, top: 86, bottom: 0,
          display: "flex", flexDirection: "column", justifyContent: "center",
        }}>
          <span style={{
            fontFamily: t.fonts.label, fontSize: t.type.micro,
            color: palette.muted, marginBottom: 18,
          }}>
            {new Date().toLocaleDateString(undefined, { month: "long", year: "numeric" })}
          </span>
          <h1 style={{
            fontFamily: t.fonts.display, fontSize: t.type.display,
            lineHeight: t.leading.tight, margin: 0, fontWeight: 700,
            letterSpacing: "-0.025em", color: palette.ink,
          }}>
            {slide.title}
          </h1>
          <div style={{ height: 1, background: palette.rule, margin: "28px 0" }} />
          {tagline && (
            <p style={{
              fontFamily: t.fonts.body, fontSize: t.type.subhead,
              lineHeight: t.leading.normal, margin: 0, maxWidth: gridW(t, 8),
              color: mix(palette.ink, palette.paper, 0.25),
            }}>
              {tagline}
            </p>
          )}
        </div>
      </>
    );
  }

  if (style === "image-overlay") {
    const image = slide.image_data_url;
    return (
      <>
        {image ? (
          <img src={image} alt="" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }} />
        ) : (
          <div style={{ position: "absolute", inset: 0, background: palette.ink }} />
        )}
        <div style={{
          position: "absolute", inset: 0,
          background: `linear-gradient(105deg, ${palette.ink}f2 0%, ${palette.ink}bb 45%, ${palette.ink}44 100%)`,
        }} />
        <div style={{
          position: "absolute", left: t.grid.margin, right: t.grid.margin, top: 0, bottom: 0,
          display: "flex", flexDirection: "column", justifyContent: "center",
        }}>
          {logo && <img src={logo} alt="" style={{ height: 34, width: "auto", marginBottom: 36, alignSelf: "flex-start" }} />}
          <h1 style={{
            fontFamily: t.fonts.display, fontSize: t.type.display,
            lineHeight: t.leading.tight, margin: 0, fontWeight: 700,
            color: palette.inverse, maxWidth: gridW(t, 8), letterSpacing: "-0.02em",
          }}>
            {slide.title}
          </h1>
          {tagline && (
            <p style={{
              fontFamily: t.fonts.body, fontSize: t.type.subhead,
              lineHeight: t.leading.normal, margin: "26px 0 0", maxWidth: gridW(t, 6),
              color: mix(palette.inverse, palette.ink, 0.22),
            }}>
              {tagline}
            </p>
          )}
        </div>
      </>
    );
  }

  // ink-field (default)
  return (
    <div style={{
      position: "absolute", inset: 0, background: palette.ink, color: palette.inverse,
      padding: t.grid.margin, display: "flex", flexDirection: "column", justifyContent: "space-between",
    }}>
      <div>{logo && <img src={logo} alt="" style={{ height: 42, width: "auto" }} />}</div>
      <div style={{ maxWidth: gridW(t, 9) }}>
        <h1 style={{
          fontFamily: t.fonts.display, fontSize: t.type.display,
          lineHeight: t.leading.tight, margin: 0, fontWeight: 600, letterSpacing: "-0.02em",
        }}>
          {slide.title}
        </h1>
        {tagline && (
          <p style={{
            fontFamily: t.fonts.body, fontSize: t.type.subhead,
            lineHeight: t.leading.normal, margin: "24px 0 0",
            color: mix(palette.inverse, palette.ink, 0.28), maxWidth: gridW(t, 7),
          }}>
            {tagline}
          </p>
        )}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
        <span style={{ width: 56, height: 3, background: palette.accent }} />
        <span style={{ fontFamily: t.fonts.label, fontSize: t.type.micro, color: mix(palette.inverse, palette.ink, 0.45) }}>
          {new Date().toLocaleDateString(undefined, { month: "long", year: "numeric" })}
        </span>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */

function Statement(p: TemplatedSlideProps) {
  const { slide, template: t, palette } = p;
  const text = slide.blocks[0]?.text ?? "";
  const inverted = t.traits.invertsStatements;
  const bg = inverted ? palette.ink : palette.paper;
  const fg = inverted ? palette.inverse : palette.ink;
  const centered = t.traits.align === "centered";

  return (
    <>
      <div style={{ position: "absolute", inset: 0, background: bg }} />
      <div style={{
        position: "absolute", left: t.grid.margin, right: t.grid.margin, top: 0, bottom: 0,
        display: "flex", flexDirection: "column", justifyContent: "center",
        alignItems: centered ? "center" : "flex-start",
        textAlign: centered ? "center" : "left",
      }}>
        <span style={{
          fontFamily: t.fonts.label, fontSize: t.type.caption,
          color: inverted ? mix(palette.inverse, palette.ink, 0.5) : palette.muted,
          marginBottom: 18,
        }}>
          {slide.title}
        </span>
        <p style={{
          fontFamily: t.fonts.display,
          fontSize: text.length < 70 ? t.type.statement * 0.62 : t.type.headline * 1.12,
          lineHeight: t.leading.tight * 1.15, margin: 0, fontWeight: 600,
          letterSpacing: "-0.025em", color: fg, maxWidth: gridW(t, centered ? 10 : 9),
        }}>
          {text}
        </p>
      </div>
      {!inverted && <Sources blocks={slide.blocks} template={t} palette={palette} />}
      <Footer {...p} template={t} palette={palette} inverted={inverted} />
    </>
  );
}

function Argument(p: TemplatedSlideProps) {
  const { slide, template: t, palette } = p;
  const d = densityScale(t);
  const top = 92 * d;
  const centered = t.traits.align === "centered";
  const sideRail = t.traits.titlePlacement === "side-rail";
  const topFull = t.traits.titlePlacement === "top-full" || t.traits.titlePlacement === "top-rule";

  if (centered) {
    return (
      <>
        <div style={{ position: "absolute", left: t.grid.margin, right: t.grid.margin, top: top }}>
          <SlideTitle text={slide.title} template={t} palette={palette} />
          <div style={{ height: 1, background: palette.rule, margin: "28px auto", width: 200 }} />
          <div style={{ maxWidth: 760, margin: "0 auto" }}>
            {slide.blocks.map((b, i) => (
              <p key={i} style={{
                fontFamily: t.fonts.body,
                fontSize: i === 0 ? t.type.subhead : t.type.body,
                lineHeight: t.leading.relaxed, margin: "0 0 18px",
                color: i === 0 ? palette.ink : mix(palette.ink, palette.paper, 0.2),
                textAlign: "center",
              }}>
                {b.text}
              </p>
            ))}
          </div>
        </div>
        <Sources blocks={slide.blocks} template={t} palette={palette} />
        <Footer {...p} />
      </>
    );
  }

  if (topFull) {
    return (
      <>
        <div style={{ position: "absolute", left: t.grid.margin, right: t.grid.margin, top: top }}>
          <SlideTitle text={slide.title} template={t} palette={palette} maxSpan={9} />
          <Rule template={t} palette={palette} />
        </div>
        <div style={{
          position: "absolute", left: t.grid.margin, right: t.grid.margin, top: top + 120,
          columnCount: slide.blocks.length > 2 ? 2 : 1, columnGap: t.grid.gutter * 2,
        }}>
          {slide.blocks.map((b, i) => (
            <p key={i} style={{
              fontFamily: t.fonts.body,
              fontSize: i === 0 ? t.type.subhead : t.type.body,
              lineHeight: t.leading.relaxed, margin: "0 0 18px",
              color: i === 0 ? palette.ink : mix(palette.ink, palette.paper, 0.2),
              breakInside: "avoid",
            }}>
              {b.text}
            </p>
          ))}
        </div>
        <Sources blocks={slide.blocks} template={t} palette={palette} />
        <Footer {...p} />
      </>
    );
  }

  // left-column / side-rail
  const titleSpan = sideRail ? 3 : 4;
  const bodyStart = sideRail ? 4 : 5;
  return (
    <>
      <div style={{ position: "absolute", left: t.grid.margin, top, width: gridW(t, titleSpan) }}>
        <Rule template={t} palette={palette} />
        <SlideTitle text={slide.title} template={t} palette={palette} maxSpan={titleSpan} />
      </div>
      <div style={{
        position: "absolute", left: gridX(t, bodyStart), top,
        width: gridW(t, t.grid.columns - bodyStart), maxHeight: SLIDE_H - top - 110, overflow: "hidden",
      }}>
        {slide.blocks.map((b, i) => (
          <p key={i} style={{
            fontFamily: t.fonts.body,
            fontSize: i === 0 ? t.type.subhead : t.type.body,
            lineHeight: i === 0 ? t.leading.normal : t.leading.relaxed,
            margin: i === 0 ? "0 0 22px" : "0 0 18px",
            color: i === 0 ? palette.ink : mix(palette.ink, palette.paper, 0.2),
          }}>
            {b.text}
          </p>
        ))}
      </div>
      <Sources blocks={slide.blocks} template={t} palette={palette} />
      <Footer {...p} />
    </>
  );
}

function Points(p: TemplatedSlideProps) {
  const { slide, template: t, palette } = p;
  const d = densityScale(t);
  const style = t.traits.points;
  const items = slide.blocks.slice(0, style === "numbered-rows" ? 5 : 4);

  return (
    <>
      <div style={{
        position: "absolute", left: t.grid.margin, right: t.grid.margin, top: 88 * d,
        textAlign: t.traits.align === "centered" ? "center" : "left",
      }}>
        <SlideTitle text={slide.title} template={t} palette={palette} />
      </div>

      {style === "numbered-rows" ? (
        <div style={{ position: "absolute", left: t.grid.margin, right: t.grid.margin, top: 200 * d }}>
          {items.map((b, i) => (
            <div key={i} style={{
              display: "flex", gap: 28, alignItems: "baseline",
              padding: `${18 * d}px 0`, borderTop: `1px solid ${palette.rule}`,
            }}>
              <span style={{
                fontFamily: t.fonts.label, fontSize: t.type.caption, color: palette.accent,
                width: 34, flexShrink: 0, fontVariantNumeric: "tabular-nums",
              }}>
                {String(i + 1).padStart(2, "0")}
              </span>
              <p style={{
                fontFamily: t.fonts.body, fontSize: t.type.body,
                lineHeight: t.leading.relaxed, margin: 0, color: palette.ink,
              }}>
                {b.text}
              </p>
            </div>
          ))}
        </div>
      ) : style === "grid-cards" ? (
        <div style={{
          position: "absolute", left: t.grid.margin, right: t.grid.margin, top: 210 * d,
          display: "grid", gridTemplateColumns: `repeat(${Math.min(items.length, 2)}, 1fr)`,
          gap: t.grid.gutter * 1.5,
        }}>
          {items.map((b, i) => (
            <div key={i} style={{
              background: mix(palette.ink, palette.paper, 0.955),
              padding: 28, borderRadius: 2,
              borderLeft: `3px solid ${palette.accent}`,
            }}>
              <p style={{
                fontFamily: t.fonts.body, fontSize: t.type.body,
                lineHeight: t.leading.relaxed, margin: 0, color: palette.ink,
              }}>
                {b.text}
              </p>
            </div>
          ))}
        </div>
      ) : style === "stacked-rules" ? (
        <div style={{ position: "absolute", left: t.grid.margin, right: t.grid.margin, top: 220 * d }}>
          {items.map((b, i) => (
            <div key={i} style={{ marginBottom: 34 * d }}>
              <div style={{ height: 8, width: 64, background: palette.accent, marginBottom: 14 }} />
              <p style={{
                fontFamily: t.fonts.display, fontSize: t.type.subhead,
                lineHeight: t.leading.normal, margin: 0, color: palette.ink, maxWidth: gridW(t, 9),
              }}>
                {b.text}
              </p>
            </div>
          ))}
        </div>
      ) : (
        <div style={{
          position: "absolute", left: t.grid.margin, right: t.grid.margin, top: 224 * d,
          display: "grid", gridTemplateColumns: `repeat(${Math.min(items.length, 3)}, 1fr)`,
          gap: t.grid.gutter * 2,
        }}>
          {items.map((b, i) => (
            <div key={i}>
              <div style={{ height: 3, width: 40, background: palette.accent, marginBottom: 20 }} />
              <p style={{
                fontFamily: t.fonts.body, fontSize: t.type.body,
                lineHeight: t.leading.relaxed, margin: 0, color: palette.ink,
              }}>
                {b.text}
              </p>
            </div>
          ))}
        </div>
      )}

      <Sources blocks={slide.blocks} template={t} palette={palette} />
      <Footer {...p} />
    </>
  );
}

function Split(p: TemplatedSlideProps) {
  const { slide, template: t, palette } = p;
  const imageLeft = t.id === "modernist" || t.id === "narrative";
  const imageW = SLIDE_W * 0.44;

  return (
    <>
      <div style={{
        position: "absolute", top: 0, bottom: 0, width: imageW,
        [imageLeft ? "left" : "right"]: 0,
        background: mix(palette.ink, palette.paper, 0.93), overflow: "hidden",
      }}>
        {slide.image_data_url && (
          <img src={slide.image_data_url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
        )}
      </div>
      <div style={{
        position: "absolute", top: 0, bottom: 0,
        [imageLeft ? "right" : "left"]: t.grid.margin,
        width: SLIDE_W - imageW - t.grid.margin - 56,
        display: "flex", flexDirection: "column", justifyContent: "center",
      }}>
        <Rule template={t} palette={palette} />
        <SlideTitle text={slide.title} template={t} palette={palette} maxSpan={6} />
        <div style={{ marginTop: 22 }}>
          {slide.blocks.map((b, i) => (
            <p key={i} style={{
              fontFamily: t.fonts.body,
              fontSize: i === 0 ? t.type.subhead : t.type.body,
              lineHeight: t.leading.relaxed, margin: "0 0 16px",
              color: i === 0 ? palette.ink : mix(palette.ink, palette.paper, 0.22),
            }}>
              {b.text}
            </p>
          ))}
        </div>
      </div>
      <Footer {...p} />
    </>
  );
}

function Team(p: TemplatedSlideProps) {
  const { slide, template: t, palette } = p;
  const members = (slide.team_members ?? []).slice(0, 4);
  const cols = Math.min(members.length || 1, 4);
  const shape = t.traits.portraits;

  const portraitStyle: CSSProperties =
    shape === "circle"
      ? { borderRadius: "50%", aspectRatio: "1 / 1" }
      : shape === "tall"
        ? { aspectRatio: "3 / 4" }
        : { aspectRatio: "1 / 1" };

  return (
    <>
      <div style={{
        position: "absolute", left: t.grid.margin, right: t.grid.margin, top: 86,
        textAlign: t.traits.align === "centered" ? "center" : "left",
      }}>
        <SlideTitle text={slide.title} template={t} palette={palette} />
      </div>
      <div style={{
        position: "absolute", left: t.grid.margin, right: t.grid.margin, top: 200,
        display: "grid", gridTemplateColumns: `repeat(${cols}, 1fr)`, gap: t.grid.gutter * 1.6,
        textAlign: t.traits.align === "centered" ? "center" : "left",
      }}>
        {members.map((m, i) => (
          <div key={i}>
            {m.photo_data_url ? (
              <img src={m.photo_data_url} alt={m.name} style={{
                width: "100%", objectFit: "cover", marginBottom: 16,
                filter: shape === "duotone" ? "grayscale(1) contrast(1.15)" : "grayscale(0.2)",
                ...portraitStyle,
              }} />
            ) : (
              <div style={{
                width: "100%", marginBottom: 16, ...portraitStyle,
                background: mix(palette.ink, palette.paper, 0.9),
                display: "flex", alignItems: "center", justifyContent: "center",
                fontFamily: t.fonts.display, fontSize: 32, color: palette.muted,
              }}>
                {m.name.split(" ").map((x) => x[0]).slice(0, 2).join("")}
              </div>
            )}
            {t.traits.rule !== "none" && (
              <div style={{
                height: 2, width: 26, background: palette.accent, marginBottom: 10,
                marginLeft: t.traits.align === "centered" ? "auto" : 0,
                marginRight: t.traits.align === "centered" ? "auto" : 0,
              }} />
            )}
            <div style={{ fontFamily: t.fonts.display, fontSize: 20, fontWeight: 600, marginBottom: 2, color: palette.ink }}>
              {m.name}
            </div>
            <div style={{ fontFamily: t.fonts.label, fontSize: t.type.caption, color: palette.accent, marginBottom: 9 }}>
              {m.role}
            </div>
            <p style={{
              fontFamily: t.fonts.body, fontSize: 14.5, lineHeight: t.leading.normal,
              margin: 0, color: mix(palette.ink, palette.paper, 0.27),
            }}>
              {m.bio}
            </p>
          </div>
        ))}
      </div>
      <Footer {...p} />
    </>
  );
}

function Contents(p: TemplatedSlideProps) {
  const { slide, template: t, palette } = p;
  const entries = slide.toc_entries ?? [];
  const half = Math.ceil(entries.length / 2);
  const cols = entries.length > 7 ? [entries.slice(0, half), entries.slice(half)] : [entries];

  return (
    <>
      <div style={{
        position: "absolute", left: t.grid.margin, right: t.grid.margin, top: 90,
        textAlign: t.traits.align === "centered" ? "center" : "left",
      }}>
        <SlideTitle text={slide.title} template={t} palette={palette} />
      </div>
      <div style={{
        position: "absolute", left: t.grid.margin, right: t.grid.margin, top: 200,
        display: "grid", gridTemplateColumns: `repeat(${cols.length}, 1fr)`, gap: t.grid.gutter * 3,
      }}>
        {cols.map((col, ci) => (
          <div key={ci}>
            {col.map((entry, i) => (
              <div key={i} style={{
                display: "flex", alignItems: "baseline", gap: 16,
                padding: "13px 0", borderBottom: `1px solid ${palette.rule}`,
              }}>
                <span style={{
                  fontFamily: t.fonts.label, fontSize: t.type.micro, color: palette.accent,
                  width: 22, fontVariantNumeric: "tabular-nums",
                }}>
                  {String(ci * half + i + 3).padStart(2, "0")}
                </span>
                <span style={{ fontFamily: t.fonts.body, fontSize: t.type.body, flex: 1, color: palette.ink }}>
                  {entry.title}
                </span>
              </div>
            ))}
          </div>
        ))}
      </div>
      <Footer {...p} />
    </>
  );
}

function Chart(p: TemplatedSlideProps) {
  const { slide, template: t, palette, chartNode } = p;
  const note = slide.blocks[0]?.text;

  return (
    <>
      <div style={{ position: "absolute", left: t.grid.margin, right: t.grid.margin, top: 64 }}>
        <h2 style={{
          fontFamily: t.fonts.display, fontSize: t.type.headline * 0.82,
          lineHeight: 1.2, margin: 0, fontWeight: 600, color: palette.ink,
        }}>
          {slide.title}
        </h2>
        {t.traits.rule === "hairline-full" && (
          <div style={{ height: 1, background: palette.rule, marginTop: 18 }} />
        )}
      </div>
      <div style={{
        position: "absolute", left: t.grid.margin, right: t.grid.margin,
        top: 140, bottom: note ? 150 : 92,
        display: "flex", alignItems: "center", justifyContent: "center",
      }}>
        <div style={{ width: "100%" }}>{chartNode}</div>
      </div>
      {note && (
        <p style={{
          position: "absolute", left: t.grid.margin, right: t.grid.margin, bottom: 78,
          fontFamily: t.fonts.body, fontSize: t.type.caption,
          lineHeight: t.leading.normal, margin: 0, maxWidth: gridW(t, 9),
          color: mix(palette.ink, palette.paper, 0.28),
          borderLeft: `2px solid ${palette.accent}`, paddingLeft: 14,
        }}>
          {note}
        </p>
      )}
      <Footer {...p} />
    </>
  );
}

function FullImage(p: TemplatedSlideProps) {
  const { slide, template: t, palette } = p;
  return (
    <>
      {slide.image_data_url && (
        <img src={slide.image_data_url} alt={slide.title}
          style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }} />
      )}
      <div style={{
        position: "absolute", left: 0, right: 0, bottom: 0, height: 230,
        background: `linear-gradient(to top, ${palette.ink}ee, transparent)`,
      }} />
      <div style={{ position: "absolute", left: t.grid.margin, bottom: 74 }}>
        {t.traits.rule !== "none" && (
          <div style={{ height: 3, width: 44, background: palette.accent, marginBottom: 16 }} />
        )}
        <h2 style={{
          fontFamily: t.fonts.display, fontSize: t.type.headline * 0.88,
          margin: 0, color: palette.inverse, fontWeight: 600,
        }}>
          {slide.title}
        </h2>
      </div>
      <Footer {...p} inverted />
    </>
  );
}
