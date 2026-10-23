import { useEffect, useState } from "react";
import { adminListUsers, adminGrantPlan, type AdminUser } from "./api";
import "./admin.css";

const GRANTABLE = [
  { id: "one_time", name: "Single deck" },
  { id: "monthly", name: "Monthly" },
  { id: "yearly", name: "Yearly" },
];

/**
 * Admin oversight.
 *
 * The user list is derived from decks, usage, and subscriptions rather than
 * from a separate users table, so it can't drift out of sync with what
 * people have actually done.
 *
 * The whole surface returns 404 rather than 403 for non-admins, so it
 * doesn't confirm its own existence to someone who shouldn't see it.
 */
export default function AdminDashboard() {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [totals, setTotals] = useState<{ users: number; paying: number; decks: number; exports: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [granting, setGranting] = useState<AdminUser | null>(null);
  const [grantPlan, setGrantPlan] = useState("monthly");
  const [grantNote, setGrantNote] = useState("");
  const [query, setQuery] = useState("");

  async function refresh() {
    setLoading(true);
    setError(null);
    try {
      const r = await adminListUsers();
      setUsers(r);
      setTotals({
        users: r.length,
        paying: r.filter((u) => u.plan !== "free").length,
        decks: r.reduce((sum, u) => sum + u.deck_count, 0),
        exports: r.reduce((sum, u) => sum + u.export_count, 0),
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't load the dashboard.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { refresh(); }, []);

  async function doGrant() {
    if (!granting) return;
    try {
      await adminGrantPlan(granting.user_id, grantPlan, grantNote);
      setNotice(`Granted ${grantPlan.replace("_", " ")} to ${granting.email ?? granting.user_id}.`);
      setTimeout(() => setNotice(null), 4000);
      setGranting(null);
      setGrantNote("");
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't grant that plan.");
    }
  }

  const filtered = query
    ? users.filter((u) =>
        [u.email, u.display_name, u.user_id].some((f) => f?.toLowerCase().includes(query.toLowerCase())),
      )
    : users;

  if (error && users.length === 0) {
    return (
      <div className="adm">
        <p className="p-error">{error}</p>
      </div>
    );
  }

  return (
    <div className="adm">
      <header className="adm-head">
        <h1 className="dash-title">Admin</h1>
        <p className="dash-subtitle">Everyone using Provisio, what they've built, and what they're on.</p>
      </header>

      {notice && <p className="adm-notice">{notice}</p>}
      {error && <p className="p-error">{error}</p>}

      {totals && (
        <div className="adm-totals">
          <Stat label="Users" value={totals.users} />
          <Stat label="Paying" value={totals.paying} accent />
          <Stat label="Decks built" value={totals.decks} />
          <Stat label="Exports" value={totals.exports} />
          <Stat
            label="Conversion"
            value={totals.users > 0 ? `${Math.round((totals.paying / totals.users) * 100)}%` : "—"}
          />
        </div>
      )}

      <input
        className="p-input adm-search"
        placeholder="Search by email or id…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />

      {loading ? (
        <p className="adm-loading">Loading…</p>
      ) : (
        <div className="adm-table-wrap">
          <table className="adm-table">
            <thead>
              <tr>
                <th>User</th>
                <th>Plan</th>
                <th className="num">Decks</th>
                <th className="num">Exports</th>
                <th>Renews</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((u) => (
                <tr key={u.user_id}>
                  <td>
                    <span className="adm-email">{u.email ?? u.display_name ?? "—"}</span>
                    <span className="adm-id">{u.user_id.slice(0, 12)}…</span>
                  </td>
                  <td>
                    <span className={`adm-plan adm-plan-${u.plan}`}>{u.plan_name}</span>
                    {u.is_admin && <span className="adm-badge">admin</span>}
                  </td>
                  <td className="num">{u.deck_count}</td>
                  <td className="num">{u.export_count}</td>
                  <td className="adm-renews">
                    {u.period_end ? new Date(u.period_end).toLocaleDateString() : "—"}
                  </td>
                  <td>
                    <button className="adm-grant-btn" onClick={() => setGranting(u)}>
                      Grant plan
                    </button>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr><td colSpan={6} className="adm-empty">No users match that.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {granting && (
        <div className="adm-overlay" onClick={() => setGranting(null)}>
          <div className="adm-modal" onClick={(e) => e.stopPropagation()}>
            <h3>Grant a plan</h3>
            <p className="adm-modal-sub">
              To <strong>{granting.email ?? granting.user_id}</strong>. This is recorded as a normal
              subscription marked as an admin grant, so it stays auditable.
            </p>

            <label className="adm-field">
              <span>Plan</span>
              <select className="p-input" value={grantPlan} onChange={(e) => setGrantPlan(e.target.value)}>
                {GRANTABLE.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </label>

            <label className="adm-field">
              <span>Why (recorded on the grant)</span>
              <input
                className="p-input"
                placeholder="e.g. Launch campaign, YC batch comp"
                value={grantNote}
                onChange={(e) => setGrantNote(e.target.value)}
              />
            </label>

            <div className="adm-modal-actions">
              <button className="p-btn p-btn-secondary" onClick={() => setGranting(null)}>Cancel</button>
              <button className="p-btn p-btn-primary" onClick={doGrant}>Grant</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: number | string; accent?: boolean }) {
  return (
    <div className={`adm-stat ${accent ? "is-accent" : ""}`}>
      <span className="adm-stat-value">{value}</span>
      <span className="adm-stat-label">{label}</span>
    </div>
  );
}
