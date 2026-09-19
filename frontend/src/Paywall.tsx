import { useEffect, useState } from "react";
import { listPlans, type PlanDTO } from "./api";
import "./paywall.css";

/**
 * The paywall.
 *
 * Shown at the moment of export, which is the point where the value is
 * already built and obvious. The deck is never taken away or watermarked:
 * it stays saved and editable, and the copy says so, because a founder who
 * feels their work is held hostage does not become a customer.
 */
export default function Paywall({
  message,
  plans: initialPlans,
  onClose,
  onChoose,
}: {
  message: string;
  plans?: PlanDTO[];
  onClose: () => void;
  onChoose: (plan: PlanDTO) => void;
}) {
  const [plans, setPlans] = useState<PlanDTO[]>(initialPlans ?? []);
  const [loading, setLoading] = useState(!initialPlans?.length);

  useEffect(() => {
    if (plans.length > 0) return;
    listPlans()
      .then((r) => setPlans(r.plans.filter((p) => p.id !== "free")))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [plans.length]);

  return (
    <div className="pw-overlay" onClick={onClose}>
      <div className="pw-modal" onClick={(e) => e.stopPropagation()}>
        <button className="pw-close" onClick={onClose}>×</button>

        <header className="pw-head">
          <h2>Your deck is ready to export</h2>
          <p>{message}</p>
        </header>

        {loading && <p className="pw-loading">Loading plans…</p>}

        <div className="pw-plans">
          {plans.map((plan) => {
            // Yearly is the better deal and saying so plainly is more
            // persuasive than a "most popular" badge nobody believes.
            const monthly = plans.find((p) => p.interval === "month");
            const saving =
              plan.interval === "year" && monthly
                ? Math.round((1 - plan.price_usd / (monthly.price_usd * 12)) * 100)
                : null;

            return (
              <div key={plan.id} className={`pw-plan ${plan.interval === "year" ? "is-best" : ""}`}>
                {saving !== null && saving > 0 && (
                  <span className="pw-badge">{saving}% less than monthly</span>
                )}
                <h3>{plan.name}</h3>
                <p className="pw-price">
                  <strong>${plan.price_usd.toFixed(2)}</strong>
                  {plan.interval && <em>/{plan.interval}</em>}
                </p>
                <p className="pw-desc">{plan.description}</p>
                <ul className="pw-features">
                  {plan.features.map((f, i) => <li key={i}>{f}</li>)}
                </ul>
                <button className="p-btn p-btn-primary" onClick={() => onChoose(plan)}>
                  Choose {plan.name}
                </button>
              </div>
            );
          })}
        </div>

        <footer className="pw-foot">
          <p>
            Your deck stays saved and fully editable either way. Nothing is deleted and nothing is
            watermarked, you just can't download it yet.
          </p>
        </footer>
      </div>
    </div>
  );
}
