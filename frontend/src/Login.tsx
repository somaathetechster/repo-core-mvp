import { useState } from "react";
import { supabase } from "./supabaseClient";
import "./theme.css";
import "./auth.css";

interface LoginProps {
  onGoHome: () => void;
}

export default function Login({ onGoHome }: LoginProps) {
  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [error, setError] = useState<string | null>(null);
  const [signupSent, setSignupSent] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      if (mode === "login") {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) setError(error.message);
        // If this account has 2FA enabled, App.tsx's AAL check will catch
        // the resulting aal1 session and show the code prompt before any
        // dashboard content renders. We don't check AAL here to avoid a
        // race between this component's own state and App's session
        // listener, which could otherwise let the dashboard flash briefly.
      } else {
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: { data: { full_name: fullName } },
        });
        if (error) setError(error.message);
        else setSignupSent(true);
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="provisio auth-screen">
      <div className="auth-card">
        <button className="brand-mark auth-brand auth-brand-link" onClick={onGoHome}>
          Provisio
        </button>

        {signupSent ? (
          <div className="auth-confirm">
            <h2>Check your email</h2>
            <p>
              We sent a confirmation link to <strong>{email}</strong>. Click it to
              activate your account, then log in below.
            </p>
            <button className="p-btn p-btn-secondary" onClick={() => { setSignupSent(false); setMode("login"); }}>
              Back to log in
            </button>
          </div>
        ) : (
          <>
            <h2>{mode === "login" ? "Welcome back" : "Create your account"}</h2>
            <p className="auth-sub">
              {mode === "login"
                ? "Log in to pick up where you left off."
                : "Start turning what you've built into a sourced deck."}
            </p>

            <form onSubmit={handleSubmit} className="auth-form">
              {mode === "signup" && (
                <input
                  className="p-input"
                  type="text"
                  placeholder="Full name"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  required
                />
              )}
              <input
                className="p-input"
                type="email"
                placeholder="Email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
              <input
                className="p-input"
                type="password"
                placeholder="Password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={6}
              />
              {error && <p className="p-error">{error}</p>}
              <button className="p-btn p-btn-primary" type="submit" disabled={loading}>
                {loading ? "Working..." : mode === "login" ? "Log in" : "Sign up"}
              </button>
            </form>

            <button
              className="p-btn p-btn-ghost auth-switch"
              onClick={() => setMode(mode === "login" ? "signup" : "login")}
            >
              {mode === "login" ? "Need an account? Sign up" : "Already have an account? Log in"}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
