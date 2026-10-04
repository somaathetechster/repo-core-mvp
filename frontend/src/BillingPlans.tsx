import { useEffect, useState } from "react";
import "./billing-plans.css";

const API_BASE = import.meta.env.VITE_API_BASE as string;

interface Props { accessToken: string; currentPlan?: string; }

const PLAN_ID_TO_CARD: Record<string, string> = { one_time: "single", monthly: "monthly", yearly: "yearly" };
const PLANS = [
  { id: "single", name: "Single export", price: "$10", period: "one time", features: ["1 export credit", "PDF or PowerPoint", "Full deck editor"], highlight: false },
  { id: "monthly", name: "Monthly", price: "$30", period: "per month", features: ["Unlimited exports", "PDF or PowerPoint", "Full deck editor", "Priority support"], highlight: true },
  { id: "yearly", name: "Yearly", price: "$99", period: "per year", features: ["Unlimited exports", "PDF or PowerPoint", "Full deck editor", "Priority support", "Save $261 vs monthly"], highlight: false },
];

type PaymentMethod = "fiat" | "crypto";

interface BillingMe {
  entitlement: {
    plan: { id: string; name: string; deck_exports: number | null };
    can_export: boolean;
    is_paid: boolean;
    exports_remaining: number | null;
    period_end: string | null;
    subscription_id: string | null;
  };
  exports_used: number;
  exports_used_period: number;
  period: string;
  member_since: string | null;
  history: { id: string; plan_id: string; status: string }[];
}

function formatMonthYear(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString("en-US", { month: "short", year: "numeric" });
}

function formatDate(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export default function BillingPlans({ accessToken, currentPlan }: Props) {
  const [loading, setLoading] = useState<PaymentMethod | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [planId, setPlanId] = useState(currentPlan ?? "free");
  const [planName, setPlanName] = useState<string | null>(null);
  const [billing, setBilling] = useState<BillingMe | null>(null);
  const [selectedPlan, setSelectedPlan] = useState<(typeof PLANS)[number] | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`${API_BASE}/billing/me`, { headers: { Authorization: `Bearer ${accessToken}` } })
      .then((res) => (res.ok ? res.json() : null))
      .then((data: BillingMe | null) => {
        if (!cancelled && data?.entitlement?.plan) {
          setPlanId(data.entitlement.plan.id);
          setPlanName(data.entitlement.plan.name);
          setBilling(data);
        }
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [accessToken]);

  useEffect(() => {
    if (!selectedPlan) return;
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") setSelectedPlan(null); };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [selectedPlan, loading]);

  const checkout = async (method: PaymentMethod) => {
    if (!selectedPlan) return;
    setError(null);
    setLoading(method);
    const endpoint = method === "fiat" ? "/checkout/flutterwave" : "/checkout/crypto";
    try {
      const res = await fetch(`${API_BASE}${endpoint}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({ plan_id: selectedPlan.id }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.checkout_url) throw new Error(data.detail || "Could not start checkout. Try again.");
      window.location.href = data.checkout_url;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
      setLoading(null);
    }
  };

  const isPaid = planId !== "free";
  const currentCardId = PLAN_ID_TO_CARD[planId] ?? null;
  const displayPlanName = planName ?? (isPaid ? planId.replace("_", " ") : "Free");

  return (
    <div className="bp-wrap">
      <div className="bp-header">
        <div className="bp-eyebrow">Billing</div>
        <h2>Choose your plan</h2>
        <p>Export your deck to PDF or PowerPoint. Pay once or subscribe — no lock-in.</p>
        <div className="bp-current">You're on the <strong>{displayPlanName}</strong> plan</div>
      </div>

      {billing && <CurrentPlanSummary billing={billing} displayPlanName={displayPlanName} />}

      {error && <p className="p-error bp-error">{error}</p>}
      <div className="bp-grid">
        {PLANS.map((plan) => {
          const isCurrent = plan.id === currentCardId;
          return (
            <div key={plan.id} className={`bp-card ${plan.highlight ? "is-featured" : ""} ${isCurrent ? "is-current" : ""}`}>
              {plan.highlight && !isCurrent && <div className="bp-badge">Most popular</div>}
              {isCurrent && <div className="bp-badge bp-badge-current">Current plan</div>}
              <div className="bp-plan-name">{plan.name}</div>
              <div className="bp-price"><span className="bp-amount">{plan.price}</span><span className="bp-period">{plan.period}</span></div>
              <ul className="bp-features">{plan.features.map((feature) => <li key={feature}><span>✓</span>{feature}</li>)}</ul>
              {isCurrent ? <div className="bp-cta bp-current-badge">✓ Current plan</div> : <button className={`p-btn ${plan.highlight ? "p-btn-primary" : "p-btn-ghost"} bp-cta`} onClick={() => { setError(null); setSelectedPlan(plan); }} disabled={!!loading}>{`Get ${plan.name}`}</button>}
            </div>
          );
        })}
      </div>
      <p className="bp-note">Choose card / bank transfer or crypto at checkout. After payment, your plan activates automatically.</p>

      {selectedPlan && (
        <div className="bp-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setSelectedPlan(null); }}>
          <div className="bp-modal" role="dialog" aria-modal="true" aria-labelledby="payment-method-title">
            <button className="bp-modal-close" aria-label="Close payment method dialog" onClick={() => setSelectedPlan(null)}>×</button>
            <div className="bp-eyebrow">{selectedPlan.name} · {selectedPlan.price}</div>
            <h3 id="payment-method-title">Choose how to pay</h3>
            <p className="bp-modal-subtitle">Select a secure checkout method to continue.</p>
            <button className="bp-payment-option" onClick={() => checkout("fiat")} disabled={!!loading}>
              <span className="bp-payment-icon">₣</span><span><strong>Pay with card / bank transfer</strong><small>Secure checkout with Flutterwave</small></span>
            </button>
            <button className="bp-payment-option" onClick={() => checkout("crypto")} disabled={!!loading}>
              <span className="bp-payment-icon">₿</span><span><strong>Pay with crypto</strong><small>USDT, BTC, ETH and other assets via NowPayments</small></span>
            </button>
            {loading && <p className="bp-loading">Opening secure checkout…</p>}
            {error && <div className="bp-modal-error"><p>{error}</p><button className="p-btn p-btn-ghost" onClick={() => setLoading(null)}>Retry</button></div>}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * "Your current plan" — a snapshot of the signed-in user's plan, status,
 * start date, renewal/expiry, and export usage. Shown for free and paid users
 * alike, above the plan cards.
 */
function CurrentPlanSummary({ billing, displayPlanName }: { billing: BillingMe; displayPlanName: string }) {
  const ent = billing.entitlement;
  const id = ent.plan.id;
  const unlimited = id === "monthly" || id === "yearly";

  // Status: cancelled recurring plans keep access until period end, so they
  // read as "Cancelled". Everything else currently granting access is active.
  const activeSub = billing.history.find((s) => s.id === ent.subscription_id);
  const status = activeSub?.status === "cancelled" ? "Cancelled" : "Active";

  const memberSince = formatMonthYear(billing.member_since);

  // Renewal / expiry line for recurring plans.
  const periodDate = formatDate(ent.period_end);
  const renewalLabel = status === "Cancelled" ? "Access until" : "Renews";

  // Export usage. Monthly/Yearly are unlimited; Free has a single lifetime
  // export; the one-time plan has a single export credit.
  let used = 0;
  let limit = 1;
  if (id === "free") {
    limit = 1;
    used = billing.exports_used;
  } else if (!unlimited) {
    // one_time / single
    limit = ent.plan.deck_exports ?? 1;
    const remaining = ent.exports_remaining ?? limit;
    used = Math.max(0, limit - remaining);
  }
  const pct = limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 0;

  return (
    <section className="bp-current-plan" aria-label="Your current plan">
      <div className="bp-cp-head">
        <h3>Your current plan</h3>
        <span className={`bp-cp-status bp-cp-status-${status.toLowerCase()}`}>{status}</span>
      </div>
      <div className="bp-cp-grid">
        <div className="bp-cp-item">
          <span className="bp-cp-label">Plan</span>
          <span className="bp-cp-value">{displayPlanName}</span>
        </div>
        {memberSince && (
          <div className="bp-cp-item">
            <span className="bp-cp-label">Started</span>
            <span className="bp-cp-value">Member since {memberSince}</span>
          </div>
        )}
        {unlimited && periodDate && (
          <div className="bp-cp-item">
            <span className="bp-cp-label">{renewalLabel}</span>
            <span className="bp-cp-value">{periodDate}</span>
          </div>
        )}
        <div className="bp-cp-item">
          <span className="bp-cp-label">Exports</span>
          <span className="bp-cp-value">
            {unlimited ? "Unlimited exports" : `${used} of ${limit} used`}
          </span>
        </div>
      </div>
      {!unlimited && (
        <div className="bp-cp-usage" role="progressbar" aria-valuenow={used} aria-valuemin={0} aria-valuemax={limit}>
          <div className="bp-cp-usage-bar" style={{ width: `${pct}%` }} />
        </div>
      )}
    </section>
  );
}
