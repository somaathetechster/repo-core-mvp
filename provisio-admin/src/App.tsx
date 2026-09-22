import { useState, useEffect, useCallback, useRef } from "react";
import { api, type AdminUser, type AdminStats, type AdminUsageRow, type SupportThread, type SupportMessage, type MailingEntry, ApiError } from "./api";

/* ── Auth ──────────────────────────────────────────────────── */
function useAuth() {
  const [authed, setAuthed] = useState(() => !!sessionStorage.getItem("admin-authed"));
  const login = (key: string) => {
    if (key === import.meta.env.VITE_ADMIN_KEY) { sessionStorage.setItem("admin-authed","1"); setAuthed(true); return true; }
    return false;
  };
  const logout = () => { sessionStorage.removeItem("admin-authed"); setAuthed(false); };
  return { authed, login, logout };
}

function Login({ onLogin }: { onLogin:(k:string)=>boolean }) {
  const [key,setKey] = useState(""); const [err,setErr] = useState("");
  const submit = () => { if (!onLogin(key)) setErr("Invalid key"); };
  return (
    <div className="admin-login">
      <div className="admin-login-box">
        <div className="admin-login-logo">Provisio <em>Controller</em></div>
        <p style={{fontSize:".8rem",color:"var(--text2)",textAlign:"center",lineHeight:1.5}}>
          Admin access only. Enter your controller key to continue.
        </p>
        <label style={{display:"flex",flexDirection:"column",gap:".35rem",fontSize:".8rem",color:"var(--text2)"}}>
          Controller key
          <input type="password" value={key} autoFocus
            onChange={e=>setKey(e.target.value)}
            onKeyDown={e=>e.key==="Enter"&&submit()} />
        </label>
        {err && <p className="admin-alert admin-alert-error">{err}</p>}
        <button className="btn btn-gold" onClick={submit}>Enter</button>
      </div>
    </div>
  );
}

/* ── Helpers ──────────────────────────────────────────────── */
type Page = "overview"|"users"|"support"|"mailing"|"usage"|"plans"|"settings";
const NAV: {page:Page;label:string;icon:string}[] = [
  {page:"overview",label:"Overview",icon:"◈"},
  {page:"users",   label:"Users",   icon:"◉"},
  {page:"support", label:"Support", icon:"✉"},
  {page:"mailing", label:"Mailing list", icon:"◫"},
  {page:"usage",   label:"Usage",   icon:"◎"},
  {page:"plans",   label:"Plans",   icon:"◆"},
  {page:"settings",label:"Settings",icon:"⊙"},
];

function relTime(iso:string|null|undefined):string {
  if(!iso) return "—";
  const d=Math.floor((Date.now()-new Date(iso).getTime())/86400000);
  if(d===0) return "today"; if(d===1) return "yesterday";
  if(d<7) return `${d}d ago`; if(d<30) return `${Math.floor(d/7)}w ago`;
  return `${Math.floor(d/30)}mo ago`;
}

function PlanBadge({plan}:{plan:string}) {
  const cls = plan==="monthly"||plan==="yearly" ? "badge-gold"
    : plan==="one_time"||plan==="single" ? "badge-blue" : "badge-gray";
  return <span className={`badge ${cls}`}>{plan.replace("_"," ")}</span>;
}

function StatCard({label,value,sub,cls=""}:{label:string;value:string|number;sub?:string;cls?:string}) {
  return (
    <div className={`admin-card ${cls}`}>
      <div className="admin-card-label">{label}</div>
      <div className="admin-card-value">{value}</div>
      {sub && <div className="admin-card-sub">{sub}</div>}
    </div>
  );
}

/* ── Overview ──────────────────────────────────────────────── */
function Overview({stats}:{stats:AdminStats|null}) {
  if(!stats) return <div className="loading-row"><div className="spinner"/></div>;
  const paidPct = stats.total_users ? Math.round(stats.paying_users/stats.total_users*100) : 0;
  const activePct = stats.total_users ? Math.round(stats.active_7d/stats.total_users*100) : 0;
  return (
    <>
      <div className="admin-cards">
        <StatCard label="Total users"  value={stats.total_users}  sub={`${activePct}% active this week`} />
        <StatCard label="Active 7d"    value={stats.active_7d}    sub={`${activePct}% of users`} cls="green" />
        <StatCard label="Paying users" value={stats.paying_users} sub={`${paidPct}% conversion`} cls="gold" />
        <StatCard label="MRR"          value={`$${stats.mrr_usd}`} sub="recurring monthly" cls="gold" />
        <StatCard label="Total decks"  value={stats.total_decks}  sub={`~${(stats.total_decks/Math.max(stats.total_users,1)).toFixed(1)} per user`} cls="blue" />
        <StatCard label="Exports"      value={stats.total_exports} sub="lifetime" />
      </div>
      <div className="admin-table-wrap">
        <div className="admin-table-header"><span className="admin-table-title">Conversion funnel</span></div>
        <div style={{padding:"1.5rem",display:"flex",flexDirection:"column",gap:"1rem"}}>
          {[
            {label:"Signed up",     n:stats.total_users,    max:stats.total_users},
            {label:"Active 7d",     n:stats.active_7d,      max:stats.total_users},
            {label:"Built a deck",  n:stats.total_decks,    max:stats.total_users},
            {label:"Paying",        n:stats.paying_users,   max:stats.total_users},
            {label:"Exported",      n:stats.total_exports,  max:stats.total_users},
          ].map(r=>(
            <div key={r.label} style={{display:"grid",gridTemplateColumns:"140px 1fr 60px",alignItems:"center",gap:"1rem"}}>
              <span style={{fontSize:".8rem",color:"var(--text2)"}}>{r.label}</span>
              <div style={{height:"6px",background:"var(--bg3)",borderRadius:"3px",overflow:"hidden"}}>
                <div style={{height:"100%",width:`${Math.round(r.n/Math.max(r.max,1)*100)}%`,background:"var(--gold)",borderRadius:"3px"}}/>
              </div>
              <span style={{fontSize:".78rem",color:"var(--text)",textAlign:"right"}}>{r.n}</span>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

/* ── Users ─────────────────────────────────────────────────── */
function GrantPlanModal({user,onClose,onGrant}:{user:AdminUser;onClose:()=>void;onGrant:(plan:string)=>void}) {
  const plans = [
    {id:"monthly",  name:"Monthly",      price:"$30/mo",  desc:"Unlimited exports, monthly billing"},
    {id:"yearly",   name:"Yearly",       price:"$99/yr",  desc:"Unlimited exports, best value"},
    {id:"one_time", name:"Single export",price:"$10",     desc:"One export credit, no renewal"},
  ];
  const [selected, setSelected] = useState("monthly");
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-box" onClick={e=>e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-title">Grant plan to {user.email}</div>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        <p style={{fontSize:".8rem",color:"var(--text2)",marginBottom:"1.25rem",lineHeight:1.5}}>
          This will immediately activate the plan and send the user a notification banner in the app.
        </p>
        <div className="plan-options">
          {plans.map(p=>(
            <label key={p.id} className={`plan-option ${selected===p.id?"selected":""}`}>
              <input type="radio" name="plan" value={p.id} checked={selected===p.id} onChange={()=>setSelected(p.id)}/>
              <div className="plan-option-body">
                <div className="plan-option-name">{p.name}</div>
                <div className="plan-option-desc">{p.desc}</div>
              </div>
              <div className="plan-option-price">{p.price}</div>
            </label>
          ))}
        </div>
        <div className="modal-footer">
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-gold" onClick={()=>onGrant(selected)}>Grant {plans.find(p=>p.id===selected)?.name}</button>
        </div>
      </div>
    </div>
  );
}

function Users({flash}:{flash:(m:string,e?:boolean)=>void}) {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(true);
  const [grantTarget, setGrantTarget] = useState<AdminUser|null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async (query?:string) => {
    setLoading(true);
    try { setUsers(await api.users(query)); }
    catch(e) { flash(e instanceof ApiError ? e.message : "Failed to load users", true); }
    finally { setLoading(false); }
  }, []);

  useEffect(()=>{ load(); },[load]);

  const doGrant = async (plan:string) => {
    if (!grantTarget) return;
    const target = grantTarget; setGrantTarget(null);
    try {
      await api.grantPlan(target.user_id, plan);
      flash(`${plan.replace("_"," ")} plan granted to ${target.email}. User has been notified.`);
      load(q||undefined);
    } catch(e) { flash(e instanceof ApiError ? e.message : "Grant failed", true); }
  };

  const doRevoke = async (u:AdminUser) => {
    if(!window.confirm(`Revoke ${u.email}'s plan?`)) return;
    try { await api.revokePlan(u.user_id); flash("Plan revoked"); load(q||undefined); }
    catch(e) { flash(e instanceof ApiError ? e.message : "Revoke failed", true); }
  };

  const doToggleAdmin = async (u:AdminUser) => {
    try {
      if(u.is_admin) { await api.revokeAdmin(u.user_id); flash("Admin revoked"); }
      else { await api.grantAdmin(u.user_id); flash("Admin granted"); }
      load(q||undefined);
    } catch(e) { flash(e instanceof ApiError ? e.message : "Error", true); }
  };

  return (
    <>
      {grantTarget && <GrantPlanModal user={grantTarget} onClose={()=>setGrantTarget(null)} onGrant={doGrant}/>}
      <div className="admin-table-wrap">
        <div className="admin-table-header">
          <span className="admin-table-title">Users ({users.length})</span>
          <div className="admin-search">
            <input ref={inputRef} placeholder="Search email…" value={q}
              onChange={e=>setQ(e.target.value)}
              onKeyDown={e=>e.key==="Enter"&&load(q)} />
            <button className="btn btn-ghost btn-sm" onClick={()=>load(q)}>Search</button>
            <button className="btn btn-ghost btn-sm" onClick={()=>{ setQ(""); load(); }}>Clear</button>
          </div>
        </div>
        {loading ? <div className="loading-row"><div className="spinner"/></div> : (
          <table>
            <thead><tr>
              <th>Email</th><th>Plan</th><th>Decks</th><th>Exports</th><th>Joined</th><th>Role</th><th>Actions</th>
            </tr></thead>
            <tbody>
              {users.length===0 && <tr><td colSpan={7} className="admin-empty">No users found</td></tr>}
              {users.map(u=>(
                <tr key={u.user_id}>
                  <td>
                    <div style={{fontWeight:500}}>{u.email}</div>
                    <div className="mono" style={{color:"var(--text3)",fontSize:".69rem"}}>{u.user_id.slice(0,14)}…</div>
                  </td>
                  <td><PlanBadge plan={u.plan}/></td>
                  <td>{u.deck_count}</td>
                  <td>{u.export_count}</td>
                  <td style={{whiteSpace:"nowrap"}}>{relTime(u.joined)}</td>
                  <td>{u.is_admin ? <span className="badge badge-gold">Admin</span> : <span className="badge badge-gray">User</span>}</td>
                  <td>
                    <div className="action-row">
                      <button className="btn btn-gold btn-sm" onClick={()=>setGrantTarget(u)}>Grant plan</button>
                      {u.plan!=="free" && <button className="btn btn-ghost btn-sm" onClick={()=>doRevoke(u)}>Revoke plan</button>}
                      <button className={`btn btn-sm ${u.is_admin?"btn-danger":"btn-ghost"}`} onClick={()=>doToggleAdmin(u)}>
                        {u.is_admin?"Revoke admin":"Make admin"}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}

/* ── Usage ─────────────────────────────────────────────────── */
function Usage() {
  const [rows, setRows] = useState<AdminUsageRow[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(()=>{ api.usage().then(setRows).catch(console.error).finally(()=>setLoading(false)); },[]);
  const maxE = Math.max(1,...rows.map(r=>r.exports_used));
  return (
    <div className="admin-table-wrap">
      <div className="admin-table-header"><span className="admin-table-title">Usage by period</span></div>
      {loading ? <div className="loading-row"><div className="spinner"/></div> : (
        <table>
          <thead><tr><th>Email</th><th>Period</th><th>Plan</th><th>Decks</th><th>Exports</th></tr></thead>
          <tbody>
            {rows.length===0 && <tr><td colSpan={5} className="admin-empty">No usage data</td></tr>}
            {rows.map((r,i)=>(
              <tr key={i}>
                <td>{r.email}</td>
                <td className="mono">{r.period}</td>
                <td><PlanBadge plan={r.plan}/></td>
                <td>{r.decks_created}</td>
                <td>
                  <div style={{display:"flex",alignItems:"center",gap:".75rem"}}>
                    <div style={{flex:1,height:"5px",background:"var(--bg3)",borderRadius:"3px",overflow:"hidden"}}>
                      <div style={{height:"100%",width:`${r.exports_used/maxE*100}%`,background:"var(--gold)",borderRadius:"3px"}}/>
                    </div>
                    <span style={{width:"2rem",textAlign:"right",fontSize:".78rem"}}>{r.exports_used}</span>
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

/* ── Plans ─────────────────────────────────────────────────── */
function Plans() {
  return (
    <div style={{display:"flex",flexDirection:"column",gap:"1.5rem"}}>
      <div className="admin-cards">
        {[
          {name:"Free",   price:"$0",      features:"Preview only, no export",   cls:"badge-gray"},
          {name:"Single", price:"$10",     features:"1 export credit",            cls:"badge-blue"},
          {name:"Monthly",price:"$30/mo",  features:"Unlimited, monthly billing", cls:"badge-gold"},
          {name:"Yearly", price:"$99/yr",  features:"Unlimited, best value",      cls:"badge-gold"},
        ].map(p=>(
          <div key={p.name} className="admin-card">
            <div style={{display:"flex",justifyContent:"space-between",marginBottom:".5rem"}}>
              <span className="admin-card-label">{p.name}</span>
              <span className={`badge ${p.cls}`}>{p.name}</span>
            </div>
            <div className="admin-card-value" style={{fontSize:"1.5rem"}}>{p.price}</div>
            <div className="admin-card-sub">{p.features}</div>
          </div>
        ))}
      </div>
      <div className="admin-table-wrap" style={{padding:"1.5rem"}}>
        <div className="admin-table-title" style={{marginBottom:".75rem"}}>Payment integration status</div>
        <p style={{color:"var(--text2)",fontSize:".875rem",lineHeight:1.6}}>
          Paystack (NG) and Stripe (international) integration is pending. Once wired, this panel will show live revenue breakdown, failed payments, refunds, and churn metrics.
        </p>
        <div style={{marginTop:"1rem",display:"flex",gap:".5rem"}}>
          <span className="badge badge-gray">Paystack — pending</span>
          <span className="badge badge-gray">Stripe — pending</span>
        </div>
      </div>
    </div>
  );
}

/* ── Settings ──────────────────────────────────────────────── */
function Settings({flash}:{flash:(m:string,e?:boolean)=>void}) {
  const [email,setEmail] = useState(""); const [pass,setPass] = useState("");
  const [loading,setLoading] = useState(false);

  const create = async () => {
    if(!email||!pass) return; setLoading(true);
    try {
      await api.createAdminUser(email,pass);
      flash(`Admin user created: ${email}`);
      setEmail(""); setPass("");
    } catch(e) { flash(e instanceof ApiError ? e.message : "Failed", true); }
    finally { setLoading(false); }
  };

  return (
    <div style={{display:"flex",flexDirection:"column",gap:"1.5rem",maxWidth:520}}>
      <div className="admin-table-wrap" style={{padding:"1.5rem"}}>
        <h3 style={{marginBottom:"1rem",fontSize:".95rem",fontWeight:600}}>Create admin user</h3>
        <div className="admin-form">
          <label>Email<input type="email" value={email} onChange={e=>setEmail(e.target.value)} placeholder="admin@example.com"/></label>
          <label>Temporary password<input type="password" value={pass} onChange={e=>setPass(e.target.value)} placeholder="Min 8 chars"/></label>
          <button className="btn btn-gold" onClick={create} disabled={loading||!email||!pass}>
            {loading?"Creating…":"Create admin"}
          </button>
        </div>
      </div>
      <div className="admin-table-wrap" style={{padding:"1.5rem"}}>
        <h3 style={{marginBottom:".75rem",fontSize:".95rem",fontWeight:600}}>Environment</h3>
        <table style={{fontSize:".8rem"}}>
          <tbody>
            {[["API base",import.meta.env.VITE_API_BASE],["Admin key set",import.meta.env.VITE_ADMIN_KEY?"✓ set":"⚠ missing"]].map(([k,v])=>(
              <tr key={k}><td style={{color:"var(--text3)",paddingRight:"1rem",paddingBottom:".4rem"}}>{k}</td><td className="mono">{v}</td></tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}


/* ── Support inbox ─────────────────────────────────────────── */
function Support({flash}:{flash:(m:string,e?:boolean)=>void}) {
  const [threads, setThreads] = useState<SupportThread[]>([]);
  const [activeId, setActiveId] = useState<string|null>(null);
  const [messages, setMessages] = useState<SupportMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  const loadThreads = useCallback(async () => {
    try { setThreads(await api.threads()); } catch { /* transient */ }
  }, []);

  const loadThread = useCallback(async (id: string) => {
    try { setMessages(await api.thread(id)); } catch { /* transient */ }
  }, []);

  // Poll both lists while the window is visible, so a founder writing in
  // appears without the operator refreshing.
  useEffect(() => {
    const tick = () => {
      if (document.hidden) return;
      loadThreads();
      if (activeId) loadThread(activeId);
    };
    tick();
    const t = setInterval(tick, 5000);
    return () => clearInterval(t);
  }, [activeId, loadThreads, loadThread]);

  useEffect(() => { endRef.current?.scrollIntoView({behavior:"smooth"}); }, [messages]);

  const open = (id: string) => { setActiveId(id); setMessages([]); loadThread(id); };

  const send = async () => {
    const body = draft.trim();
    if (!body || !activeId || sending) return;
    setSending(true);
    try {
      const saved = await api.reply(activeId, body);
      setMessages(m => [...m, saved]);
      setDraft("");
      loadThreads();
    } catch(e) { flash(e instanceof ApiError ? e.message : "Reply failed", true); }
    finally { setSending(false); }
  };

  const active = threads.find(t => t.user_id === activeId);
  const totalUnread = threads.reduce((n,t) => n + t.unread, 0);

  return (
    <div className="sup-wrap">
      <div className="sup-list">
        <div className="sup-list-head">
          Conversations
          {totalUnread > 0 && <span className="badge badge-red">{totalUnread} unread</span>}
        </div>
        {threads.length === 0 && <div className="admin-empty" style={{padding:"2rem 1rem"}}>No messages yet</div>}
        {threads.map(t => (
          <button key={t.user_id}
            className={`sup-thread ${activeId===t.user_id?"is-active":""}`}
            onClick={() => open(t.user_id)}>
            <div className="sup-thread-top">
              <span className="sup-thread-email">{t.email}</span>
              {t.unread > 0 && <span className="sup-dot" />}
            </div>
            <div className="sup-thread-last">
              {t.last_sender === "admin" && <em>You: </em>}{t.last_message}
            </div>
            <div className="sup-thread-meta">{t.last_at ? relTime(t.last_at) : ""} · {t.messages} messages</div>
          </button>
        ))}
      </div>

      <div className="sup-convo">
        {!activeId ? (
          <div className="admin-empty">Pick a conversation to read and reply.</div>
        ) : (
          <>
            <div className="sup-convo-head">
              <div>
                <div style={{fontWeight:600}}>{active?.email}</div>
                <div className="mono" style={{fontSize:".68rem",color:"var(--text3)"}}>{activeId}</div>
              </div>
            </div>
            <div className="sup-msgs">
              {messages.map(m => (
                <div key={m.id} className={`sup-msg sup-${m.sender}`}>
                  <div className="sup-bubble">{m.body}</div>
                  <div className="sup-time">
                    {m.sender==="admin"?"You":"Them"}
                    {m.created_at && ` · ${new Date(m.created_at).toLocaleString([], {month:"short",day:"numeric",hour:"2-digit",minute:"2-digit"})}`}
                  </div>
                </div>
              ))}
              <div ref={endRef}/>
            </div>
            <div className="sup-compose">
              <textarea rows={2} placeholder="Write a reply…" value={draft}
                onChange={e=>setDraft(e.target.value)}
                onKeyDown={e=>{ if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();send();} }}/>
              <button className="btn btn-gold" onClick={send} disabled={!draft.trim()||sending}>
                {sending?"…":"Reply"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/* ── Mailing list ──────────────────────────────────────────── */
function Mailing({flash}:{flash:(m:string,e?:boolean)=>void}) {
  const [rows, setRows] = useState<MailingEntry[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(()=>{ api.mailingList().then(setRows).catch(()=>{}).finally(()=>setLoading(false)); },[]);

  const copy = () => {
    navigator.clipboard.writeText(rows.map(r=>r.email).join(", "))
      .then(()=>flash(`${rows.length} addresses copied`))
      .catch(()=>flash("Couldn't copy", true));
  };
  const csv = () => {
    const blob = new Blob(["email,name\n" + rows.map(r=>`${r.email},${(r.name??"").replace(/,/g,"")}`).join("\n")],
      {type:"text/csv"});
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `provisio-mailing-list-${new Date().toISOString().slice(0,10)}.csv`;
    a.click();
  };

  return (
    <div className="admin-table-wrap">
      <div className="admin-table-header">
        <span className="admin-table-title">Opted in ({rows.length})</span>
        <div style={{display:"flex",gap:".5rem"}}>
          <button className="btn btn-ghost btn-sm" onClick={copy} disabled={!rows.length}>Copy addresses</button>
          <button className="btn btn-gold btn-sm" onClick={csv} disabled={!rows.length}>Export CSV</button>
        </div>
      </div>
      {loading ? <div className="loading-row"><div className="spinner"/></div> : (
        <table>
          <thead><tr><th>Email</th><th>Name</th></tr></thead>
          <tbody>
            {rows.length===0 && <tr><td colSpan={2} className="admin-empty">Nobody has opted in yet.</td></tr>}
            {rows.map(r=>(<tr key={r.user_id}><td>{r.email}</td><td>{r.name ?? "—"}</td></tr>))}
          </tbody>
        </table>
      )}
    </div>
  );
}

/* ── Shell ─────────────────────────────────────────────────── */
export default function App() {
  const {authed,login,logout} = useAuth();
  const [page,setPage] = useState<Page>("overview");
  const [stats,setStats] = useState<AdminStats|null>(null);
  const [toasts,setToasts] = useState<{id:number;msg:string;err:boolean}[]>([]);
  let toastId = 0;

  const flash = (msg:string,err=false) => {
    const id = ++toastId;
    setToasts(t=>[...t,{id,msg,err}]);
    setTimeout(()=>setToasts(t=>t.filter(x=>x.id!==id)),4500);
  };

  useEffect(()=>{ if(authed) api.stats().then(setStats).catch(e=>flash(e.message,true)); },[authed]);

  if(!authed) return <Login onLogin={login}/>;

  return (
    <div className="admin-shell">
      {/* Toast stack */}
      <div className="toast-stack">
        {toasts.map(t=>(
          <div key={t.id} className={`toast ${t.err?"toast-err":"toast-ok"}`}>
            {t.msg}
            <button onClick={()=>setToasts(x=>x.filter(i=>i.id!==t.id))}>✕</button>
          </div>
        ))}
      </div>

      {/* Sidebar */}
      <nav className="admin-nav">
        <div className="admin-nav-logo"><span>Provisio</span><em>CTRL</em></div>
        <div className="admin-nav-section">Management</div>
        {NAV.map(n=>(
          <button key={n.page} className={`admin-nav-link ${page===n.page?"active":""}`} onClick={()=>setPage(n.page)}>
            <span>{n.icon}</span>{n.label}
          </button>
        ))}
        <div className="admin-nav-footer">
          <div style={{marginBottom:".4rem",fontSize:".75rem",color:"var(--text3)"}}>Provisio Controller</div>
          <button className="btn btn-ghost btn-sm" onClick={logout}>Sign out</button>
        </div>
      </nav>

      {/* Main */}
      <div className="admin-main">
        <div className="admin-header">
          <div>
            <h1>{NAV.find(n=>n.page===page)?.label}</h1>
            <div style={{fontSize:".75rem",color:"var(--text3)",marginTop:".2rem"}}>
              {new Date().toLocaleDateString(undefined,{weekday:"long",month:"long",day:"numeric"})}
            </div>
          </div>
          {stats && (
            <div style={{display:"flex",gap:"1.5rem",fontSize:".82rem"}}>
              <span style={{color:"var(--text2)"}}><span style={{color:"var(--text)",fontWeight:600}}>{stats.total_users}</span> users</span>
              <span style={{color:"var(--text2)"}}><span style={{color:"var(--gold)",fontWeight:600}}>${stats.mrr_usd}</span>/mo</span>
              <span style={{color:"var(--text2)"}}><span style={{color:"var(--text)",fontWeight:600}}>{stats.active_7d}</span> active 7d</span>
            </div>
          )}
        </div>
        <div className="admin-content">
          {page==="overview" && <Overview stats={stats}/>}
          {page==="users"    && <Users flash={flash}/>}
          {page==="support"  && <Support flash={flash}/>}
          {page==="mailing"  && <Mailing flash={flash}/>}
          {page==="usage"    && <Usage/>}
          {page==="plans"    && <Plans/>}
          {page==="settings" && <Settings flash={flash}/>}
        </div>
      </div>
    </div>
  );
}
