import { useEffect, useState } from "react";
import "../theme.css";
import "./landing.css";

interface LandingProps {
  onTryNow: () => void;
}

// These are illustrative mockups of what a generated slide could look like,
// using a placeholder company. They are not claims about Provisio itself.
const SLIDE_EXAMPLES = [
  {
    label: "Technology",
    company: "Example: Acme Robotics",
    parts: [
      { text: "Built on a " },
      { text: "TypeScript and Node backend", source: "package.json, 5 core dependencies" },
      { text: " with " },
      { text: "40 commits in the last 90 days", source: "GitHub commit history" },
      { text: " and automated test coverage." },
    ],
  },
  {
    label: "Team",
    company: "Example: Acme Robotics",
    parts: [
      { text: "Founding team of " },
      { text: "3 engineers", source: "Team profiles you provide" },
      { text: " with backgrounds in " },
      { text: "robotics and embedded systems", source: "Founder bios" },
      { text: "." },
    ],
  },
];

export default function Landing({ onTryNow }: LandingProps) {
  const [active, setActive] = useState(0);

  useEffect(() => {
    const id = setInterval(() => {
      setActive((i) => (i + 1) % SLIDE_EXAMPLES.length);
    }, 2600);
    return () => clearInterval(id);
  }, []);

  const slide = SLIDE_EXAMPLES[active];

  return (
    <div className="provisio landing">
      <header className="landing-nav">
        <div className="landing-nav-inner">
          <button className="brand-mark brand-mark-link" onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}>
            Provisio
          </button>
          <nav className="landing-nav-links">
            <a href="#how-it-works">How it works</a>
            <a href="#sources">Evidence sources</a>
            <a href="#security">Security</a>
            <a href="#docs">Docs</a>
          </nav>
          <button className="p-btn p-btn-ghost" onClick={onTryNow}>
            Log in
          </button>
        </div>
      </header>

      <section className="hero">
        <div className="hero-inner">
          <div className="hero-copy">
            <h1>
              Every claim in your deck,
              <br />
              backed by a source.
            </h1>
            <p className="hero-sub">
              Connect your repo, your financials, your team, and your brand. Provisio
              turns what you've actually built into an investor ready deck, with every
              claim traceable to where it came from.
            </p>
            <div className="hero-actions">
              <button className="p-btn p-btn-primary" onClick={onTryNow}>
                Try it free
              </button>
              <a className="p-btn p-btn-secondary" href="#how-it-works">
                See the process
              </a>
            </div>
            <p className="hero-note">No credit card required. Connect a repo in under a minute.</p>
          </div>

          <div className="hero-visual">
            <div className="mock-slide" key={active}>
              <div className="mock-slide-top">
                <span className="mock-slide-label">{slide.label}</span>
                <span className="mock-slide-company">{slide.company}</span>
              </div>
              <p className="mock-slide-text">
                {slide.parts.map((part, i) =>
                  part.source ? (
                    <span className="claim-tag" key={i}>
                      {part.text}
                      <span className="claim-source">
                        <span className="claim-source-dot" />
                        {part.source}
                      </span>
                    </span>
                  ) : (
                    <span key={i}>{part.text}</span>
                  )
                )}
              </p>
              <p className="mock-slide-disclaimer">Illustrative example, not real data</p>
            </div>
            <div className="mock-dots">
              {SLIDE_EXAMPLES.map((_, i) => (
                <button
                  key={i}
                  className={`mock-dot ${i === active ? "mock-dot-active" : ""}`}
                  onClick={() => setActive(i)}
                  aria-label={`Show ${SLIDE_EXAMPLES[i].label} example`}
                />
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="how-it-works" id="how-it-works">
        <h2>What actually happens when you connect something</h2>

        <div className="detail-block">
          <h3>1. You connect your evidence</h3>
          <p>
            You can connect any combination of the following: a private or public
            GitHub repository, your company website, financial records as a CSV or
            PDF, your logo and brand colors, product screenshots or a demo video, and
            profiles for your founders and team. You can also tell Provisio what
            program, fund, or competition you're applying to, so the output reflects
            what that specific audience is asking for.
          </p>
          <p>
            You are never required to connect everything at once. A deck can be built
            from a single source and expanded later as you connect more.
          </p>
        </div>

        <div className="detail-block">
          <h3>2. Provisio extracts structured facts, it does not summarize opinions</h3>
          <p>
            For a connected repository, Provisio reads repository metadata,
            programming languages used, dependency manifests, commit activity over
            the last 90 days, whether automated tests exist, and the README. It does
            not read every file in the repository, and it does not send your full
            source code to a language model. A structured summary is built first,
            and only that structured summary, not raw code, is passed to the AI model
            that writes slide copy.
          </p>
          <p>
            For financial uploads, figures are parsed directly from the file you
            provide. For team and company details, the information you type in is
            used as given. In every case, the AI is instructed to only phrase what
            was extracted, not to add numbers, achievements, or claims that were not
            present in the source data.
          </p>
        </div>

        <div className="detail-block">
          <h3>3. You get a deck where every claim is traceable</h3>
          <p>
            The resulting slides show each factual claim alongside a reference to
            where it came from, for example a specific file, a specific upload, or a
            specific field you filled in. You can review, edit, or remove any claim
            before exporting. Export formats include PDF and PowerPoint.
          </p>
        </div>
      </section>

      <section className="sources" id="sources">
        <h2>What you can connect</h2>
        <div className="source-grid">
          <div className="source-card">
            <h4>Codebase</h4>
            <p>
              Connected through a GitHub App, not a personal access token. During
              setup you choose exactly which repositories to grant access to. See
              the security section below for exactly what is read and what is not.
            </p>
          </div>
          <div className="source-card">
            <h4>Financials</h4>
            <p>
              Upload revenue, margin, or growth data as a CSV or PDF. Figures shown
              in your deck are drawn directly from the rows or fields you provide.
            </p>
          </div>
          <div className="source-card">
            <h4>Brand and team</h4>
            <p>
              Upload a logo and brand colors, product screenshots or a demo video,
              and short bios for your founders and team members.
            </p>
          </div>
          <div className="source-card">
            <h4>Target program</h4>
            <p>
              Provide the name or a link describing the accelerator, fund, or
              competition you're applying to, so the deck's framing matches what
              that program says it looks for.
            </p>
          </div>
        </div>
      </section>

      <section className="security" id="security">
        <h2>How repository access actually works</h2>
        <div className="security-grid">
          <div className="security-item">
            <h4>You choose the repositories, not us</h4>
            <p>
              Provisio connects through a GitHub App. During installation, GitHub
              shows you a picker where you select specific repositories. Provisio
              never receives blanket access to your account, and repositories you
              don't select are invisible to it.
            </p>
          </div>
          <div className="security-item">
            <h4>Read only, contents permission only</h4>
            <p>
              The GitHub App requests read only access to repository contents and
              metadata. It cannot write to your code, open pull requests, delete
              anything, or access billing, admin, or organization settings.
            </p>
          </div>
          <div className="security-item">
            <h4>Tokens are encrypted at rest</h4>
            <p>
              Your GitHub access token is encrypted before it's stored and is only
              decrypted in memory at the moment a request is made on your behalf.
            </p>
          </div>
          <div className="security-item">
            <h4>Your source code is not sent to the AI model</h4>
            <p>
              Provisio extracts a structured summary of your repository, such as
              dependency names, commit counts, and language breakdown. That summary,
              not your raw source files, is what gets passed to the AI model that
              writes slide copy.
            </p>
          </div>
          <div className="security-item">
            <h4>You can disconnect at any time</h4>
            <p>
              Revoking access from your Provisio account or uninstalling the GitHub
              App from your GitHub settings immediately removes Provisio's access.
            </p>
          </div>
        </div>
      </section>

      <section className="docs" id="docs">
        <h2>Documentation</h2>
        <p className="docs-intro">
          Provisio is early and the product surface is still growing. Here is what's
          available today.
        </p>
        <div className="docs-grid">
          <div className="docs-item">
            <h4>Connecting GitHub</h4>
            <p>
              Click Connect GitHub from your dashboard. You'll be taken to GitHub's
              installation screen, where you choose specific repositories to grant
              access to. After approving, you'll be returned to Provisio and your
              selected repositories will load automatically.
            </p>
          </div>
          <div className="docs-item">
            <h4>Analyzing a repository</h4>
            <p>
              Once connected, click Analyze next to any listed repository. Provisio
              extracts a structured summary and generates a draft slide. The raw
              extracted data is shown alongside the generated text so you can verify
              nothing was invented.
            </p>
          </div>
          <div className="docs-item">
            <h4>What's not built yet</h4>
            <p>
              Financial upload parsing, team and brand asset uploads, target program
              matching, and full multi-slide deck export are on the roadmap and not
              yet available. This page will be updated as each ships.
            </p>
          </div>
        </div>
      </section>

      <section className="cta-band">
        <h2>Your company already has a story.</h2>
        <p>Provisio finds it in what you've built, not what you claim.</p>
        <button className="p-btn p-btn-primary" onClick={onTryNow}>
          Try it free
        </button>
      </section>

      <footer className="landing-footer">
        <div className="footer-inner">
          <div className="footer-col">
            <span className="brand-mark">Provisio</span>
            <p>Evidence backed pitch decks for technical founders.</p>
          </div>
          <div className="footer-col">
            <h5>Product</h5>
            <a href="#how-it-works">How it works</a>
            <a href="#sources">Evidence sources</a>
            <a href="#security">Security</a>
          </div>
          <div className="footer-col">
            <h5>Resources</h5>
            <a href="#docs">Documentation</a>
          </div>
          <div className="footer-col">
            <h5>Company</h5>
            <a href="#docs">About</a>
          </div>
        </div>
        <div className="footer-bottom">© {new Date().getFullYear()} Provisio. All rights reserved.</div>
      </footer>
    </div>
  );
}
