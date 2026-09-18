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
    <div className="ev">
      <header className="ev-head">
        <h1 className="dash-title">Technical evidence</h1>
        <p className="dash-subtitle">
          Provisio reads your repository's actual source, not just its metadata, and writes the
          technical assessment an investor's engineer would produce in diligence.
        </p>
        <div className="ev-actions">
          <button className="p-btn p-btn-primary" onClick={() => startGithubConnect()}>
            Connect GitHub
          </button>
          <button className="p-btn p-btn-secondary" onClick={loadRepos} disabled={loading}>
            {loading ? "Loading…" : "Load my repositories"}
          </button>
        </div>
      </header>

      {error && <p className="p-error">{error}</p>}

      {repos && !result && (
        <div className="ev-repos">
          {repos.map((r) => (
            <div className="ev-repo" key={r.full_name}>
              <div className="ev-repo-info">
                <span className="ev-repo-name">
                  {r.full_name}
                  {r.private && <span className="ev-private">private</span>}
                </span>
                {r.description && <span className="ev-repo-desc">{r.description}</span>}
              </div>
              <button
                className="p-btn p-btn-secondary"
                onClick={() => analyze(r.full_name)}
                disabled={!!analyzing}
              >
                {analyzing === r.full_name ? "Reading the code…" : "Analyse"}
              </button>
            </div>
          ))}
        </div>
      )}

      {analyzing && (
        <div className="ev-progress">
          <p>Reading source files from {analyzing}, then assessing architecture.</p>
          <p className="ev-progress-note">
            This takes longer than a metadata lookup because it fetches and reads real files.
          </p>
        </div>
      )}

      {result && <Report result={result} showEvidence={showEvidence} setShowEvidence={setShowEvidence} onBack={() => setResult(null)} />}
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
    <article className="ev-report">
      <div className="ev-report-head">
        <button className="p-btn p-btn-ghost" onClick={onBack}>&lt; All repositories</button>
        <span className="ev-repo-label">{summary.full_name}</span>
      </div>

      {diligence.investor_headline && (
        <p className="ev-headline">{diligence.investor_headline}</p>
      )}

      <section className="ev-section">
        <h2>What this system is</h2>
        <p className="ev-lead">{diligence.system_summary}</p>
      </section>

      <div className="ev-columns">
        <section className="ev-section">
          <h2>What's genuinely hard here</h2>
          <ul className="ev-list ev-list-strong">
            {diligence.what_is_hard.map((item, i) => <li key={i}>{item}</li>)}
          </ul>
        </section>

        <section className="ev-section">
          <h2>What's commodity</h2>
          <ul className="ev-list ev-list-muted">
            {diligence.what_is_commodity.map((item, i) => <li key={i}>{item}</li>)}
          </ul>
        </section>
      </div>

      {diligence.architecture_notes.length > 0 && (
        <section className="ev-section">
          <h2>Architecture</h2>
          <ul className="ev-list">
            {diligence.architecture_notes.map((item, i) => <li key={i}>{item}</li>)}
          </ul>
        </section>
      )}

      {diligence.integration_depth.length > 0 && (
        <section className="ev-section">
          <h2>Integration depth</h2>
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
        <section className="ev-section">
          <h2>What the data model says about the business</h2>
          <p className="ev-lead">{diligence.data_model_insight}</p>
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
        <section className="ev-section">
          <h2>Production readiness</h2>
          <p>{diligence.production_readiness}</p>
          {summary.maturity_signals.length > 0 && (
            <ul className="ev-list ev-list-check">
              {summary.maturity_signals.map((s, i) => <li key={i}>{s}</li>)}
            </ul>
          )}
        </section>

        <section className="ev-section">
          <h2>Risks an investor will probe</h2>
          <ul className="ev-list ev-list-risk">
            {diligence.technical_risks.map((item, i) => <li key={i}>{item}</li>)}
          </ul>
        </section>
      </div>

      <section className="ev-section ev-slide-preview">
        <h2>The Technology slide this produces</h2>
        <p className="ev-slide-text">{technology_slide_content}</p>
      </section>

      <section className="ev-section">
        <button className="ev-toggle" onClick={() => setShowEvidence(!showEvidence)}>
          {showEvidence ? "Hide" : "Show"} the underlying evidence
        </button>
        {showEvidence && (
          <div className="ev-evidence">
            <div className="ev-stat-row">
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
    </article>
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
