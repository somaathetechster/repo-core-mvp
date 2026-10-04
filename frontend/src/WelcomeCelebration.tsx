/**
 * Full-screen celebration shown once, right after a successful checkout.
 *
 * Confetti comes from canvas-confetti loaded from a CDN at runtime (injected
 * <script>, no npm dependency). If the CDN is blocked or slow the overlay
 * still shows — the confetti is pure garnish and its absence is silent.
 *
 * Auto-dismisses after 3 seconds, or immediately on click.
 */
import { useEffect, useRef } from "react";
import "./welcome-celebration.css";

const CONFETTI_SRC =
  "https://cdnjs.cloudflare.com/ajax/libs/canvas-confetti/1.9.3/confetti.browser.min.js";

interface ConfettiFn {
  (opts: Record<string, unknown>): void;
}

function loadConfetti(): Promise<ConfettiFn | null> {
  return new Promise((resolve) => {
    const w = window as unknown as { confetti?: ConfettiFn };
    if (w.confetti) return resolve(w.confetti);
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${CONFETTI_SRC}"]`);
    if (existing) {
      existing.addEventListener("load", () => resolve(w.confetti ?? null), { once: true });
      existing.addEventListener("error", () => resolve(null), { once: true });
      return;
    }
    const script = document.createElement("script");
    script.src = CONFETTI_SRC;
    script.async = true;
    script.onload = () => resolve(w.confetti ?? null);
    script.onerror = () => resolve(null);
    document.head.appendChild(script);
  });
}

export default function WelcomeCelebration({
  planName,
  onDismiss,
}: {
  planName: string;
  onDismiss: () => void;
}) {
  // Guard so the two timers (auto-dismiss, confetti loop) only ever fire the
  // dismiss once, even if the user also clicks.
  const dismissed = useRef(false);
  // Latest-callback ref, kept current in an effect (not during render).
  const dismiss = useRef(onDismiss);
  useEffect(() => { dismiss.current = onDismiss; });

  useEffect(() => {
    let raf = 0;
    let cancelled = false;
    const end = Date.now() + 2800;

    loadConfetti().then((confetti) => {
      if (!confetti || cancelled) return;
      const frame = () => {
        confetti({
          particleCount: 4,
          angle: 60,
          spread: 55,
          origin: { x: 0, y: 0.7 },
          colors: ["#b8860b", "#161412", "#faf8f3", "#e0b84c"],
        });
        confetti({
          particleCount: 4,
          angle: 120,
          spread: 55,
          origin: { x: 1, y: 0.7 },
          colors: ["#b8860b", "#161412", "#faf8f3", "#e0b84c"],
        });
        if (Date.now() < end && !cancelled) raf = requestAnimationFrame(frame);
      };
      frame();
    });

    const fire = () => {
      if (dismissed.current) return;
      dismissed.current = true;
      dismiss.current();
    };
    const timer = setTimeout(fire, 3000);

    return () => {
      cancelled = true;
      clearTimeout(timer);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  const handleClick = () => {
    if (dismissed.current) return;
    dismissed.current = true;
    onDismiss();
  };

  return (
    <div className="welcome-celebration" role="dialog" aria-modal="true" onClick={handleClick}>
      <div className="welcome-celebration-inner">
        <div className="welcome-celebration-mark">Provisio</div>
        <h1 className="welcome-celebration-title">Welcome to {planName}!</h1>
        <p className="welcome-celebration-sub">
          Your account has been upgraded. Let's build something great.
        </p>
        <p className="welcome-celebration-hint">Click anywhere to continue</p>
      </div>
    </div>
  );
}
