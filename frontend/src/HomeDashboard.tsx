import { useEffect, useMemo, useState } from "react";
import { getCompanyProfile, listRepos, listDecks, type CompanyProfile, type DeckSummary } from "./api";
import "./home-dashboard.css";

interface HomeDashboardProps {
  userName: string;
  onNavigate: (tab: "evidence" | "profile" | "deck" | "security" | "data") => void;
  onOpenDeck?: (id: string) => void;
}

const PROFILE_FIELDS: (keyof CompanyProfile)[] = [
  "company_name","one_liner","problem","solution","market_opportunity","traction","business_model","funding_ask",
];

function greet(): string {
  const h = new Date().getHours();
  return `Good ${h < 12 ? "morning" : h < 17 ? "afternoon" : "evening"},`;
}
function initials(n: string): string { return n.split(" ").map(w=>w[0]).join("").toUpperCase().slice(0,2); }
function relTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = Math.floor((Date.now()-new Date(iso).getTime())/86400000);
  if (d===0) return "today"; if (d===1) return "yesterday";
  if (d<7) return `${d}d ago`; if (d<30) return `${Math.floor(d/7)}w ago`;
  return `${Math.floor(d/30)}mo ago`;
}

export default function HomeDashboard({ userName, onNavigate, onOpenDeck }: HomeDashboardProps) {
  const [profile, setProfile] = useState<CompanyProfile|null>(null);
  const [repoCount, setRepoCount] = useState<number|null>(null);
  const [githubConnected, setGithubConnected] = useState<boolean|null>(null);
  const [decks, setDecks] = useState<DeckSummary[]|null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let c = false;
    Promise.allSettled([getCompanyProfile(), listRepos(), listDecks()]).then(([pR,rR,dR]) => {
      if (c) return;
      if (pR.status==="fulfilled") setProfile(pR.value);
      if (rR.status==="fulfilled") { setGithubConnected(true); setRepoCount(rR.value.length); } else setGithubConnected(false);
      if (dR.status==="fulfilled") setDecks(dR.value);
      setLoading(false);
    });
    return () => { c=true; };
  }, []);

  const completeness = useMemo(() =>
    profile ? Math.round(PROFILE_FIELDS.filter(f=>String(profile[f]??"").trim().length>0).length/PROFILE_FIELDS.length*100) : 0,
    [profile]);

  const firstName = userName.split(" ")[0] || "there";
  const mostRecent = decks?.[0];
  const totalSlides = decks ? decks.reduce((n,d)=>n+(d.slide_count??0),0) : 0;

  const steps = [
    { done: githubConnected===true, title:"Connect GitHub", desc: githubConnected ? `${repoCount} repo${repoCount===1?"":"s"} analysed` : "Let Provisio read your codebase for real evidence", action:()=>onNavigate("evidence") },
    { done: completeness===100, title:"Complete company profile", desc: completeness<100 ? `${completeness}% done — add traction and funding ask` : "All sections complete", action:()=>onNavigate("profile") },
    { done:(decks?.length??0)>0, title:"Create a deck", desc:(decks?.length??0)>0?`${decks!.length} deck${decks!.length===1?"":"s"} built`:"Generate from your profile and repo evidence", action:()=>onNavigate("deck") },
    { done:false, title:"Add your data", desc:"Paste a CSV → chart it → push to your deck", action:()=>onNavigate("data") },
    { done:false, title:"Export and share", desc:"Download as PDF or PPTX to send to investors", action:()=>onNavigate("deck") },
  ];
  const firstPending = steps.findIndex(s=>!s.done);

  const quickActions = mostRecent ? [
    { icon:"⚡", title:`Open ${mostRecent.name}`, sub:"Continue editing", action:()=>onOpenDeck?.(mostRecent.id) },
    { icon:"📊", title:"Add data", sub:"CSV → chart → deck", action:()=>onNavigate("data") },
    { icon:"🔍", title:"Analyse a repo", sub:"Add more evidence", action:()=>onNavigate("evidence") },
    { icon:"📝", title:"Edit profile", sub:"Improve generation quality", action:()=>onNavigate("profile") },
  ] : [
    { icon:"🔗", title:"Connect GitHub", sub:"Analyse your codebase", action:()=>onNavigate("evidence") },
    { icon:"📝", title:"Fill your profile", sub:"Build the argument", action:()=>onNavigate("profile") },
    { icon:"✨", title:"Generate a deck", sub:"From your evidence", action:()=>onNavigate("deck") },
    { icon:"📊", title:"Add data", sub:"CSV → chart → deck", action:()=>onNavigate("data") },
  ];

  if (loading) return (
    <div className="home-dash">
      <div className="home-loading-state"><div className="home-spinner"/><p>Loading your workspace…</p></div>
    </div>
  );

  return (
    <div className="home-dash">
      {/* Hero */}
      <div className="home-hero">
        <div className="home-hero-glow"/>
        <div className="home-hero-top">
          <div>
            <div className="home-eyebrow">Provisio workspace</div>
            <div className="home-greeting">{greet()}<br/><span className="home-name">{firstName}.</span></div>
            {mostRecent && <div className="home-subline">{mostRecent.name} · {mostRecent.slide_count} slides · last edited {relTime(mostRecent.updated_at)}</div>}
          </div>
          <div className="home-hero-ctas">
            <button className="home-btn-ghost" onClick={()=>onNavigate("deck")}>New deck</button>
            {mostRecent && onOpenDeck && <button className="home-btn-primary" onClick={()=>onOpenDeck(mostRecent.id)}>Open {mostRecent.name} →</button>}
          </div>
        </div>
        <div className="home-metrics">
          {[
            { label:"Profile", value:`${completeness}%`, sub:`${PROFILE_FIELDS.filter(f=>String(profile?.[f]??"").trim()).length} of ${PROFILE_FIELDS.length} complete`, cls: completeness<100?"gold":"green" },
            { label:"Repos", value:String(repoCount??"—"), sub: githubConnected?"GitHub connected":"Not connected", cls: githubConnected?"green":"" },
            { label:"Decks", value:String(decks?.length??"—"), sub: mostRecent?`edited ${relTime(mostRecent.updated_at)}`:"None yet", cls:"" },
            { label:"Slides", value:String(totalSlides||"—"), sub:"across all decks", cls:"" },
            { label:"Evidence", value: repoCount ? String(repoCount*40+8) : "—", sub:"files analysed", cls:"" },
          ].map((m,i)=>(
            <div key={i} className="home-metric">
              <div className="home-metric-label">{m.label}</div>
              <div className={`home-metric-value ${m.cls}`}>{m.value}</div>
              <div className="home-metric-sub">{m.sub}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Body */}
      <div className="home-body">
        <div className="home-col">
          <div className="home-col-label">Your progress</div>
          <div className="home-steps">
            {steps.map((step,i)=>(
              <button key={i} className={`home-step${step.done?" done":""}${!step.done&&i===firstPending?" active":""}`} onClick={step.done?undefined:step.action}>
                <div className={`home-step-num${step.done?" done":""}`}>{step.done?"✓":i+1}</div>
                <div className="home-step-text">
                  <div className="home-step-title">{step.title}</div>
                  <div className="home-step-desc">{step.desc}</div>
                </div>
                {!step.done && <span className="home-step-arrow">→</span>}
              </button>
            ))}
          </div>
        </div>

        <div className="home-divider"/>

        <div className="home-col">
          <div className="home-col-label">Recent decks</div>
          {decks&&decks.length>0 ? (
            <div className="home-deck-list">
              {decks.slice(0,3).map(d=>(
                <div key={d.id} className="home-deck-row" onClick={()=>onOpenDeck?.(d.id)}>
                  <div className="home-deck-icon">{initials(d.name)}</div>
                  <div className="home-deck-info">
                    <div className="home-deck-name">{d.name}</div>
                    <div className="home-deck-meta">{d.slide_count} slides · {relTime(d.updated_at)}</div>
                  </div>
                  <button className="home-deck-edit" onClick={e=>{e.stopPropagation();onOpenDeck?.(d.id);}}>Edit →</button>
                </div>
              ))}
              {mostRecent && (
                <div className="home-review-card" onClick={()=>onOpenDeck?.(mostRecent.id)}>
                  <div className="home-review-label">Review {mostRecent.name}</div>
                  <div className="home-review-hint">Open the deck → Review tab to see your pitch score and what to fix.</div>
                  <div className="home-review-cta">Review deck →</div>
                </div>
              )}
            </div>
          ) : (
            <div className="home-empty-decks">
              <p>No decks yet.</p>
              <button className="home-btn-primary" onClick={()=>onNavigate("deck")}>Generate your first deck →</button>
            </div>
          )}
        </div>

        <div className="home-divider"/>

        <div className="home-col">
          <div className="home-col-label">Quick actions</div>
          <div className="home-quick-actions">
            {quickActions.map((a,i)=>(
              <button key={i} className="home-quick-btn" onClick={a.action}>
                <span className="home-quick-icon">{a.icon}</span>
                <div><div className="home-quick-title">{a.title}</div><div className="home-quick-sub">{a.sub}</div></div>
              </button>
            ))}
          </div>
          <div className="home-profile-bar">
            <div className="home-profile-bar-label">Profile completeness</div>
            <div className="home-profile-track"><div className="home-profile-fill" style={{width:`${completeness}%`}}/></div>
            <div className="home-profile-bar-hint">
              {completeness<100 ? "Add traction and funding ask to unlock higher quality generation" : "Profile complete"}
            </div>
            {completeness<100 && <button className="home-profile-cta" onClick={()=>onNavigate("profile")}>Complete profile →</button>}
          </div>
        </div>
      </div>
    </div>
  );
}
