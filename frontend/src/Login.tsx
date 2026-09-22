import { useState } from "react";
import { supabase } from "./supabaseClient";
import "./theme.css";
import "./auth.css";

interface LoginProps {
  onGoHome: () => void;
}

/**
 * Sign in, sign up, and password recovery.
 *
 * Both email flows are code-based rather than link-based. A six-digit code
 * works when the founder opens their email on a different device from the
 * one they signed up on, which a magic link does not, and it keeps them on
 * the page they started from.
 *
 * This requires the matching Supabase email templates to send `{{ .Token }}`.
 * If a template still sends a link, the link keeps working — the code box
 * simply won't be used.
 */
type Mode = "login" | "signup" | "verify" | "forgot" | "reset";

export default function Login({ onGoHome }: LoginProps) {
  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [mode, setMode] = useState<Mode>("login");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [optIn, setOptIn] = useState(true);
  const [loading, setLoading] = useState(false);

  const go = (next: Mode) => { setMode(next); setError(null); setNotice(null); };

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);
    setLoading(true);
    try {
      if (mode === "login") {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) setError(error.message);
        // If this account has 2FA enabled, App.tsx's AAL check catches the
        // resulting aal1 session and shows the code prompt before any
        // dashboard content renders.
      }

      else if (mode === "signup") {
        const { error } = await supabase.auth.signUp({
          email,
          password,
          // The account isn't confirmed yet, so there's no token to call our
          // API with. The mailing-list choice rides along in metadata and is
          // synced the first time the founder signs in.
          options: { data: { full_name: fullName, marketing_opt_in: optIn } },
        });
        if (error) setError(error.message);
        else { setCode(""); go("verify"); }
      }

      else if (mode === "verify") {
        const { error } = await supabase.auth.verifyOtp({
          email, token: code.trim(), type: "signup",
        });
        if (error) setError(error.message);
        // On success the session listener in App.tsx takes over.
      }

      else if (mode === "forgot") {
        const { error } = await supabase.auth.resetPasswordForEmail(email);
        if (error) setError(error.message);
        else { setCode(""); setPassword(""); go("reset"); }
      }

      else if (mode === "reset") {
        // Verifying the recovery code signs the founder in, which is what
        // authorises the password change that follows.
        const { error: otpError } = await supabase.auth.verifyOtp({
          email, token: code.trim(), type: "recovery",
        });
        if (otpError) { setError(otpError.message); return; }

        const { error: updateError } = await supabase.auth.updateUser({ password });
        if (updateError) setError(updateError.message);
      }
    } finally {
      setLoading(false);
    }
  }

  async function resend() {
    setError(null);
    setLoading(true);
    try {
      const { error } =
        mode === "verify"
          ? await supabase.auth.resend({ type: "signup", email })
          : await supabase.auth.resetPasswordForEmail(email);
      if (error) setError(error.message);
      else setNotice("Sent again. It can take a minute to arrive.");
    } finally {
      setLoading(false);
    }
  }

  const heading =
    mode === "login" ? "Welcome back"
    : mode === "signup" ? "Create your account"
    : mode === "verify" ? "Confirm your email"
    : mode === "forgot" ? "Reset your password"
    : "Choose a new password";

  const sub =
    mode === "login" ? "Log in to pick up where you left off."
    : mode === "signup" ? "Start turning what you've built into a sourced deck."
    : mode === "verify" ? `We sent a code to ${email}. Enter it to activate your account.`
    : mode === "forgot" ? "Enter your email and we'll send you a code."
    : `We sent a code to ${email}. Enter it with your new password.`;

  const isCodeStep = mode === "verify" || mode === "reset";

  return (
    <div className="provisio auth-screen">
      <div className="auth-card">
        <button className="brand-mark auth-brand auth-brand-link" onClick={onGoHome}>
          Provisio
        </button>

        <h2>{heading}</h2>
        <p className="auth-sub">{sub}</p>

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

          {(mode === "login" || mode === "signup" || mode === "forgot") && (
            <input
              className="p-input"
              type="email"
              placeholder="Email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          )}

          {isCodeStep && (
            <input
              className="p-input auth-code"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="6-digit code"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 8))}
              required
              autoFocus
            />
          )}

          {(mode === "login" || mode === "signup" || mode === "reset") && (
            <input
              className="p-input"
              type="password"
              placeholder={mode === "reset" ? "New password" : "Password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={6}
            />
          )}

          {error && <p className="p-error">{error}</p>}
          {notice && <p className="auth-notice">{notice}</p>}

          {mode === "signup" && (
            <label className="auth-optin">
              <input
                type="checkbox"
                checked={optIn}
                onChange={(e) => setOptIn(e.target.checked)}
              />
              <span>
                Email me product updates and fundraising tips.
                <em>No more than twice a month. Unsubscribe any time.</em>
              </span>
            </label>
          )}

          <button className="p-btn p-btn-primary" type="submit" disabled={loading}>
            {loading ? "Working..."
              : mode === "login" ? "Log in"
              : mode === "signup" ? "Sign up"
              : mode === "verify" ? "Confirm email"
              : mode === "forgot" ? "Send code"
              : "Set new password"}
          </button>
        </form>

        {mode === "login" && (
          <button className="auth-link" onClick={() => go("forgot")}>
            Forgot your password?
          </button>
        )}

        {isCodeStep && (
          <div className="auth-secondary">
            <button className="auth-link" onClick={resend} disabled={loading}>
              Send the code again
            </button>
            <button className="auth-link" onClick={() => go("login")}>
              Back to log in
            </button>
          </div>
        )}

        {(mode === "login" || mode === "signup") && (
          <button
            className="p-btn p-btn-ghost auth-switch"
            onClick={() => go(mode === "login" ? "signup" : "login")}
          >
            {mode === "login" ? "Need an account? Sign up" : "Already have an account? Log in"}
          </button>
        )}

        {mode === "forgot" && (
          <button className="p-btn p-btn-ghost auth-switch" onClick={() => go("login")}>
            Back to log in
          </button>
        )}
      </div>
    </div>
  );
}
