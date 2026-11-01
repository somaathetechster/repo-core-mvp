import { useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import "./coming-soon.css";

type ProductName = "Brand" | "Sign";

const PRODUCTS: Record<ProductName, { title: string; description: string; icon: ReactNode }> = {
  Brand: {
    title: "Provisio Brand",
    description: "A brand kit and letterhead that keeps every deck and document consistently on-brand.",
    icon: (
      <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M12 3a9 9 0 1 0 0 18c1 0 1.5-.8 1.5-1.5 0-.5-.3-.9-.6-1.2-.3-.4-.6-.7-.6-1.3 0-.8.7-1.5 1.5-1.5H15a5 5 0 0 0 5-5c0-4-3.6-6.5-8-6.5Z" />
        <circle cx="7.5" cy="10.5" r="1" /><circle cx="12" cy="7.5" r="1" /><circle cx="16.5" cy="10.5" r="1" />
      </svg>
    ),
  },
  Sign: {
    title: "Provisio Sign",
    description: "Send documents for legally-binding e-signature and track who has signed, all without leaving Provisio.",
    icon: (
      <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M15 4 20 9 8 21H3v-5L15 4Z" /><path d="m13.5 5.5 5 5" />
      </svg>
    ),
  },
};

const WAITLIST_KEY = "provisio:waitlist";

function readWaitlist(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(WAITLIST_KEY) || "{}");
  } catch {
    return {};
  }
}

/**
 * On-brand placeholder for products that aren't built yet (Brand, Sign).
 * "Get notified" stores the email against the product in localStorage — no
 * backend yet — and reflects back that they're already on the list on return.
 */
export default function ComingSoonPage({ product }: { product: ProductName }) {
  const info = PRODUCTS[product];
  const [email, setEmail] = useState("");
  const [joined, setJoined] = useState<boolean>(() => Boolean(readWaitlist()[product]));

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const value = email.trim();
    if (!value) return;
    const list = readWaitlist();
    list[product] = value;
    try {
      localStorage.setItem(WAITLIST_KEY, JSON.stringify(list));
    } catch {
      /* private mode / storage blocked — still show the confirmation */
    }
    setJoined(true);
  }

  return (
    <div className="coming-soon">
      <div className="coming-soon-card">
        <div className="coming-soon-icon">{info.icon}</div>
        <div className="coming-soon-eyebrow">Coming soon</div>
        <h1 className="coming-soon-title">{info.title}</h1>
        <p className="coming-soon-desc">{info.description}</p>

        {joined ? (
          <div className="coming-soon-joined">You're on the list — we'll email you the moment {product} is ready.</div>
        ) : (
          <form className="coming-soon-form" onSubmit={submit}>
            <input
              className="coming-soon-input"
              type="email"
              required
              placeholder="you@company.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              aria-label="Email address"
            />
            <button className="coming-soon-btn" type="submit">Get notified</button>
          </form>
        )}

        <Link className="coming-soon-back" to="/home">← Back to Home</Link>
      </div>
    </div>
  );
}
