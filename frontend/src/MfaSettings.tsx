import { useEffect, useState } from "react";
import { supabase } from "./supabaseClient";
import "./theme.css";
import "./mfa.css";

interface Factor {
  id: string;
  friendly_name?: string;
  factor_type: string;
  status: string;
}

export default function MfaSettings() {
  const [factors, setFactors] = useState<Factor[]>([]);
  const [enrolling, setEnrolling] = useState(false);
  const [qrSvg, setQrSvg] = useState<string | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [pendingFactorId, setPendingFactorId] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  async function loadFactors() {
    setLoading(true);
    const { data, error } = await supabase.auth.mfa.listFactors();
    if (error) setError(error.message);
    else setFactors(data.totp as Factor[]);
    setLoading(false);
  }

  useEffect(() => {
    loadFactors();
  }, []);

  async function startEnroll() {
    setError(null);
    setEnrolling(true);
    const { data, error } = await supabase.auth.mfa.enroll({ factorType: "totp" });
    if (error) {
      setError(error.message);
      setEnrolling(false);
      return;
    }
    setQrSvg(data.totp.qr_code);
    setSecret(data.totp.secret);
    setPendingFactorId(data.id);
  }

  async function confirmEnroll() {
    if (!pendingFactorId) return;
    setError(null);
    const { data: challenge, error: challengeError } = await supabase.auth.mfa.challenge({
      factorId: pendingFactorId,
    });
    if (challengeError) {
      setError(challengeError.message);
      return;
    }
    const { error: verifyError } = await supabase.auth.mfa.verify({
      factorId: pendingFactorId,
      challengeId: challenge.id,
      code,
    });
    if (verifyError) {
      setError(verifyError.message);
      return;
    }
    setEnrolling(false);
    setQrSvg(null);
    setSecret(null);
    setPendingFactorId(null);
    setCode("");
    await loadFactors();
  }

  async function removeFactor(factorId: string) {
    setError(null);
    const { error } = await supabase.auth.mfa.unenroll({ factorId });
    if (error) setError(error.message);
    else await loadFactors();
  }

  if (loading) return <p className="mfa-loading">Loading security settings...</p>;

  const activeFactor = factors.find((f) => f.status === "verified");

  return (
    <div className="mfa-panel">
      <h3>Two-factor authentication</h3>
      <p className="mfa-desc">
        Add an authenticator app as a second step at login, in addition to your
        password.
      </p>

      {error && <p className="p-error">{error}</p>}

      {activeFactor && !enrolling && (
        <div className="mfa-active">
          <p>
            <span className="mfa-status-dot" /> Authenticator app enabled
          </p>
          <button className="p-btn p-btn-secondary" onClick={() => removeFactor(activeFactor.id)}>
            Remove
          </button>
        </div>
      )}

      {!activeFactor && !enrolling && (
        <button className="p-btn p-btn-primary" onClick={startEnroll}>
          Set up authenticator app
        </button>
      )}

      {enrolling && qrSvg && (
        <div className="mfa-enroll">
          <p className="mfa-step-label">1. Scan this with your authenticator app</p>
          <div className="mfa-qr" dangerouslySetInnerHTML={{ __html: qrSvg }} />
          {secret && (
            <p className="mfa-secret">
              Can't scan it? Enter this code manually: <code>{secret}</code>
            </p>
          )}
          <p className="mfa-step-label">2. Enter the 6-digit code it shows</p>
          <div className="mfa-verify-row">
            <input
              className="p-input"
              type="text"
              inputMode="numeric"
              maxLength={6}
              placeholder="123456"
              value={code}
              onChange={(e) => setCode(e.target.value)}
            />
            <button className="p-btn p-btn-primary" onClick={confirmEnroll} disabled={code.length !== 6}>
              Confirm
            </button>
            <button
              className="p-btn p-btn-ghost"
              onClick={() => {
                setEnrolling(false);
                setQrSvg(null);
                setSecret(null);
                setPendingFactorId(null);
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
