/**
 * Billing plans page.
 *
 * Creates a Bachs checkout session via our backend and redirects the user
 * to the hosted checkout page. Fulfilment happens via webhook — the redirect
 * back to the site is cosmetic only.
 */
import { useState } from "react";
import "./billing-plans.css";

const API_BASE = import.meta.env.VITE_API_BASE as string;

interface Props {
  accessToken: string;
  currentPlan?: string;
}

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

export default function BillingPlans({ accessToken, currentPlan = "free" }: Props) {
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

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

  const isPaid = currentPlan !== "free";

  return (
    <div className="bp-wrap">
      <div className="bp-header">
        <div className="bp-eyebrow">Billing</div>
        <h2>Choose your plan</h2>
        <p>Export your deck to PDF or PowerPoint. Pay once or subscribe — no lock-in.</p>
        {isPaid && (
          <div className="bp-current">
            Current plan: <strong>{currentPlan.replace("_", " ")}</strong>
          </div>
        )}
      </div>

      {error && <p className="p-error bp-error">{error}</p>}

      <div className="bp-grid">
        {PLANS.map((plan) => (
          <div key={plan.id} className={`bp-card ${plan.highlight ? "is-featured" : ""}`}>
            {plan.highlight && <div className="bp-badge">Most popular</div>}
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
            <button
              className={`p-btn ${plan.highlight ? "p-btn-primary" : "p-btn-ghost"} bp-cta`}
              onClick={() => checkout(plan.id)}
              disabled={!!loading}
            >
              {loading === plan.id ? "Opening checkout…" : `Get ${plan.name}`}
            </button>
          </div>
        ))}
      </div>

      <p className="bp-note">
        Payments are processed by Bachs. You'll be redirected to a secure checkout page.
        After payment, your plan activates automatically — no need to refresh.
      </p>
    </div>
  );
}
