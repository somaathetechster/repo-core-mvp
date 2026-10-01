import { useEffect, useState, lazy, Suspense } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "./supabaseClient";
import { type AnalyzeResult } from "./api";
import Login from "./Login";
import MfaChallenge from "./MfaChallenge";
import Landing from "./marketing/Landing";
import MfaSettings from "./MfaSettings";
import HomeDashboard from "./HomeDashboard";
import NotificationBanner from "./NotificationBanner";
import SupportWidget from "./SupportWidget";
import BillingPlans from "./BillingPlans";
import ChangePassword from "./ChangePassword";
import "./theme.css";
import "./dashboard.css";

// These three pull in the heaviest dependencies in the app (recharts,
// react-rnd, @dnd-kit, html2canvas), so they're loaded on demand instead of
// bundled into the initial page load. Someone who only ever uses Evidence
// and Home shouldn't have to download charting/drag-and-drop code they
// never touch.
const CompanyProfileForm = lazy(() => import("./CompanyProfileForm"));
const DecksHome = lazy(() => import("./DecksHome"));
const DataStudio = lazy(() => import("./DataStudio"));
const Evidence = lazy(() => import("./Evidence"));
const DeckReview = lazy(() => import("./DeckReview"));

function TabLoading() {
  return <p style={{ padding: "2rem", color: "var(--text-dim)" }}>Loading...</p>;
}

type LoggedOutView = "landing" | "login";
type AalStatus = "checking" | "ok" | "needs-mfa";

export default function App() {
  const [session, setSession] = useState<Session | null | undefined>(undefined); // undefined = still loading
  const [loggedOutView, setLoggedOutView] = useState<LoggedOutView>("landing");
  const [aalStatus, setAalStatus] = useState<AalStatus>("checking");

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: listener } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
    });
    return () => listener.subscription.unsubscribe();
  }, []);

  // Whenever we get a NEW session (a different user, or the first sign-in),
  // check whether it's actually at the assurance level it needs to be. A
  // session exists at aal1 the instant a password check succeeds, even for
  // accounts with 2FA enabled, so this check is what actually keeps the
  // dashboard gated, not anything in Login.tsx.
  //
  // We key this off the user's id rather than the session object itself,
  // because Supabase refreshes the session (a new object, same user) on its
  // own roughly hourly, and re-running this check on every refresh would
  // briefly unmount the dashboard and wipe anything unsaved, like an
  // in-progress company profile edit.
  const [checkedUserId, setCheckedUserId] = useState<string | null>(null);

  useEffect(() => {
    if (!session) {
      setAalStatus("checking");
      setCheckedUserId(null);
      return;
    }
    if (session.user.id === checkedUserId) {
      // Same user as last time we checked (this is just a token refresh) —
      // don't re-run the check or touch aalStatus.
      return;
    }
    setAalStatus("checking");
    const userId = session.user.id;
    supabase.auth.mfa.getAuthenticatorAssuranceLevel().then(({ data, error }) => {
      if (error) {
        // Fail closed: if we can't determine the assurance level, don't show
        // the dashboard.
        setAalStatus("needs-mfa");
        setCheckedUserId(userId);
        return;
      }
      setAalStatus(data.nextLevel === "aal2" && data.currentLevel !== "aal2" ? "needs-mfa" : "ok");
      setCheckedUserId(userId);
    });
  }, [session, checkedUserId]);

  if (session === undefined) {
    return (
      <div className="provisio">
        <p style={{ padding: "2rem", color: "var(--text-dim)" }}>Loading...</p>
      </div>
    );
  }

  if (session === null) {
    return loggedOutView === "login" ? (
      <Login onGoHome={() => setLoggedOutView("landing")} />
    ) : (
      <Landing onTryNow={() => setLoggedOutView("login")} />
    );
  }

  if (aalStatus === "checking") {
    return (
      <div className="provisio">
        <p style={{ padding: "2rem", color: "var(--text-dim)" }}>Checking your session...</p>
      </div>
    );
  }

  if (aalStatus === "needs-mfa") {
    return (
      <MfaChallenge
        onVerified={() => {
          if (session) setCheckedUserId(session.user.id);
          setAalStatus("ok");
        }}
        onGoHome={() => supabase.auth.signOut()}
      />
    );
  }

  // The mailing-list choice was made before the account had a token, so it
  // is synced here the first time a session exists. Guarded so it runs once
  // per browser session rather than on every render.
  if (session && !sessionStorage.getItem("provisio:optin-synced")) {
    sessionStorage.setItem("provisio:optin-synced", "1");
    const optIn = Boolean((session.user.user_metadata as Record<string, unknown>)?.marketing_opt_in);
    fetch(`${import.meta.env.VITE_API_BASE}/me/marketing-optin`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify({ opt_in: optIn, email: session.user.email ?? "" }),
    }).catch(() => { /* not worth blocking sign-in over */ });
  }

  return (
    <Dashboard
      userEmail={session.user.email ?? ""}
      userName={(session.user.user_metadata?.full_name as string | undefined) ?? ""}
      accessToken={session.access_token}
    />
  );
}

type DashTab = "home" | "evidence" | "profile" | "security" | "deck" | "review" | "data" | "billing";

const DASH_TABS: DashTab[] = ["home", "evidence", "profile", "security", "deck", "review", "data", "billing"];
const ACTIVE_TAB_KEY = "provisio:active-tab";

function Dashboard({ userEmail, userName, accessToken }: { userEmail: string; userName: string; accessToken: string }) {
  // Restore the tab the user was on before a refresh. Guarded against stale or
  // invalid stored values.
  const [tab, setTab] = useState<DashTab>(() => {
    try {
      const stored = sessionStorage.getItem(ACTIVE_TAB_KEY);
      if (stored && (DASH_TABS as string[]).includes(stored)) return stored as DashTab;
    } catch { /* sessionStorage unavailable */ }
    return "home";
  });

  // Persist the active tab so a refresh lands back on it.
  useEffect(() => {
    try { sessionStorage.setItem(ACTIVE_TAB_KEY, tab); } catch { /* ignore */ }
  }, [tab]);
  const [analyzedRepos, setAnalyzedRepos] = useState<AnalyzeResult[]>([]);
  const [profileFocusField, setProfileFocusField] = useState<string | null>(null);
  const [welcome, setWelcome] = useState<string | null>(null);

  // Returning from the GitHub install flow lands here with ?status=success.
  // Clear the param and open the Evidence tab, which handles loading repos
  // itself now.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("status") === "success") {
      window.history.replaceState({}, "", window.location.pathname);
      setTab("evidence");
    }
  }, []);

  // Returning from a successful checkout lands here with ?checkout=success.
  // Open the Billing tab so the user sees their new plan, and show a welcome
  // banner naming it. Fulfilment is via webhook, so the plan may take a moment
  // to appear — we read /billing/me for the name, falling back to a generic
  // message if it hasn't landed yet.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("checkout") !== "success") return;
    window.history.replaceState({}, "", window.location.pathname);
    setTab("billing");
    setWelcome("Welcome! Your account has been upgraded.");
    fetch(`${import.meta.env.VITE_API_BASE}/billing/me`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        const name = data?.entitlement?.plan?.name;
        if (name && name !== "Free") setWelcome(`Welcome to ${name}! Your account has been upgraded.`);
      })
      .catch(() => { /* keep the generic welcome */ });
  }, [accessToken]);

  // Stash first (the Decks page is lazy and may not be mounted yet), then
  // notify it in case it already is.
  const openDeck = (id: string, slideIndex?: number) => {
    sessionStorage.setItem("provisio:open-deck", id);
    if (slideIndex != null) sessionStorage.setItem("provisio:open-slide", String(slideIndex));
    else sessionStorage.removeItem("provisio:open-slide");
    setTab("deck");
    window.dispatchEvent(new CustomEvent("provisio:open-deck", { detail: { deckId: id, slideIndex } }));
  };

  const navigateTo = (t: DashTab, focusField?: string) => {
    if (focusField) setProfileFocusField(focusField);
    setTab(t);
  };

  return (
    <div className="provisio dashboard">
      <div className="dash-topbar">
        <button className="brand-mark brand-mark-link" onClick={() => setTab("home")}>
          Provisio
        </button>
        <nav className="dash-tabs">
          <button className={`dash-tab ${tab === "home" ? "dash-tab-active" : ""}`} onClick={() => setTab("home")}>
            Home
          </button>
          <button className={`dash-tab ${tab === "evidence" ? "dash-tab-active" : ""}`} onClick={() => setTab("evidence")}>
            Evidence
          </button>
          <button className={`dash-tab ${tab === "profile" ? "dash-tab-active" : ""}`} onClick={() => setTab("profile")}>
            Company profile
          </button>
          <button className={`dash-tab ${tab === "deck" ? "dash-tab-active" : ""}`} onClick={() => setTab("deck")}>
            Deck
          </button>
          <button className={`dash-tab ${tab === "review" ? "dash-tab-active" : ""}`} onClick={() => setTab("review")}>
            Review
          </button>
          <button className={`dash-tab ${tab === "data" ? "dash-tab-active" : ""}`} onClick={() => setTab("data")}>
            Data
          </button>
          <button className={`dash-tab ${tab === "security" ? "dash-tab-active" : ""}`} onClick={() => setTab("security")}>
            Security
          </button>
          <button className={`dash-tab ${tab === "billing" ? "dash-tab-active" : ""}`} onClick={() => setTab("billing")}>
            Billing
          </button>
        </nav>
        <div className="dash-user">
          <a className="dash-domani" href="https://www.domanimedia.com" target="_blank" rel="noopener noreferrer">
            Powered by Domani
          </a>
          <span className="dash-email">{userName || userEmail}</span>
          <button className="p-btn p-btn-ghost" onClick={() => supabase.auth.signOut()}>
            Log out
          </button>
        </div>
      </div>

      {welcome && (
        <div className="checkout-welcome" role="status">
          <span className="checkout-welcome-icon">✦</span>
          <span className="checkout-welcome-msg">{welcome}</span>
          <button className="checkout-welcome-close" onClick={() => setWelcome(null)} aria-label="Dismiss">✕</button>
        </div>
      )}

      <NotificationBanner accessToken={accessToken} />
      <SupportWidget accessToken={accessToken} />

      {tab === "profile" && (
        <Suspense fallback={<TabLoading />}>
          <CompanyProfileForm
            focusField={profileFocusField}
            onFocusHandled={() => setProfileFocusField(null)}
          />
        </Suspense>
      )}

      {tab === "deck" && (
        <Suspense fallback={<TabLoading />}>
          <DecksHome analyzedRepos={analyzedRepos} />
        </Suspense>
      )}

      {tab === "review" && (
        <Suspense fallback={<TabLoading />}>
          <DeckReview onOpenDeck={openDeck} onNavigate={navigateTo} />
        </Suspense>
      )}

      {tab === "billing" && (
        <div className="dash-body">
          <BillingPlans accessToken={accessToken} />
        </div>
      )}

      {tab === "data" && (
        <Suspense fallback={<TabLoading />}>
          <DataStudio />
        </Suspense>
      )}

      {tab === "security" && (
        <div className="dash-body">
          <ChangePassword email={userEmail} />
          <MfaSettings />
        </div>
      )}

      {tab === "home" && (
        <div className="dash-body">
          <HomeDashboard
            userName={userName}
            onNavigate={(t) => setTab(t)}
            onOpenDeck={openDeck}
          />
        </div>
      )}

      {tab === "evidence" && (
        <Suspense fallback={<TabLoading />}>
          <Evidence
            onAnalyzed={(res) => {
              // Keep analysed repos available to the deck builder, which
              // uses them as the evidence source when generating slides.
              setAnalyzedRepos((prev) => [
                ...prev.filter((r) => r.summary.full_name !== res.summary.full_name),
                res as unknown as AnalyzeResult,
              ]);
            }}
          />
        </Suspense>
      )}
    </div>
  );
}
