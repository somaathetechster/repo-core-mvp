/**
 * Renders a slide's typed content blocks as a single self-contained card.
 *
 * Every block type (stat / comparison / timeline / logos / chips / quote /
 * bars) is drawn from a palette resolved against the active deck theme AND the
 * slide's own background. On a light (paper) canvas the card is a light panel
 * with ink text and accent figures; on a dark (ink) canvas — Obsidian's
 * near-black ground, Brutus's inverted pages, Herald's forest slides — it
 * becomes a subtle light-on-dark panel so the block never renders as a white
 * card stranded on a black slide. A slide with no blocks never mounts this.
 *
 * Styles are inline (rather than a stylesheet) so the card exports faithfully
 * through html2canvas, which doesn't see external CSS reliably.
 */
import type { CSSProperties } from "react";
import type { ContentBlock, StatBlock } from "./elements";
import { luminance, type DeckTheme } from "./theme";

/** The slide's background keyword/colour, as carried on ElementSlide.background. */
type SlideBackground = "paper" | "ink" | "accent" | (string & {}) | null | undefined;

/** The resolved colours a block card paints with, derived once per render. */
interface BlockPalette {
  dark: boolean;
  surface: string;   // card background
  border: string;    // card + cell borders
  text: string;      // strong text
  muted: string;     // secondary text
  accent: string;    // stat figures, bar fill, rules, chip roles
  headerBg: string;  // comparison table header fill
  track: string;     // bar track
}

/**
 * Whether the slide this card sits on has a dark canvas.
 *
 * The slide's `background` token is the reliable signal: composers declare
 * "ink" for their dark grounds and "paper" for light ones. We trust the token
 * rather than resolving it through the theme, because a dark template can carry
 * an inverted palette (Obsidian's `paper` is itself near-black), which would
 * make a luminance test on the resolved colour point the wrong way. For an
 * "accent" or a literal colour we fall back to a luminance check.
 */
function isDarkCanvas(bg: SlideBackground, theme: DeckTheme): boolean {
  if (!bg || bg === "paper") return false;
  if (bg === "ink") return true;
  const color = bg === "accent" ? theme.accent : bg;
  return luminance(color) < 0.4;
}

function makePalette(theme: DeckTheme, bg: SlideBackground): BlockPalette {
  if (isDarkCanvas(bg, theme)) {
    return {
      dark: true,
      surface: "rgba(255,255,255,0.08)",
      border: "rgba(255,255,255,0.12)",
      text: "#ffffff",
      muted: "rgba(255,255,255,0.7)",
      accent: theme.accent,
      headerBg: "rgba(255,255,255,0.12)",
      track: "rgba(255,255,255,0.1)",
    };
  }
  return {
    dark: false,
    surface: theme.paper,
    border: theme.rule,
    text: theme.ink,
    muted: theme.muted,
    accent: theme.accent,
    headerBg: theme.accentSoft,
    track: theme.accentSoft,
  };
}

export default function SlideBlocks({
  blocks,
  theme,
  slideBackground,
}: {
  blocks: ContentBlock[];
  theme: DeckTheme;
  /** The host slide's background, so the card can adapt to a dark canvas. */
  slideBackground?: SlideBackground;
}) {
  const pal = makePalette(theme, slideBackground);
  const card: CSSProperties = {
    width: "100%",
    height: "100%",
    boxSizing: "border-box",
    background: pal.surface,
    border: `1px solid ${pal.border}`,
    borderRadius: 10,
    padding: 22,
    color: pal.text,
    fontFamily: theme.fonts.body,
    overflow: "hidden",
    display: "flex",
    flexDirection: "column",
    gap: 16,
  };

  // Consecutive stat blocks render together as one wrapping row.
  const groups: ContentBlock[][] = [];
  for (const b of blocks) {
    const last = groups[groups.length - 1];
    if (b.type === "stat" && last && last[0]?.type === "stat") last.push(b);
    else groups.push([b]);
  }

  return (
    <div style={card}>
      {groups.map((group, i) =>
        group[0].type === "stat"
          ? <StatRow key={i} stats={group as StatBlock[]} theme={theme} pal={pal} />
          : <BlockView key={i} block={group[0]} theme={theme} pal={pal} />,
      )}
    </div>
  );
}

function StatRow({ stats, theme, pal }: { stats: StatBlock[]; theme: DeckTheme; pal: BlockPalette }) {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 28, alignItems: "flex-end" }}>
      {stats.map((s, i) => (
        <div key={i} style={{ minWidth: 120 }}>
          <div style={{ fontFamily: theme.fonts.display, fontSize: 46, fontWeight: 700, lineHeight: 1, color: pal.accent, letterSpacing: "-0.02em" }}>
            {s.value}
          </div>
          <div style={{ fontSize: 14, marginTop: 6, color: pal.text }}>{s.label}</div>
          {s.sublabel && <div style={{ fontSize: 11.5, marginTop: 2, color: pal.muted }}>{s.sublabel}</div>}
        </div>
      ))}
    </div>
  );
}

function BlockView({ block, theme, pal }: { block: ContentBlock; theme: DeckTheme; pal: BlockPalette }) {
  const label: CSSProperties = { fontFamily: theme.fonts.label, fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", color: pal.muted };

  switch (block.type) {
    case "comparison": {
      const cell: CSSProperties = { padding: "7px 12px", fontSize: 13.5, borderBottom: `1px solid ${pal.border}`, textAlign: "left" };
      return (
        <table style={{ width: "100%", borderCollapse: "collapse", color: pal.text }}>
          <thead>
            <tr>
              {block.columns.map((c, i) => (
                <th key={i} style={{ ...cell, fontFamily: theme.fonts.label, fontSize: 12, fontWeight: 700, color: pal.dark ? pal.text : (i === 0 ? pal.muted : pal.text), background: pal.headerBg }}>
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {block.rows.map((row, ri) => (
              <tr key={ri}>
                {row.cells.map((c, ci) => (
                  <td key={ci} style={{ ...cell, fontWeight: ci === 0 ? 600 : 400, color: ci === 0 ? pal.text : pal.muted }}>{c}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      );
    }

    case "timeline":
      return (
        <div style={{ display: "flex", gap: 20, flexWrap: "wrap" }}>
          {block.items.map((it, i) => (
            <div key={i} style={{ flex: "1 1 160px", minWidth: 150, borderTop: `2px solid ${pal.accent}`, paddingTop: 10 }}>
              <div style={{ fontFamily: theme.fonts.label, fontSize: 13, fontWeight: 700, color: pal.accent }}>{it.period}</div>
              <ul style={{ margin: "8px 0 0", paddingLeft: 16, color: pal.muted, fontSize: 13, lineHeight: 1.5 }}>
                {it.points.map((p, pi) => <li key={pi}>{p}</li>)}
              </ul>
            </div>
          ))}
        </div>
      );

    case "logos":
      return (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
          {block.items.map((it, i) => (
            <div key={i} style={{ border: `1px solid ${pal.border}`, borderRadius: 999, padding: "8px 16px", display: "flex", gap: 8, alignItems: "baseline" }}>
              <span style={{ fontWeight: 600, fontSize: 14, color: pal.text }}>{it.name}</span>
              {it.note && <span style={{ fontSize: 11.5, color: pal.muted }}>{it.note}</span>}
            </div>
          ))}
        </div>
      );

    case "chips":
      return (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(190px, 1fr))", gap: 12 }}>
          {block.items.map((it, i) => (
            <div key={i} style={{ border: `1px solid ${pal.border}`, borderRadius: 8, padding: "10px 14px" }}>
              <div style={{ fontFamily: theme.fonts.display, fontWeight: 600, fontSize: 15, color: pal.text }}>{it.name}</div>
              {it.role && <div style={{ fontFamily: theme.fonts.label, fontSize: 12, color: pal.accent, marginTop: 2 }}>{it.role}</div>}
              {it.note && <div style={{ fontSize: 12, color: pal.muted, marginTop: 4, lineHeight: 1.4 }}>{it.note}</div>}
            </div>
          ))}
        </div>
      );

    case "quote":
      return (
        <blockquote style={{ margin: 0, borderLeft: `3px solid ${pal.accent}`, paddingLeft: 16 }}>
          <div style={{ fontFamily: theme.fonts.display, fontSize: 20, lineHeight: 1.4, color: pal.text }}>“{block.text}”</div>
          <div style={{ ...label, marginTop: 10, textTransform: "none", letterSpacing: "normal", fontSize: 12.5 }}>
            <span style={{ color: pal.text, fontWeight: 600 }}>{block.author}</span>
            {block.role && <span style={{ color: pal.muted }}>{` — ${block.role}`}</span>}
          </div>
        </blockquote>
      );

    case "bars": {
      const max = Math.max(...block.items.map((it) => it.max ?? it.value), 1);
      return (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {block.items.map((it, i) => {
            const pct = Math.max(0, Math.min(100, ((it.value ?? 0) / (it.max ?? (max || 1))) * 100));
            return (
              <div key={i}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, color: pal.text, marginBottom: 4 }}>
                  <span>{it.label}</span>
                  <span style={{ color: pal.muted }}>{it.value}{it.max ? ` / ${it.max}` : ""}</span>
                </div>
                <div style={{ height: 9, background: pal.track, borderRadius: 999, overflow: "hidden" }}>
                  <div style={{ width: `${pct}%`, height: "100%", background: pal.accent, borderRadius: 999 }} />
                </div>
              </div>
            );
          })}
        </div>
      );
    }

    default:
      return null;
  }
}
