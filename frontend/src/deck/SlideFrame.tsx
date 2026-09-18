import { useEffect, useRef, useState, type ReactNode } from "react";
import { SLIDE_W, SLIDE_H } from "./design";

/**
 * Renders a slide at its true design size, then scales it to fit.
 *
 * Designing at a fixed 1280x720 and scaling means every proportion, type
 * size, and margin holds exactly the same whether the slide appears as a
 * small thumbnail, in the editor, or full screen. The alternative, laying
 * out responsively, produces slides whose composition changes with the
 * viewport, which is not what a deck is.
 */
export default function SlideFrame({
  children,
  maxWidth,
  className,
  onClick,
}: {
  children: ReactNode;
  maxWidth?: number;
  className?: string;
  onClick?: () => void;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;

    function measure() {
      if (!el) return;
      const available = maxWidth ?? el.clientWidth;
      if (available > 0) setScale(available / SLIDE_W);
    }

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [maxWidth]);

  return (
    <div
      ref={wrapRef}
      className={className}
      onClick={onClick}
      style={{
        width: "100%",
        height: SLIDE_H * scale,
        position: "relative",
        overflow: "hidden",
        borderRadius: 4,
      }}
    >
      <div
        style={{
          width: SLIDE_W,
          height: SLIDE_H,
          transform: `scale(${scale})`,
          transformOrigin: "top left",
          position: "absolute",
          top: 0,
          left: 0,
        }}
      >
        {children}
      </div>
    </div>
  );
}
