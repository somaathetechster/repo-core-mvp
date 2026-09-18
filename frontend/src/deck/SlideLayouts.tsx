import type { CSSProperties, ReactNode } from "react";
import {
  SLIDE_W, SLIDE_H, GRID, DECK_TYPE, DECK_LEADING,
  FONT_SETS, type DeckPalette, type SlideLayout, extractLeadStat, mix,
} from "./design";

export interface SlideContent {
  id: string;
  type: string;
  title: string;
  blocks: { text: string; source: string }[];
  image_data_url: string | null;
  team_members: { name: string; role: string; bio: string; photo_data_url: string; linkedin_url: string }[] | null;
  toc_entries: { title: string }[] | null;
  chart?: { chart_type: string; columns: string[]; rows: string[][] };
}

export interface SlideRenderProps {
  slide: SlideContent;
  layout: SlideLayout;
  palette: DeckPalette;
  fontSet: keyof typeof FONT_SETS;
  logo?: string | null;
  companyName?: string;
  pageNumber?: number;
  totalPages?: number;
  showSources?: boolean;
  chartNode?: ReactNode;
}

/* ------------------------------------------------------------------ */
/* Shared pieces                                                       */
/* ------------------------------------------------------------------ */

function Eyebrow({ text, palette, fonts }: { text: string; palette: DeckPalette; fonts: typeof FONT_SETS.serif }) {
  // A thin rule paired with the label, rather than a tracked-out all-caps
  // eyebrow. The rule carries the structural role; the word stays quiet.
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 20 }}>
      <span style={{ width: 34, height: 2, background: palette.accent, flexShrink: 0 }} />
      <span style={{
        fontFamily: fonts.label, fontSize: DECK_TYPE.caption,
        color: palette.muted, letterSpacing: "0.01em",
      }}>
        {text}
      </span>
    </div>
  );
}

function Footer({
  palette, fonts, companyName, pageNumber, totalPages, logo,
}: {
  palette: DeckPalette; fonts: typeof FONT_SETS.serif;
  companyName?: string; pageNumber?: number; totalPages?: number; logo?: string | null;
}) {
  return (
    <div style={{
      position: "absolute", left: GRID.margin, right: GRID.margin, bottom: 40,
      display: "flex", alignItems: "center", justifyContent: "space-between",
      fontFamily: fonts.label, fontSize: DECK_TYPE.micro, color: palette.muted,
    }}>
      <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
        {logo && <img src={logo} alt="" style={{ height: 16, width: "auto", opacity: 0.75 }} />}
        {companyName}
      </span>
      {pageNumber !== undefined && (
        <span style={{ fontVariantNumeric: "tabular-nums" }}>
          {pageNumber}{totalPages ? ` / ${totalPages}` : ""}
        </span>
      )}
    </div>
  );
}

function Sources({ blocks, palette, fonts }: { blocks: { source: string }[]; palette: DeckPalette; fonts: typeof FONT_SETS.serif }) {
  const unique = [...new Set(blocks.map((b) => b.source).filter(Boolean))];
  if (unique.length === 0) return null;
  return (
    <div style={{
      position: "absolute", left: GRID.margin, bottom: 72, right: GRID.margin,
      fontFamily: fonts.label, fontSize: DECK_TYPE.micro,
      color: mix(palette.muted, palette.paper, 0.3), lineHeight: 1.5,
    }}>
      {unique.join(" · ")}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* The slide                                                           */
/* ------------------------------------------------------------------ */

export default function Slide(props: SlideRenderProps) {
  const { palette, fontSet } = props;
  const fonts = FONT_SETS[fontSet] ?? FONT_SETS.serif;

  const frame: CSSProperties = {
    position: "relative",
    width: SLIDE_W,
    height: SLIDE_H,
    background: palette.paper,
    color: palette.ink,
    overflow: "hidden",
  };

  return <div style={frame}>{renderLayout(props, fonts)}</div>;
}

function renderLayout(props: SlideRenderProps, fonts: typeof FONT_SETS.serif) {
  switch (props.layout) {
    case "cover": return <CoverLayout {...props} fonts={fonts} />;
    case "statement": return <StatementLayout {...props} fonts={fonts} />;
    case "points": return <PointsLayout {...props} fonts={fonts} />;
    case "split": return <SplitLayout {...props} fonts={fonts} />;
    case "team": return <TeamLayout {...props} fonts={fonts} />;
    case "contents": return <ContentsLayout {...props} fonts={fonts} />;
    case "chart": return <ChartLayout {...props} fonts={fonts} />;
    case "image": return <ImageLayout {...props} fonts={fonts} />;
    default: return <ArgumentLayout {...props} fonts={fonts} />;
  }
}

type L = SlideRenderProps & { fonts: typeof FONT_SETS.serif };

/* Cover: ink field, generous silence, the name carried large ---------- */

function CoverLayout({ slide, palette, fonts, logo }: L) {
  const tagline = slide.blocks[0]?.text;
  return (
    <div style={{
      position: "absolute", inset: 0, background: palette.ink, color: palette.inverse,
      padding: GRID.margin, display: "flex", flexDirection: "column", justifyContent: "space-between",
    }}>
      <div>
        {(logo || slide.image_data_url) && (
          <img
            src={logo || slide.image_data_url || ""}
            alt=""
            style={{ height: 44, width: "auto", objectFit: "contain" }}
          />
        )}
      </div>

      <div style={{ maxWidth: GRID.column(9) }}>
        <h1 style={{
          fontFamily: fonts.display, fontSize: DECK_TYPE.display,
          lineHeight: DECK_LEADING.display, fontWeight: 600, margin: 0,
          letterSpacing: "-0.02em",
        }}>
          {slide.title}
        </h1>
        {tagline && (
          <p style={{
            fontFamily: fonts.body, fontSize: DECK_TYPE.subhead,
            lineHeight: DECK_LEADING.subhead, margin: "24px 0 0",
            color: mix(palette.inverse, palette.ink, 0.28), maxWidth: GRID.column(7),
          }}>
            {tagline}
          </p>
        )}
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
        <span style={{ width: 56, height: 3, background: palette.accent }} />
        <span style={{ fontFamily: fonts.label, fontSize: DECK_TYPE.micro, color: mix(palette.inverse, palette.ink, 0.45) }}>
          {new Date().toLocaleDateString(undefined, { month: "long", year: "numeric" })}
        </span>
      </div>
    </div>
  );
}

/* Statement: one line, held large, everything else silent ------------ */

function StatementLayout({ slide, palette, fonts, ...rest }: L) {
  const text = slide.blocks[0]?.text ?? "";
  const stat = extractLeadStat(text);

  return (
    <>
      <div style={{
        position: "absolute", left: GRID.margin, right: GRID.margin,
        top: 0, bottom: 0, display: "flex", flexDirection: "column", justifyContent: "center",
      }}>
        <Eyebrow text={slide.title} palette={palette} fonts={fonts} />
        {stat ? (
          <>
            <div style={{
              fontFamily: fonts.display, fontSize: DECK_TYPE.statement,
              lineHeight: DECK_LEADING.statement, color: palette.accent,
              fontWeight: 600, letterSpacing: "-0.03em", fontVariantNumeric: "tabular-nums",
            }}>
              {stat.value}
            </div>
            <p style={{
              fontFamily: fonts.body, fontSize: DECK_TYPE.subhead,
              lineHeight: DECK_LEADING.subhead, margin: "28px 0 0",
              maxWidth: GRID.column(8), color: palette.ink,
            }}>
              {text}
            </p>
          </>
        ) : (
          <p style={{
            fontFamily: fonts.display, fontSize: 46, lineHeight: 1.22,
            margin: 0, maxWidth: GRID.column(9), fontWeight: 500, letterSpacing: "-0.015em",
          }}>
            {text}
          </p>
        )}
      </div>
      <Sources blocks={slide.blocks} palette={palette} fonts={fonts} />
      <Footer palette={palette} fonts={fonts} {...rest} />
    </>
  );
}

/* Argument: an editorial column, headline anchored left -------------- */

function ArgumentLayout({ slide, palette, fonts, ...rest }: L) {
  return (
    <>
      <div style={{ position: "absolute", left: GRID.margin, top: 92, width: GRID.column(4) }}>
        <Eyebrow text="" palette={palette} fonts={fonts} />
        <h2 style={{
          fontFamily: fonts.display, fontSize: DECK_TYPE.headline,
          lineHeight: DECK_LEADING.headline, margin: 0, fontWeight: 600, letterSpacing: "-0.015em",
        }}>
          {slide.title}
        </h2>
      </div>

      <div style={{
        position: "absolute", left: GRID.x(5), top: 92, width: GRID.column(7),
        maxHeight: SLIDE_H - 200, overflow: "hidden",
      }}>
        {slide.blocks.map((b, i) => (
          <p key={i} style={{
            fontFamily: fonts.body,
            fontSize: i === 0 ? DECK_TYPE.subhead : DECK_TYPE.body,
            lineHeight: i === 0 ? DECK_LEADING.subhead : DECK_LEADING.body,
            margin: i === 0 ? "0 0 22px" : "0 0 18px",
            color: i === 0 ? palette.ink : mix(palette.ink, palette.paper, 0.18),
          }}>
            {b.text}
          </p>
        ))}
      </div>

      <Sources blocks={slide.blocks} palette={palette} fonts={fonts} />
      <Footer palette={palette} fonts={fonts} {...rest} />
    </>
  );
}

/* Points: enumerated supporting arguments ---------------------------- */

function PointsLayout({ slide, palette, fonts, ...rest }: L) {
  const points = slide.blocks.slice(0, 4);
  return (
    <>
      <div style={{ position: "absolute", left: GRID.margin, right: GRID.margin, top: 88 }}>
        <h2 style={{
          fontFamily: fonts.display, fontSize: DECK_TYPE.headline,
          lineHeight: DECK_LEADING.headline, margin: 0, fontWeight: 600,
          maxWidth: GRID.column(8), letterSpacing: "-0.015em",
        }}>
          {slide.title}
        </h2>
      </div>

      <div style={{
        position: "absolute", left: GRID.margin, right: GRID.margin, top: 224,
        display: "grid",
        gridTemplateColumns: `repeat(${Math.min(points.length, 3)}, 1fr)`,
        gap: GRID.gutter * 2,
      }}>
        {points.map((b, i) => (
          <div key={i}>
            {/* A rule above each column, not a numbered badge. The columns
                are parallel points, not an ordered sequence. */}
            <div style={{ height: 2, background: palette.accent, marginBottom: 20, width: 40 }} />
            <p style={{
              fontFamily: fonts.body, fontSize: DECK_TYPE.body,
              lineHeight: DECK_LEADING.body, margin: 0, color: palette.ink,
            }}>
              {b.text}
            </p>
          </div>
        ))}
      </div>

      <Sources blocks={slide.blocks} palette={palette} fonts={fonts} />
      <Footer palette={palette} fonts={fonts} {...rest} />
    </>
  );
}

/* Split: image and argument side by side ----------------------------- */

function SplitLayout({ slide, palette, fonts, ...rest }: L) {
  return (
    <>
      <div style={{
        position: "absolute", right: 0, top: 0, bottom: 0, width: SLIDE_W * 0.44,
        background: mix(palette.ink, palette.paper, 0.92), overflow: "hidden",
      }}>
        {slide.image_data_url && (
          <img
            src={slide.image_data_url} alt=""
            style={{ width: "100%", height: "100%", objectFit: "cover" }}
          />
        )}
      </div>

      <div style={{
        position: "absolute", left: GRID.margin, top: 0, bottom: 0,
        width: SLIDE_W * 0.56 - GRID.margin - 48,
        display: "flex", flexDirection: "column", justifyContent: "center",
      }}>
        <Eyebrow text={slide.title} palette={palette} fonts={fonts} />
        {slide.blocks.map((b, i) => (
          <p key={i} style={{
            fontFamily: fonts.body,
            fontSize: i === 0 ? DECK_TYPE.subhead : DECK_TYPE.body,
            lineHeight: i === 0 ? DECK_LEADING.subhead : DECK_LEADING.body,
            margin: i === 0 ? "0 0 18px" : "0 0 14px",
            color: i === 0 ? palette.ink : mix(palette.ink, palette.paper, 0.2),
          }}>
            {b.text}
          </p>
        ))}
      </div>

      <Footer palette={palette} fonts={fonts} {...rest} />
    </>
  );
}

/* Team: portraits with credibility, not a directory listing ---------- */

function TeamLayout({ slide, palette, fonts, ...rest }: L) {
  const members = (slide.team_members ?? []).slice(0, 4);
  const cols = Math.min(members.length || 1, 4);

  return (
    <>
      <div style={{ position: "absolute", left: GRID.margin, top: 88 }}>
        <h2 style={{
          fontFamily: fonts.display, fontSize: DECK_TYPE.headline,
          lineHeight: DECK_LEADING.headline, margin: 0, fontWeight: 600, letterSpacing: "-0.015em",
        }}>
          {slide.title}
        </h2>
      </div>

      <div style={{
        position: "absolute", left: GRID.margin, right: GRID.margin, top: 210,
        display: "grid", gridTemplateColumns: `repeat(${cols}, 1fr)`, gap: GRID.gutter * 1.6,
      }}>
        {members.map((m, i) => (
          <div key={i}>
            {m.photo_data_url ? (
              <img
                src={m.photo_data_url} alt={m.name}
                style={{
                  width: "100%", aspectRatio: "1 / 1", objectFit: "cover",
                  filter: "grayscale(0.25)", marginBottom: 18,
                }}
              />
            ) : (
              <div style={{
                width: "100%", aspectRatio: "1 / 1", marginBottom: 18,
                background: mix(palette.ink, palette.paper, 0.9),
                display: "flex", alignItems: "center", justifyContent: "center",
                fontFamily: fonts.display, fontSize: 34, color: palette.muted,
              }}>
                {m.name.split(" ").map((p) => p[0]).slice(0, 2).join("")}
              </div>
            )}
            <div style={{ height: 2, width: 28, background: palette.accent, marginBottom: 12 }} />
            <div style={{ fontFamily: fonts.display, fontSize: 21, fontWeight: 600, marginBottom: 3 }}>
              {m.name}
            </div>
            <div style={{ fontFamily: fonts.label, fontSize: DECK_TYPE.caption, color: palette.accent, marginBottom: 10 }}>
              {m.role}
            </div>
            <p style={{
              fontFamily: fonts.body, fontSize: 15, lineHeight: 1.5,
              margin: 0, color: mix(palette.ink, palette.paper, 0.25),
            }}>
              {m.bio}
            </p>
          </div>
        ))}
      </div>

      <Footer palette={palette} fonts={fonts} {...rest} />
    </>
  );
}

/* Contents ----------------------------------------------------------- */

function ContentsLayout({ slide, palette, fonts, ...rest }: L) {
  const entries = slide.toc_entries ?? [];
  const half = Math.ceil(entries.length / 2);
  const columns = entries.length > 7 ? [entries.slice(0, half), entries.slice(half)] : [entries];

  return (
    <>
      <div style={{ position: "absolute", left: GRID.margin, top: 92 }}>
        <h2 style={{
          fontFamily: fonts.display, fontSize: DECK_TYPE.headline,
          lineHeight: DECK_LEADING.headline, margin: 0, fontWeight: 600,
        }}>
          {slide.title}
        </h2>
      </div>

      <div style={{
        position: "absolute", left: GRID.margin, right: GRID.margin, top: 210,
        display: "grid", gridTemplateColumns: `repeat(${columns.length}, 1fr)`, gap: GRID.gutter * 3,
      }}>
        {columns.map((col, ci) => (
          <div key={ci}>
            {col.map((entry, i) => {
              const index = ci * half + i;
              return (
                <div key={i} style={{
                  display: "flex", alignItems: "baseline", gap: 16,
                  padding: "14px 0", borderBottom: `1px solid ${palette.rule}`,
                }}>
                  <span style={{
                    fontFamily: fonts.label, fontSize: DECK_TYPE.micro,
                    color: palette.muted, width: 22, fontVariantNumeric: "tabular-nums",
                  }}>
                    {String(index + 3).padStart(2, "0")}
                  </span>
                  <span style={{ fontFamily: fonts.body, fontSize: DECK_TYPE.body, flex: 1 }}>
                    {entry.title}
                  </span>
                </div>
              );
            })}
          </div>
        ))}
      </div>

      <Footer palette={palette} fonts={fonts} {...rest} />
    </>
  );
}

/* Chart: the visual gets the room, the caption stays tight ----------- */

function ChartLayout({ slide, palette, fonts, chartNode, ...rest }: L) {
  return (
    <>
      <div style={{ position: "absolute", left: GRID.margin, top: 72, right: GRID.margin }}>
        <h2 style={{
          fontFamily: fonts.display, fontSize: 32, lineHeight: 1.2,
          margin: 0, fontWeight: 600, letterSpacing: "-0.01em",
        }}>
          {slide.title}
        </h2>
      </div>

      <div style={{
        position: "absolute", left: GRID.margin, right: GRID.margin, top: 150, bottom: 96,
        display: "flex", alignItems: "center", justifyContent: "center",
      }}>
        <div style={{ width: "100%", maxHeight: "100%" }}>
          {chartNode ?? (
            <div style={{
              fontFamily: fonts.label, fontSize: DECK_TYPE.caption,
              color: palette.muted, textAlign: "center", fontStyle: "italic",
            }}>
              Chart data unavailable.
            </div>
          )}
        </div>
      </div>

      <Footer palette={palette} fonts={fonts} {...rest} />
    </>
  );
}

/* Image: full bleed, caption overlaid on a scrim --------------------- */

function ImageLayout({ slide, palette, fonts, ...rest }: L) {
  return (
    <>
      {slide.image_data_url && (
        <img
          src={slide.image_data_url} alt={slide.title}
          style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }}
        />
      )}
      <div style={{
        position: "absolute", left: 0, right: 0, bottom: 0, height: 220,
        background: `linear-gradient(to top, ${palette.ink}ee, transparent)`,
      }} />
      <div style={{ position: "absolute", left: GRID.margin, bottom: 76 }}>
        <div style={{ height: 2, width: 40, background: palette.accent, marginBottom: 16 }} />
        <h2 style={{
          fontFamily: fonts.display, fontSize: 34, margin: 0,
          color: palette.inverse, fontWeight: 600,
        }}>
          {slide.title}
        </h2>
      </div>
      <Footer palette={{ ...palette, muted: mix(palette.inverse, palette.ink, 0.4) }} fonts={fonts} {...rest} />
    </>
  );
}
