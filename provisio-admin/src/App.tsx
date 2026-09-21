import { useState, useEffect, useCallback } from "react";
import { api, type AdminUser, type AdminStats, type AdminUsageRow, ApiError } from "./api";

/* ------------------------------------------------------------------ */
/* Auth gate — simple admin key check, Supabase not needed here        */
/* ------------------------------------------------------------------ */

function useAuth() {
  const [authed, setAuthed] = useState(() => !!sessionStorage.getItem("admin-authed"));
  const login = (key: string) => {
    if (key === import.meta.env.VITE_ADMIN_KEY) {
      sessionStorage.setItem("admin-authed", "1");
      setAuthed(true);
      return true;
    }
    return false;
  };
  const logout = () => { sessionStorage.removeItem("admin-authed"); setAuthed(false); };
  return { authed, login, logout };
}

function Login({ onLogin }: { onLogin: (k: string) => boolean }) {
  const [key, setKey] = useState("");
  const [err, setErr] = useState("");
  return (
    <div className="admin-login">
      <div className="admin-login-box">
        <div className="admin-login-logo">Provisio <em>Controller</em></div>
        <p style={{ fontSize: "0.8rem", color: "var(--text3)", textAlign: "center" }}>
          Admin access only. Enter your controller key.
        </p>
        <label style={{ display: "flex", flexDirection: "column", gap: "0.35rem", fontSize: "0.8rem", color: "var(--text2)" }}>
          Controller key
          <input type="password" value={key} autoFocus
            onChange={e => setKey(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter") { if (!onLogin(key)) setErr("Invalid key"); } }} />
        </label>
        {err && <p className="admin-alert admin-alert-error">{err}</p>}
        <button className="btn btn-gold" onClick={() => { if (!onLogin(key)) setErr("Invalid key"); }}>
          Enter
        </button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Shared helpers                                                       */
/* ------------------------------------------------------------------ */

type Page = "overview" | "users" | "usage" | "plans" | "settings";

const NAV: { page: Page; label: string; icon: string }[] = [
  { page: "overview", label: "Overview",   icon: "◈" },
  { page: "users",    label: "Users",      icon: "◉" },
  { page: "usage",    label: "Usage",      icon: "◎" },
  { page: "plans",    label: "Plans",      icon: "◆" },
  { page: "settings", label: "Settings",  icon: "⊙" },
];

function planBadge(plan: string) {
  const cls = plan === "monthly" || plan === "yearly" ? "badge-gold"
    : plan === "single" ? "badge-blue" : "badge-gray";
  return <span className={`badge ${cls}`}>{plan}</span>;
}

function relTime(iso: string | null): string {
  if (!iso) return "—";
  const d = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
  return d === 0 ? "today" : d === 1 ? "yesterday" : `${d}d ago`;
}

/* ------------------------------------------------------------------ */
/* Pages                                                               */
/* ------------------------------------------------------------------ */

function Overview({ stats }: { stats: AdminStats | null }) {
  if (!stats) return <div className="loading-row"><div className="spinner" /></div>;
  return (
    <>
      <div className="admin-cards">
        {[
          { label: "Total users",   value: stats.total_users,   sub: "", cls: "" },
          { label: "Active 7d",     value: stats.active_7d,     sub: `${Math.round(stats.active_7d/Math.max(stats.total_users,1)*100)}% of users`, cls: "green" },
          { label: "Paying users",  value: stats.paying_users,  sub: `${Math.round(stats.paying_users/Math.max(stats.total_users,1)*100)}% paid`, cls: "gold" },
          { label: "MRR",           value: `$${stats.mrr_usd}`, sub: "recurring revenue", cls: "gold" },
          { label: "Total decks",   value: stats.total_decks,   sub: `~${(stats.total_decks/Math.max(stats.total_users,1)).toFixed(1)} per user`, cls: "blue" },
          { label: "Total exports", value: stats.total_exports, sub: "lifetime", cls: "" },
        ].map(c => (
          <div key={c.label} className={`admin-card ${c.cls}`}>
            <div className="admin-card-label">{c.label}</div>
            <div className="admin-card-value">{c.value}</div>
            {c.sub && <div className="admin-card-sub">{c.sub}</div>}
          </div>
        ))}
      </div>
    </>
  );
}

function Users({ onGrant, onRevoke, onGrantPlan, onRevokePlan }:
  { onGrant:(id:string)=>void; onRevoke:(id:string)=>void;
    onGrantPlan:(id:string,plan:string)=>void; onRevokePlan:(id:string)=>void }) {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  const load = useCallback(async (query?: string) => {
    setLoading(true); setErr("");
    try { setUsers(await api.users(query)); }
    catch (e) { setErr(e instanceof ApiError ? e.message : "Failed to load users"); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="admin-table-wrap">
      <div className="admin-table-header">
        <span className="admin-table-title">Users ({users.length})</span>
        <div className="admin-search">
          <input placeholder="Search email…" value={q} onChange={e => setQ(e.target.value)}
            onKeyDown={e => e.key === "Enter" && load(q)} />
          <button className="btn btn-ghost btn-sm" onClick={() => load(q)}>Search</button>
          <button className="btn btn-ghost btn-sm" onClick={() => { setQ(""); load(); }}>Clear</button>
        </div>
      </div>
      {err && <p className="admin-alert admin-alert-error" style={{margin:"1rem"}}>{err}</p>}
      {loading ? <div className="loading-row"><div className="spinner"/></div> : (
        <table>
          <thead><tr>
            <th>Email</th><th>Plan</th><th>Decks</th><th>Exports</th>
            <th>Joined</th><th>Last active</th><th>Role</th><th>Actions</th>
          </tr></thead>
          <tbody>
            {users.length === 0 && <tr><td colSpan={8} className="admin-empty">No users found</td></tr>}
            {users.map(u => (
              <tr key={u.user_id}>
                <td>
                  <div>{u.email}</div>
                  <div className="mono" style={{color:"var(--text3)",fontSize:"0.7rem"}}>{u.user_id.slice(0,12)}…</div>
                </td>
                <td>{planBadge(u.plan)}</td>
                <td>{u.deck_count}</td>
                <td>{u.export_count}</td>
                <td>{relTime(u.joined)}</td>
                <td>{relTime(u.joined)}</td>
                <td>
                  {u.is_admin
                    ? <span className="badge badge-gold">Admin</span>
                    : <span className="badge badge-gray">User</span>}
                </td>
                <td>
                  <div style={{display:"flex",gap:"0.4rem",flexWrap:"wrap"}}>
                    {u.is_admin
                      ? <button className="btn btn-danger btn-sm" onClick={() => onRevoke(u.user_id)}>Revoke admin</button>
                      : <button className="btn btn-ghost btn-sm" onClick={() => onGrant(u.user_id)}>Make admin</button>}
                    <select className="btn btn-ghost btn-sm" style={{padding:"0.28rem 0.5rem"}}
                      defaultValue=""
                      onChange={e => { if(e.target.value) { onGrantPlan(u.user_id, e.target.value); e.target.value=""; }}}>
                      <option value="" disabled>Grant plan…</option>
                      <option value="monthly">Monthly</option>
                      <option value="yearly">Yearly</option>
                      <option value="single">Single export</option>
                    </select>
                    {u.plan !== "free" && (
                      <button className="btn btn-danger btn-sm" onClick={() => onRevokePlan(u.user_id)}>Revoke plan</button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function Usage() {
  const [rows, setRows] = useState<AdminUsageRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.usage().then(setRows).catch(console.error).finally(() => setLoading(false));
  }, []);

  const maxExports = Math.max(1, ...rows.map(r => r.exports_used));

  return (
    <div className="admin-table-wrap">
      <div className="admin-table-header">
        <span className="admin-table-title">Usage by period</span>
      </div>
      {loading ? <div className="loading-row"><div className="spinner"/></div> : (
        <table>
          <thead><tr><th>Email</th><th>Period</th><th>Plan</th><th>Decks</th><th>Exports</th></tr></thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={5} className="admin-empty">No usage data</td></tr>}
            {rows.map((r, i) => (
              <tr key={i}>
                <td>{r.email}</td>
                <td className="mono">{r.period}</td>
                <td>{planBadge(r.plan)}</td>
                <td>{r.decks_created}</td>
                <td>
                  <div className="usage-bar">
                    <div className="usage-bar-track">
                      <div className="usage-bar-fill" style={{width:`${(r.exports_used/maxExports)*100}%`}}/>
                    </div>
                    <span style={{width:"2rem",textAlign:"right"}}>{r.exports_used}</span>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function Plans() {
  return (
    <div style={{display:"flex",flexDirection:"column",gap:"1.5rem"}}>
      <div className="admin-cards">
        {[
          { name:"Free",   price:"$0",  features:"3 slides, no export",    badge:"badge-gray" },
          { name:"Single", price:"$10", features:"1 export credit",         badge:"badge-blue" },
          { name:"Monthly",price:"$30", features:"Unlimited, billed monthly",badge:"badge-gold" },
          { name:"Yearly", price:"$99", features:"Unlimited, billed yearly", badge:"badge-gold" },
        ].map(p=>(
          <div key={p.name} className="admin-card">
            <div style={{display:"flex",justifyContent:"space-between",marginBottom:"0.5rem"}}>
              <span className="admin-card-label">{p.name}</span>
              <span className={`badge ${p.badge}`}>{p.name}</span>
            </div>
            <div className="admin-card-value" style={{fontSize:"1.5rem"}}>{p.price}</div>
            <div className="admin-card-sub">{p.features}</div>
          </div>
        ))}
      </div>
      <div className="admin-table-wrap" style={{padding:"1.5rem"}}>
        <p style={{color:"var(--text2)",fontSize:"0.875rem",lineHeight:1.6}}>
          Payment integration (Paystack for NG, Stripe elsewhere) is pending. Once wired, this panel will show live revenue breakdown, failed payments, and churn metrics.
        </p>
      </div>
    </div>
  );
}

function Settings({ onCreateAdmin }: { onCreateAdmin:(e:string,p:string)=>Promise<void> }) {
  const [email, setEmail] = useState("");
  const [pass, setPass] = useState("");
  const [msg, setMsg] = useState<{type:"ok"|"err";text:string}|null>(null);
  const [loading, setLoading] = useState(false);

  const create = async () => {
    if (!email || !pass) return;
    setLoading(true); setMsg(null);
    try { await onCreateAdmin(email, pass); setMsg({type:"ok",text:`Admin created: ${email}`}); setEmail(""); setPass(""); }
    catch(e) { setMsg({type:"err",text:e instanceof ApiError ? e.message : "Failed"}); }
    finally { setLoading(false); }
  };

  return (
    <div style={{display:"flex",flexDirection:"column",gap:"1.5rem",maxWidth:520}}>
      <div className="admin-table-wrap" style={{padding:"1.5rem"}}>
        <h3 style={{marginBottom:"1rem",fontSize:"0.95rem",fontWeight:600}}>Create admin user</h3>
        <div className="admin-form">
          <label>Email <input type="email" value={email} onChange={e=>setEmail(e.target.value)} placeholder="admin@provisio.site"/></label>
          <label>Temporary password <input type="password" value={pass} onChange={e=>setPass(e.target.value)} placeholder="Min 8 chars"/></label>
          {msg && <p className={`admin-alert admin-alert-${msg.type==="ok"?"success":"error"}`}>{msg.text}</p>}
          <button className="btn btn-gold" onClick={create} disabled={loading || !email || !pass}>
            {loading ? "Creating…" : "Create admin"}
          </button>
        </div>
      </div>
      <div className="admin-table-wrap" style={{padding:"1.5rem"}}>
        <h3 style={{marginBottom:"0.75rem",fontSize:"0.95rem",fontWeight:600}}>Environment</h3>
        <table style={{fontSize:"0.8rem"}}>
          <tbody>
            {[
              ["API base", import.meta.env.VITE_API_BASE],
              ["Admin key set", import.meta.env.VITE_ADMIN_KEY ? "yes" : "⚠ missing"],
            ].map(([k,v])=>(
              <tr key={k}><td style={{color:"var(--text3)",paddingRight:"1rem",paddingBottom:"0.4rem"}}>{k}</td><td className="mono">{v}</td></tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Shell                                                               */
/* ------------------------------------------------------------------ */

export default function App() {
  const { authed, login, logout } = useAuth();
  const [page, setPage] = useState<Page>("overview");
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const flash = (msg: string, isErr = false) => {
    if (isErr) setErr(msg); else setToast(msg);
    setTimeout(() => { setToast(null); setErr(null); }, 4000);
  };

  useEffect(() => {
    if (authed) api.stats().then(setStats).catch(e => flash(e.message, true));
  }, [authed]);

  const action = async (fn: () => Promise<void>, successMsg: string) => {
    try { await fn(); flash(successMsg); }
    catch (e) { flash(e instanceof ApiError ? e.message : "Error", true); }
  };

  if (!authed) return <Login onLogin={login} />;

  return (
    <div className="admin-shell">
      {/* Sidebar */}
      <nav className="admin-nav">
        <div className="admin-nav-logo">
          <span>Provisio</span>
          <em>CTRL</em>
        </div>
        <div className="admin-nav-section">Management</div>
        {NAV.map(n => (
          <button key={n.page} className={`admin-nav-link ${page===n.page?"active":""}`} onClick={() => setPage(n.page)}>
            <span>{n.icon}</span> {n.label}
          </button>
        ))}
        <div className="admin-nav-footer">
          <div style={{marginBottom:"0.4rem",color:"var(--text2)"}}>Provisio Controller</div>
          <button className="btn btn-ghost btn-sm" onClick={logout}>Sign out</button>
        </div>
      </nav>

      {/* Main */}
      <div className="admin-main">
        <div className="admin-header">
          <h1>{NAV.find(n=>n.page===page)?.label}</h1>
          {stats && (
            <div style={{display:"flex",gap:"1rem",fontSize:"0.8rem",color:"var(--text2)"}}>
              <span>{stats.total_users} users</span>
              <span style={{color:"var(--gold)"}}>${stats.mrr_usd}/mo</span>
            </div>
          )}
        </div>

        {toast && <div className="admin-alert admin-alert-success" style={{margin:"0 2rem"}}>{toast}</div>}
        {err   && <div className="admin-alert admin-alert-error"   style={{margin:"0 2rem"}}>{err}</div>}

        <div className="admin-content">
          {page==="overview" && <Overview stats={stats}/>}
          {page==="users" && (
            <Users
              onGrant={id => action(()=>api.grantAdmin(id), "Admin granted")}
              onRevoke={id => action(()=>api.revokeAdmin(id), "Admin revoked")}
              onGrantPlan={(id,plan) => action(()=>api.grantPlan(id,plan), `${plan} plan granted`)}
              onRevokePlan={id => action(()=>api.revokePlan(id), "Plan revoked")}
            />
          )}
          {page==="usage" && <Usage/>}
          {page==="plans" && <Plans/>}
          {page==="settings" && (
            <Settings onCreateAdmin={(e,p)=>api.createAdminUser(e,p).then(()=>{})}/>
          )}
        </div>
      </div>
    </div>
  );
}
