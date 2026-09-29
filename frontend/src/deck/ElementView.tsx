import type { CSSProperties, ReactNode } from "react";
import type { SlideElement, ElementStyle } from "./elements";
import type { DeckTheme } from "./theme";
import { treatmentFilter, objectPosition, type ImageTreatment } from "./images";
import { ASSETS, assetToSvg } from "./assets";

/**
 * Renders a single element.
 *
 * Style values are named roles ("accent", "display") rather than literal
 * colours and fonts, so changing the theme repaints every element on every
 * slide without touching element data. That indirection is what makes a
 * live theme editor possible at all.
 */

export function resolveColor(token: string | undefined, theme: DeckTheme, fallback = "ink"): string {
  const key = token ?? fallback;
  switch (key) {
    case "ink": return theme.ink;
    case "paper": return theme.paper;
    case "accent": return theme.accent;
    case "muted": return theme.muted;
    case "inverse": return theme.inverse;
    case "accentSoft": return theme.accentSoft;
    case "rule": return theme.rule;
    case "none": return "transparent";
    default: return key; // a literal colour, when the user has overridden
  }
}

export function resolveFont(token: string | undefined, theme: DeckTheme): string {
  switch (token) {
    case "display": return theme.fonts.display;
    case "label": return theme.fonts.label;
    default: return theme.fonts.body;
  }
}

export function elementStyleToCss(el: SlideElement, theme: DeckTheme): CSSProperties {
  const s: ElementStyle = el.style ?? {};
  const css: CSSProperties = {
    position: "absolute",
    left: el.frame.x,
    top: el.frame.y,
    width: el.frame.w,
    height: el.frame.h,
    zIndex: el.frame.z ?? 10,
    opacity: el.opacity ?? s.opacity ?? 1,
    display: el.hidden ? "none" : undefined,
    boxSizing: "border-box",
  };

  if (el.frame.rotation) css.transform = `rotate(${el.frame.rotation}deg)`;

  if (s.background && s.background !== "none") {
    css.background = resolveColor(s.background, theme, "paper");
  }
  if (s.borderRadius) css.borderRadius = s.borderRadius;
  if (s.padding) css.padding = s.padding;
  if (s.borderLeft) {
    css.borderLeft = `${s.borderLeft}px solid ${resolveColor(s.borderColor ?? "accent", theme)}`;
    css.paddingLeft = (s.padding ?? 0) + 12;
  }
  if (s.borderTop) {
    css.borderTop = `${s.borderTop}px solid ${resolveColor(s.borderColor ?? "rule", theme)}`;
    css.paddingTop = s.padding ?? 8;
  }

  // Text-bearing elements
  if (["text", "heading", "eyebrow", "statement", "caption", "list", "quote", "metric", "pageNumber"].includes(el.type)) {
    css.color = resolveColor(s.color, theme);
    css.fontFamily = resolveFont(s.fontFamily, theme);
    css.fontSize = s.fontSize ?? 18;
    css.fontWeight = s.fontWeight ?? 400;
    css.lineHeight = s.lineHeight ?? 1.5;
    css.letterSpacing = s.letterSpacing;
    css.textAlign = s.align ?? "left";
    css.whiteSpace = "pre-wrap";
    css.overflowWrap = "break-word";
    if (s.verticalAlign) {
      css.display = "flex";
      css.flexDirection = "column";
      css.justifyContent =
        s.verticalAlign === "middle" ? "center" : s.verticalAlign === "bottom" ? "flex-end" : "flex-start";
    }
  }

  return css;
}

export interface ElementRenderProps {
  element: SlideElement;
  theme: DeckTheme;
  /** Charts are rendered by the caller, which owns the charting system. */
  renderChart?: (el: SlideElement) => ReactNode;
  /** In the editor, text is editable in place. */
  editable?: boolean;
  onTextChange?: (id: string, text: string) => void;
}

export default function ElementView({
  element, theme, renderChart, editable, onTextChange,
}: ElementRenderProps) {
  const css = elementStyleToCss(element, theme);
  const s = element.style ?? {};

  switch (element.type) {
    case "asset": {
      // Assets are SVG coloured from the theme at render time, so a shape
      // dropped on a slide recolours with the deck instead of staying
      // whatever colour it was drawn in.
      const asset = ASSETS.find((a) => a.id === s.assetId);
      if (!asset) return null;
      const colour = resolveColor(s.color ?? "accent", theme, "accent");
      return (
        <div
          style={{ ...css, display: "flex", alignItems: "center", justifyContent: "center" }}
          dangerouslySetInnerHTML={{
            __html: assetToSvg(asset, colour, s.assetStyle ?? asset.defaultStyle ?? "solid"),
          }}
        />
      );
    }

    case "shape":
    case "rule":
      return (
        <div
          style={{
            ...css,
            background: resolveColor(s.background ?? "accent", theme),
            borderRadius: s.shape === "circle" ? "50%" : s.borderRadius ?? 0,
          }}
        />
      );

    case "image":
    case "logo":
    case "portrait": {
      if (!element.src) {
        // A placeholder that still occupies the right frame, so a missing
        // photo doesn't collapse the composition.
        return (
          <div style={{
            ...css,
            background: theme.accentSoft,
            display: "flex", alignItems: "center", justifyContent: "center",
            color: theme.muted, fontFamily: theme.fonts.display,
            fontSize: Math.min(element.frame.h * 0.3, 34),
            borderRadius: s.borderRadius ?? 0,
          }}>
            {element.type === "portrait" && element.text
              ? element.text.split(" ").map((p) => p[0]).slice(0, 2).join("")
              : ""}
          </div>
        );
      }
      // Crop is presentation-only: focal point and zoom are applied here
      // rather than baked into the data, so they stay adjustable.
      const crop = { focusX: s.focusX ?? 0.5, focusY: s.focusY ?? 0.5, zoom: s.zoom ?? 1 };
      const filter = s.filter ?? treatmentFilter(s.treatment as ImageTreatment | undefined);
      const zoomed = crop.zoom !== 1;
      const img = (
        <img
          src={element.src}
          alt=""
          style={{
            width: "100%",
            height: "100%",
            objectFit: s.objectFit ?? "cover",
            objectPosition: objectPosition(crop),
            filter,
            transform: zoomed ? `scale(${crop.zoom})` : undefined,
            transformOrigin: `${crop.focusX * 100}% ${crop.focusY * 100}%`,
            display: "block",
          }}
        />
      );
      // Zoom needs a clipping wrapper, otherwise the scaled image bleeds
      // past its frame and over neighbouring elements.
      return (
        <div style={{ ...css, overflow: "hidden", borderRadius: s.borderRadius ?? 0 }}>
          {img}
        </div>
      );
    }

    case "chart":
      return (
        <div style={{ ...css, overflow: "hidden" }}>
          {renderChart ? renderChart(element) : null}
        </div>
      );

    default: {
      if (editable && onTextChange) {
        return (
          <div
            style={{ ...css, outline: "none", cursor: "text" }}
            contentEditable
            suppressContentEditableWarning
            onBlur={(e) => onTextChange(element.id, e.currentTarget.textContent ?? "")}
          >
            {element.text}
          </div>
        );
      }
      return <div style={css}>{element.text}</div>;
    }
  }
}
