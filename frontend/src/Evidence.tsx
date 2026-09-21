import { useState } from "react";
import { startGithubConnect, listRepos, analyzeRepo, type RepoListing } from "./api";
import "./theme.css";
import "./evidence.css";

/* The analyze endpoint now returns a full diligence assessment alongside
   the structural summary. This view presents it as the report it is,
   rather than dumping the JSON the way the previous version did. */

interface Diligence {
  system_summary: string;
  what_is_hard: string[];
  what_is_commodity: string[];
  architecture_notes: string[];
  integration_depth: { system: string; assessment: string }[];
  data_model_insight: string;
  production_readiness: string;
  technical_risks: string[];
  investor_headline: string;
}

interface RepoSummary {
  full_name: string;
  primary_language: string;
  languages: Record<string, number>;
  contributor_count: number;
  commit_count_last_90_days: number;
  files_read: string[];
  directory_structure: string[];
  detected_integrations: { name: string; category: string; file_count: number; example_paths: string[] }[];
  maturity_signals: string[];
  dependencies_by_manifest: Record<string, string[]>;
  api_endpoint_count: number;
  data_model_names: string[];
  last_pushed_at: string | null;
}

interface AnalysisResult {
  summary: RepoSummary;
  diligence: Diligence;
  technology_slide_content: string;
}

export default function Evidence({
  onAnalyzed,
}: {
  onAnalyzed?: (result: AnalysisResult) => void;
}) {
  const [repos, setRepos] = useState<RepoListing[] | null>(null);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [analyzing, setAnalyzing] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showEvidence, setShowEvidence] = useState(false);

  async function loadRepos() {
    setError(null);
    setLoading(true);
    try {
      setRepos(await listRepos());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't load your repositories.");
    } finally {
      setLoading(false);
    }
  }

  async function analyze(fullName: string) {
    setError(null);
    setAnalyzing(fullName);
    setResult(null);
    try {
      const [owner, repo] = fullName.split("/");
      const res = (await analyzeRepo(owner, repo)) as unknown as AnalysisResult;
      setResult(res);
      onAnalyzed?.(res);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Analysis failed.");
    } finally {
      setAnalyzing(null);
    }
  }

  return (
    <div className="evidence">
      <div className="evidence-header">
        <div className="evidence-title">Evidence</div>
        <button className="evidence-connect-btn" onClick={() => startGithubConnect()}>
          ＋ Connect GitHub
        </button>
      </div>

      <div className="evidence-body">
        {/* Sidebar */}
        <div className="evidence-nav">
          {repos && repos.length > 0 ? (
            <>
              <div className="ev-section-label">Analysed repos</div>
              {repos.map((r) => (
                <button
                  key={r.full_name}
                  className={`ev-repo-item ${result?.summary.full_name === r.full_name ? "active" : ""}`}
                  onClick={() => analyze(r.full_name)}
                  disabled={!!analyzing}
                >
                  <div className="ev-repo-dot" />
                  {r.full_name.split("/")[1]}
                </button>
              ))}
            </>
          ) : null}
          <div className="ev-section-label" style={{ marginTop: "1.25rem" }}>Connection</div>
          <div className="ev-connection-info">
            {repos
              ? <>GitHub connected<br /><span className="ev-connection-status">● Active</span></>
              : <button className="ev-repo-item" style={{ color: "var(--gold-dim)" }} onClick={loadRepos} disabled={loading}>
                  {loading ? "Loading…" : "Load repositories"}
                </button>}
          </div>
        </div>

        {/* Main content */}
        <div className="evidence-content">
          {error && <p style={{ color: "var(--danger)", fontSize: "0.82rem", marginBottom: "1rem" }}>{error}</p>}

          {!repos && !loading && (
            <div className="ev-connect">
              <div className="ev-connect-title">Connect your GitHub</div>
              <div className="ev-connect-sub">
                Provisio reads your source files — not just metadata — and writes the technical
                assessment an investor's engineer would produce in diligence.
              </div>
              <button className="evidence-connect-btn" onClick={() => startGithubConnect()}>
                Connect GitHub →
              </button>
            </div>
          )}

          {repos && !result && !analyzing && (
            <>
              <div className="ev-section-title">Your repositories</div>
              <div className="ev-repo-list">
                {repos.map((r) => (
                  <div className="ev-repo-card" key={r.full_name} onClick={() => analyze(r.full_name)}>
                    <div className="ev-repo-dot" />
                    <div className="ev-repo-card-name">{r.full_name}</div>
                    {r.description && <div className="ev-repo-card-meta">{r.description}</div>}
                    <button className="ev-repo-card-action" disabled={!!analyzing}>
                      {analyzing === r.full_name ? "Reading…" : "Analyse →"}
                    </button>
                  </div>
                ))}
              </div>
            </>
          )}

          {analyzing && (
            <div style={{ padding: "2rem 0", color: "var(--text-dim)", fontSize: "0.85rem", lineHeight: 1.6 }}>
              <p style={{ marginBottom: "0.5rem", color: "var(--text)" }}>Reading {analyzing}…</p>
              <p>Fetching and reading source files. This takes longer than a metadata lookup because it actually reads your code.</p>
            </div>
          )}

          {result && <Report result={result} showEvidence={showEvidence} setShowEvidence={setShowEvidence} onBack={() => setResult(null)} />}
        </div>
      </div>
    </div>
  );
}

function Report({
  result, showEvidence, setShowEvidence, onBack,
}: {
  result: AnalysisResult;
  showEvidence: boolean;
  setShowEvidence: (v: boolean) => void;
  onBack: () => void;
}) {
  const { summary, diligence, technology_slide_content } = result;

  return (
    <div className="ev-report">
      <div className="ev-report-head">
        <button className="p-btn p-btn-ghost" onClick={onBack}>&lt; All repositories</button>
        <span className="ev-repo-label">{summary.full_name}</span>
      </div>

      {diligence.investor_headline && (
        <div className="ev-headline-block">
          <div className="ev-headline-label">Investor headline</div>
          <div className="ev-headline-text">{diligence.investor_headline}</div>
        </div>
      )}

      <section style={{ marginBottom: "1.5rem" }}>
        <div className="ev-stats" style={{ marginBottom: "1.25rem" }}>
          <div className="ev-stat"><div className="ev-stat-n">{summary.api_endpoint_count}</div><div className="ev-stat-l">API endpoints</div></div>
          <div className="ev-stat"><div className="ev-stat-n">{summary.commit_count_last_90_days}</div><div className="ev-stat-l">commits / 90d</div></div>
          <div className="ev-stat"><div className="ev-stat-n">{summary.contributor_count}</div><div className="ev-stat-l">contributors</div></div>
          <div className="ev-stat"><div className="ev-stat-n">{summary.detected_integrations.length}</div><div className="ev-stat-l">integrations</div></div>
          <div className="ev-stat"><div className="ev-stat-n">{summary.data_model_names.length}</div><div className="ev-stat-l">data models</div></div>
        </div>
        <div className="ev-section-title">What this system is</div>
        <p style={{ fontSize: "0.88rem", color: "var(--text-dim)", lineHeight: 1.6 }}>{diligence.system_summary}</p>
      </section>

      <div className="ev-columns">
        <section style={{ marginBottom: "1.5rem" }}>
          <div className="ev-section-title">What's genuinely hard here</div>
          <div className="ev-list-cards">
            {diligence.what_is_hard.map((item, i) => (
              <div className="ev-finding hard" key={i}>
                <div className="ev-finding-title">{item}</div>
              </div>
            ))}
          </div>
        </section>

        <section style={{ marginBottom: "1.5rem" }}>
          <div className="ev-section-title">What's commodity</div>
          <div className="ev-list-cards">
            {diligence.what_is_commodity.map((item, i) => (
              <div className="ev-finding" key={i}>
                <div className="ev-finding-title" style={{color:"var(--text-dim)"}}>{item}</div>
              </div>
            ))}
          </div>
        </section>
      </div>

      {diligence.architecture_notes.length > 0 && (
        <section style={{ marginBottom: "1.5rem" }}>
          <div className="ev-section-title">Architecture</div>
          <ul className="ev-list">
            {diligence.architecture_notes.map((item, i) => <li key={i}>{item}</li>)}
          </ul>
        </section>
      )}

      {diligence.integration_depth.length > 0 && (
        <section style={{ marginBottom: "1.5rem" }}>
          <div className="ev-section-title">Integration depth</div>
          <div className="ev-integrations">
            {diligence.integration_depth.map((integ, i) => {
              const detected = summary.detected_integrations.find(
                (d) => d.name.toLowerCase() === integ.system.toLowerCase()
              );
              return (
                <div className="ev-integration" key={i}>
                  <div className="ev-integration-head">
                    <span className="ev-integration-name">{integ.system}</span>
                    {detected && (
                      <span className="ev-integration-count">
                        {detected.file_count} file{detected.file_count === 1 ? "" : "s"}
                      </span>
                    )}
                  </div>
                  <p>{integ.assessment}</p>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {diligence.data_model_insight && (
        <section style={{ marginBottom: "1.5rem" }}>
          <div className="ev-section-title">What the data model says about the business</div>
          <p style={{ fontSize: "0.88rem", color: "var(--text-dim)", lineHeight: 1.6 }}>{diligence.data_model_insight}</p>
          {summary.data_model_names.length > 0 && (
            <div className="ev-chips">
              {summary.data_model_names.slice(0, 24).map((n) => (
                <span className="ev-chip" key={n}>{n}</span>
              ))}
            </div>
          )}
        </section>
      )}

      <div className="ev-columns">
        <section style={{ marginBottom: "1.5rem" }}>
          <div className="ev-section-title">Production readiness</div>
          <p>{diligence.production_readiness}</p>
          {summary.maturity_signals.length > 0 && (
            <div className="ev-maturity" style={{marginTop:"0.75rem"}}>
              {summary.maturity_signals.map((sig, i) => <span className="ev-maturity-tag" key={i}>{sig}</span>)}
            </div>
          )}
        </section>

        <section style={{ marginBottom: "1.5rem" }}>
          <div className="ev-section-title">Risks an investor will probe</div>
          <div className="ev-list-cards">
            {diligence.technical_risks.map((item, i) => (
              <div className="ev-finding risk" key={i}>
                <div className="ev-finding-title">{item}</div>
              </div>
            ))}
          </div>
        </section>
      </div>

      <section className="ev-section ev-slide-preview">
        <div className="ev-section-title">The Technology slide this produces</div>
        <p className="ev-slide-text">{technology_slide_content}</p>
      </section>

      <section style={{ marginBottom: "1.5rem" }}>
        <button className="ev-toggle" onClick={() => setShowEvidence(!showEvidence)}>
          {showEvidence ? "Hide" : "Show"} the underlying evidence
        </button>
        {showEvidence && (
          <div className="ev-evidence">
            <div className="ev-stats">
              <Stat label="Files read" value={String(summary.files_read.length)} />
              <Stat label="API endpoints" value={String(summary.api_endpoint_count)} />
              <Stat label="Data entities" value={String(summary.data_model_names.length)} />
              <Stat label="Commits, 90 days" value={String(summary.commit_count_last_90_days)} />
              <Stat label="Contributors" value={String(summary.contributor_count)} />
            </div>

            <h4>Source files read</h4>
            <div className="ev-files">
              {summary.files_read.map((f) => <code key={f}>{f}</code>)}
            </div>

            <h4>Repository structure</h4>
            <div className="ev-files">
              {summary.directory_structure.map((d) => <code key={d}>{d}</code>)}
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="ev-stat">
      <span className="ev-stat-value">{value}</span>
      <span className="ev-stat-label">{label}</span>
    </div>
  );
}
