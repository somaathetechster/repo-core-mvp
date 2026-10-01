/**
 * Billing plans page.
 *
 * Creates a Bachs checkout session via our backend and redirects the user
 * to the hosted checkout page. Fulfilment happens via webhook — the redirect
 * back to the site is cosmetic only.
 */
import { useEffect, useState } from "react";
import "./billing-plans.css";

const API_BASE = import.meta.env.VITE_API_BASE as string;

interface Props {
  accessToken: string;
  currentPlan?: string;
}

/**
 * The entitlement endpoint reports plan ids from the backend's PlanId enum
 * (free | one_time | monthly | yearly); the cards here use their own ids
 * (single | monthly | yearly). This maps the former to the latter so the
 * right card gets the "Current plan" badge.
 */
const PLAN_ID_TO_CARD: Record<string, string> = {
  one_time: "single",
  monthly: "monthly",
  yearly: "yearly",
};

const PLANS = [
  {
    id: "single",
    name: "Single export",
    price: "$10",
    period: "one time",
    features: ["1 export credit", "PDF or PowerPoint", "Full deck editor"],
    highlight: false,
  },
  {
    id: "monthly",
    name: "Monthly",
    price: "$30",
    period: "per month",
    features: ["Unlimited exports", "PDF or PowerPoint", "Full deck editor", "Priority support"],
    highlight: true,
  },
  {
    id: "yearly",
    name: "Yearly",
    price: "$99",
    period: "per year",
    features: ["Unlimited exports", "PDF or PowerPoint", "Full deck editor", "Priority support", "Save $261 vs monthly"],
    highlight: false,
  },
];

export default function BillingPlans({ accessToken, currentPlan }: Props) {
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Resolved from /billing/me on mount. A prop, if passed, is the initial
  // value; the fetch is authoritative.
  const [planId, setPlanId] = useState<string>(currentPlan ?? "free");
  const [planName, setPlanName] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`${API_BASE}/billing/me`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (cancelled || !data?.entitlement?.plan) return;
        setPlanId(data.entitlement.plan.id);
        setPlanName(data.entitlement.plan.name);
      })
      .catch(() => { /* leave the default; the plans still render */ });
    return () => { cancelled = true; };
  }, [accessToken]);

  const checkout = async (planId: string) => {
    setError(null);
    setLoading(planId);
    try {
      const res = await fetch(`${API_BASE}/checkout/create`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ plan_id: planId }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.detail || "Could not start checkout. Try again.");
      }
      const { checkout_url } = await res.json();
      window.location.href = checkout_url;
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
        <div className="bp-current">
          You're on the <strong>{displayPlanName}</strong> plan
        </div>
      </div>

      {error && <p className="p-error bp-error">{error}</p>}

      <div className="bp-grid">
        {PLANS.map((plan) => {
          const isCurrent = plan.id === currentCardId;
          return (
            <div key={plan.id} className={`bp-card ${plan.highlight ? "is-featured" : ""} ${isCurrent ? "is-current" : ""}`}>
              {plan.highlight && !isCurrent && <div className="bp-badge">Most popular</div>}
              {isCurrent && <div className="bp-badge bp-badge-current">Current plan</div>}
              <div className="bp-plan-name">{plan.name}</div>
              <div className="bp-price">
                <span className="bp-amount">{plan.price}</span>
                <span className="bp-period">{plan.period}</span>
              </div>
              <ul className="bp-features">
                {plan.features.map((f) => (
                  <li key={f}><span>✓</span>{f}</li>
                ))}
              </ul>
              {isCurrent ? (
                <div className="bp-cta bp-current-badge">✓ Current plan</div>
              ) : (
                <button
                  className={`p-btn ${plan.highlight ? "p-btn-primary" : "p-btn-ghost"} bp-cta`}
                  onClick={() => checkout(plan.id)}
                  disabled={!!loading}
                >
                  {loading === plan.id ? "Opening checkout…" : `Get ${plan.name}`}
                </button>
              )}
            </div>
          );
        })}
      </div>

      <p className="bp-note">
        Payments are processed by Bachs. You'll be redirected to a secure checkout page.
        After payment, your plan activates automatically — no need to refresh.
      </p>
    </div>
  );
}
