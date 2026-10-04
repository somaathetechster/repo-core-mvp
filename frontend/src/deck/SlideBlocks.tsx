/**
 * Renders a slide's typed content blocks as a single self-contained card.
 *
 * Every block type (stat / comparison / timeline / logos / chips / quote /
 * bars) is drawn with values resolved from the active deck theme, so the card
 * inherits whatever template and palette are live without per-template code.
 * Styling is deliberately clean and neutral here — the richer per-template
 * treatment comes in the next build. A slide with no blocks never mounts this.
 *
 * Styles are inline (rather than a stylesheet) so the card exports faithfully
 * through html2canvas, which doesn't see external CSS reliably.
 */
import type { CSSProperties } from "react";
import type { ContentBlock, StatBlock } from "./elements";
import type { DeckTheme } from "./theme";

export default function SlideBlocks({ blocks, theme }: { blocks: ContentBlock[]; theme: DeckTheme }) {
  const card: CSSProperties = {
    width: "100%",
    height: "100%",
    boxSizing: "border-box",
    background: theme.paper,
    border: `1px solid ${theme.rule}`,
    borderRadius: 10,
    padding: 22,
    color: theme.ink,
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
          ? <StatRow key={i} stats={group as StatBlock[]} theme={theme} />
          : <BlockView key={i} block={group[0]} theme={theme} />,
      )}
    </div>
  );
}

function StatRow({ stats, theme }: { stats: StatBlock[]; theme: DeckTheme }) {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 28, alignItems: "flex-end" }}>
      {stats.map((s, i) => (
        <div key={i} style={{ minWidth: 120 }}>
          <div style={{ fontFamily: theme.fonts.display, fontSize: 46, fontWeight: 700, lineHeight: 1, color: theme.accent, letterSpacing: "-0.02em" }}>
            {s.value}
          </div>
          <div style={{ fontSize: 14, marginTop: 6, color: theme.ink }}>{s.label}</div>
          {s.sublabel && <div style={{ fontSize: 11.5, marginTop: 2, color: theme.muted }}>{s.sublabel}</div>}
        </div>
      ))}
    </div>
  );
}

function BlockView({ block, theme }: { block: ContentBlock; theme: DeckTheme }) {
  const label: CSSProperties = { fontFamily: theme.fonts.label, fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", color: theme.muted };

  switch (block.type) {
    case "comparison": {
      const cell: CSSProperties = { padding: "7px 12px", fontSize: 13.5, borderBottom: `1px solid ${theme.rule}`, textAlign: "left" };
      return (
        <table style={{ width: "100%", borderCollapse: "collapse", color: theme.ink }}>
          <thead>
            <tr>
              {block.columns.map((c, i) => (
                <th key={i} style={{ ...cell, fontFamily: theme.fonts.label, fontSize: 12, fontWeight: 700, color: i === 0 ? theme.muted : theme.ink, background: theme.accentSoft }}>
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {block.rows.map((row, ri) => (
              <tr key={ri}>
                {row.cells.map((c, ci) => (
                  <td key={ci} style={{ ...cell, fontWeight: ci === 0 ? 600 : 400, color: ci === 0 ? theme.ink : theme.muted }}>{c}</td>
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
            <div key={i} style={{ flex: "1 1 160px", minWidth: 150, borderTop: `2px solid ${theme.accent}`, paddingTop: 10 }}>
              <div style={{ fontFamily: theme.fonts.label, fontSize: 13, fontWeight: 700, color: theme.accent }}>{it.period}</div>
              <ul style={{ margin: "8px 0 0", paddingLeft: 16, color: theme.muted, fontSize: 13, lineHeight: 1.5 }}>
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
            <div key={i} style={{ border: `1px solid ${theme.rule}`, borderRadius: 999, padding: "8px 16px", display: "flex", gap: 8, alignItems: "baseline" }}>
              <span style={{ fontWeight: 600, fontSize: 14, color: theme.ink }}>{it.name}</span>
              {it.note && <span style={{ fontSize: 11.5, color: theme.muted }}>{it.note}</span>}
            </div>
          ))}
        </div>
      );

    case "chips":
      return (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(190px, 1fr))", gap: 12 }}>
          {block.items.map((it, i) => (
            <div key={i} style={{ border: `1px solid ${theme.rule}`, borderRadius: 8, padding: "10px 14px" }}>
              <div style={{ fontFamily: theme.fonts.display, fontWeight: 600, fontSize: 15, color: theme.ink }}>{it.name}</div>
              {it.role && <div style={{ fontFamily: theme.fonts.label, fontSize: 12, color: theme.accent, marginTop: 2 }}>{it.role}</div>}
              {it.note && <div style={{ fontSize: 12, color: theme.muted, marginTop: 4, lineHeight: 1.4 }}>{it.note}</div>}
            </div>
          ))}
        </div>
      );

    case "quote":
      return (
        <blockquote style={{ margin: 0, borderLeft: `3px solid ${theme.accent}`, paddingLeft: 16 }}>
          <div style={{ fontFamily: theme.fonts.display, fontSize: 20, lineHeight: 1.4, color: theme.ink }}>“{block.text}”</div>
          <div style={{ ...label, marginTop: 10, textTransform: "none", letterSpacing: "normal", fontSize: 12.5 }}>
            <span style={{ color: theme.ink, fontWeight: 600 }}>{block.author}</span>
            {block.role && <span style={{ color: theme.muted }}>{` — ${block.role}`}</span>}
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
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, color: theme.ink, marginBottom: 4 }}>
                  <span>{it.label}</span>
                  <span style={{ color: theme.muted }}>{it.value}{it.max ? ` / ${it.max}` : ""}</span>
                </div>
                <div style={{ height: 9, background: theme.accentSoft, borderRadius: 999, overflow: "hidden" }}>
                  <div style={{ width: `${pct}%`, height: "100%", background: theme.accent, borderRadius: 999 }} />
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
