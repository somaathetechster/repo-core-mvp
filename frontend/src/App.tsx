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

  return (
    <Dashboard
      userEmail={session.user.email ?? ""}
      userName={(session.user.user_metadata?.full_name as string | undefined) ?? ""}
      accessToken={session.access_token}
    />
  );
}

type DashTab = "home" | "evidence" | "profile" | "security" | "deck" | "review" | "data";

function Dashboard({ userEmail, userName, accessToken }: { userEmail: string; userName: string; accessToken: string }) {
  const [tab, setTab] = useState<DashTab>("home");
  const [analyzedRepos, setAnalyzedRepos] = useState<AnalyzeResult[]>([]);

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

  // Stash first (the Decks page is lazy and may not be mounted yet), then
  // notify it in case it already is.
  const openDeck = (id: string) => {
    sessionStorage.setItem("provisio:open-deck", id);
    setTab("deck");
    window.dispatchEvent(new CustomEvent("provisio:open-deck", { detail: { deckId: id } }));
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

      <NotificationBanner accessToken={accessToken} />

      {tab === "profile" && (
        <Suspense fallback={<TabLoading />}>
          <CompanyProfileForm />
        </Suspense>
      )}

      {tab === "deck" && (
        <Suspense fallback={<TabLoading />}>
          <DecksHome analyzedRepos={analyzedRepos} />
        </Suspense>
      )}

      {tab === "review" && (
        <Suspense fallback={<TabLoading />}>
          <DeckReview onOpenDeck={openDeck} />
        </Suspense>
      )}

      {tab === "data" && (
        <Suspense fallback={<TabLoading />}>
          <DataStudio />
        </Suspense>
      )}

      {tab === "security" && (
        <div className="dash-body">
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
