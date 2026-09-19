import { useEffect, useState } from "react";
import "./landing.css";

/**
 * The marketing site.
 *
 * Written for someone who has never heard of the product and doesn't want to
 * decode jargon. Each section answers one question a real visitor has, in the
 * order they'd ask it: what is this, why would I need it, how does it work,
 * why is it different, what does it cost, what's the catch.
 *
 * Headings are real semantic h1/h2/h3 in document order and every section has
 * an id, so search engines and screen readers get the same structure a sighted
 * reader does.
 */

interface LandingProps {
  onTryNow: () => void;
}

export default function Landing({ onTryNow }: LandingProps) {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <div className="mk">
      <Nav scrolled={scrolled} onTryNow={onTryNow} />
      <Hero onTryNow={onTryNow} />
      <Problem />
      <HowItWorks />
      <Evidence />
      <Design />
      <Data />
      <Pricing onTryNow={onTryNow} />
      <Faq />
      <FinalCta onTryNow={onTryNow} />
      <Footer />
    </div>
  );
}

/* ------------------------------------------------------------------ */

function Nav({ scrolled, onTryNow }: { scrolled: boolean; onTryNow: () => void }) {
  return (
    <header className={`mk-nav ${scrolled ? "is-scrolled" : ""}`}>
      <div className="mk-nav-inner">
        <a href="#top" className="mk-logo">Provisio</a>
        <nav className="mk-nav-links" aria-label="Main">
          <a href="#how">How it works</a>
          <a href="#evidence">What's different</a>
          <a href="#pricing">Pricing</a>
          <a href="#faq">Questions</a>
        </nav>
        <div className="mk-nav-actions">
          <button className="mk-link-btn" onClick={onTryNow}>Sign in</button>
          <button className="mk-btn mk-btn-primary" onClick={onTryNow}>Start free</button>
        </div>
      </div>
    </header>
  );
}

function Hero({ onTryNow }: { onTryNow: () => void }) {
  return (
    <section className="mk-hero" id="top">
      <div className="mk-container">
        <p className="mk-eyebrow">For founders who build</p>
        <h1>Your code already proves<br />what you've built.</h1>
        <p className="mk-lede">
          Provisio reads your repository, works out what's genuinely hard about your product, and
          writes an investor pitch deck around it. Every claim traces back to something real,
          because it came from your own work.
        </p>
        <div className="mk-hero-actions">
          <button className="mk-btn mk-btn-primary mk-btn-lg" onClick={onTryNow}>
            Build a deck free
          </button>
          <a className="mk-btn mk-btn-ghost mk-btn-lg" href="#how">See how it works</a>
        </div>
        <p className="mk-hero-note">Free to build and preview. You only pay when you download.</p>

        <div className="mk-hero-visual" aria-hidden="true"><MiniDeck /></div>
      </div>
    </section>
  );
}

/** An abstract illustration of the output, drawn rather than screenshotted so
 *  it stays sharp at any size and weighs almost nothing. */
function MiniDeck() {
  return (
    <svg viewBox="0 0 900 380" className="mk-minideck" role="presentation">
      <defs>
        <linearGradient id="mk-fade" x1="0" y1="0" x2="0" y2="1">
          <stop offset="55%" stopColor="#0a0a0a" stopOpacity="0" />
          <stop offset="100%" stopColor="#0a0a0a" stopOpacity="1" />
        </linearGradient>
      </defs>
      <rect x="480" y="34" width="360" height="203" rx="5" fill="#faf8f3" />
      <rect x="500" y="56" width="110" height="6" rx="3" fill="#b8860b" />
      <rect x="500" y="76" width="230" height="12" rx="3" fill="#1f1d1a" />
      <rect x="500" y="96" width="176" height="12" rx="3" fill="#1f1d1a" />
      <rect x="500" y="130" width="300" height="5" rx="2" fill="#c9c2b2" />
      <rect x="500" y="143" width="278" height="5" rx="2" fill="#c9c2b2" />
      <rect x="500" y="156" width="236" height="5" rx="2" fill="#c9c2b2" />

      <rect x="80" y="58" width="360" height="203" rx="5" fill="#161412" />
      <circle cx="116" cy="88" r="9" fill="#b8860b" opacity="0.9" />
      <rect x="104" y="176" width="44" height="4" fill="#b8860b" />
      <rect x="104" y="192" width="192" height="17" rx="3" fill="#faf8f3" />
      <rect x="104" y="220" width="138" height="7" rx="3" fill="#6b6659" />

      <rect x="300" y="150" width="360" height="203" rx="5" fill="#faf8f3" stroke="#e0dacb" />
      <rect x="322" y="172" width="150" height="9" rx="3" fill="#1f1d1a" />
      {[40, 66, 92, 118, 144].map((h, i) => (
        <rect key={i} x={324 + i * 62} y={318 - h} width="40" height={h} rx="2"
              fill="#1f1d1a" opacity={0.88 - i * 0.07} />
      ))}
      <rect x="322" y="326" width="310" height="1" fill="#c9c2b2" />
      <rect x="0" y="290" width="900" height="90" fill="url(#mk-fade)" />
    </svg>
  );
}

function Problem() {
  return (
    <section className="mk-section mk-problem">
      <div className="mk-container">
        <div className="mk-section-head mk-narrow">
          <h2>Building the company and explaining it are two different jobs</h2>
        </div>
        <div className="mk-problem-grid">
          <article>
            <h3>You're too close to the hard part</h3>
            <p>
              The thing that took six months to get right feels obvious to you now, so it ends up as
              one line on a slide. An investor reads past it without noticing what it took.
            </p>
          </article>
          <article>
            <h3>Deck tools only reword what you type</h3>
            <p>
              They rearrange your sentences into slides. They have no idea what you actually built,
              so they can't tell anyone why it would be hard to copy.
            </p>
          </article>
          <article>
            <h3>Good design takes skills you didn't train for</h3>
            <p>
              You can tell a great deck from a bad one. Making one means grids, type and spacing,
              which is a craft of its own, and not the one you've spent years on.
            </p>
          </article>
        </div>
      </div>
    </section>
  );
}

function HowItWorks() {
  const steps = [
    {
      n: "01",
      title: "Connect your repository",
      body: "Sign in with GitHub and pick exactly which repositories Provisio may read. It never sees anything you don't choose, and you can disconnect whenever you like.",
      video: "",
    },
    {
      n: "02",
      title: "Tell it about your company",
      body: "Fill in what you know: the problem, your customers, traction, what you're raising. Already have a deck? Import it and Provisio pulls the content out for you.",
      video: "",
    },
    {
      n: "03",
      title: "It reads the code and writes the deck",
      body: "Provisio opens your real source files, works out what the system does and which parts are hard, then writes every slide around evidence instead of adjectives.",
      video: "",
    },
    {
      n: "04",
      title: "Make it yours, then download",
      body: "Switch templates, change colours and type, drag anything anywhere, drop in your own screenshots and charts. Export to PowerPoint or PDF when it's right.",
      video: "",
    },
  ];

  return (
    <section className="mk-section" id="how">
      <div className="mk-container">
        <header className="mk-section-head">
          <h2>How it works</h2>
          <p>Four steps. The first deck usually takes under fifteen minutes.</p>
        </header>
        <div className="mk-steps">
          {steps.map((s) => (
            <article className="mk-step" key={s.n}>
              <div className="mk-step-text">
                <span className="mk-step-n">{s.n}</span>
                <h3>{s.title}</h3>
                <p>{s.body}</p>
              </div>
              <VideoSlot src={s.video} label={s.title} />
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

/**
 * A video placeholder that becomes a real embed once a URL is supplied and the
 * visitor clicks.
 *
 * Deliberately click-to-load: four auto-loading embeds would add seconds and a
 * lot of third-party tracking to a page most visitors only scroll through.
 * To publish a video, paste its embed URL into the matching step above.
 */
function VideoSlot({ src, label }: { src: string; label: string }) {
  const [playing, setPlaying] = useState(false);

  if (!src) {
    return (
      <div className="mk-video mk-video-empty" aria-hidden="true">
        <span>Walkthrough coming soon</span>
      </div>
    );
  }
  if (!playing) {
    return (
      <button className="mk-video mk-video-poster" onClick={() => setPlaying(true)}
              aria-label={`Play walkthrough: ${label}`}>
        <span className="mk-play" aria-hidden="true">▶</span>
        <span className="mk-video-label">Watch: {label}</span>
      </button>
    );
  }
  return (
    <div className="mk-video">
      <iframe
        src={`${src}${src.includes("?") ? "&" : "?"}autoplay=1`}
        title={label}
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; picture-in-picture"
        allowFullScreen
        loading="lazy"
      />
    </div>
  );
}

function Evidence() {
  return (
    <section className="mk-section mk-evidence" id="evidence">
      <div className="mk-container">
        <header className="mk-section-head">
          <h2>Other tools rewrite your words. Provisio reads your code.</h2>
          <p>That's the whole difference, so it's worth being specific about what happens.</p>
        </header>

        <div className="mk-compare">
          <article className="mk-compare-col">
            <h3>What most tools see</h3>
            <p className="mk-compare-lead">The paragraph you typed into a form.</p>
            <blockquote className="mk-quote-bad">
              "We're building an innovative platform that leverages cutting-edge technology to
              revolutionise payments."
            </blockquote>
            <p className="mk-compare-note">
              Nothing there can be checked, so a good investor discounts all of it.
            </p>
          </article>

          <article className="mk-compare-col is-good">
            <h3>What Provisio sees</h3>
            <p className="mk-compare-lead">Your actual repository.</p>
            <ul className="mk-evidence-list">
              <li>Which external systems you integrate with, and how deeply</li>
              <li>What your data model says the business really does</li>
              <li>Which parts are genuinely hard, and which are standard scaffolding</li>
              <li>Whether this is a prototype or production infrastructure</li>
              <li>Honest technical risks an investor will ask about anyway</li>
            </ul>
            <p className="mk-compare-note">
              Then it writes the slide from that. One claim an investor can verify beats ten they
              can't.
            </p>
          </article>
        </div>

        <aside className="mk-callout">
          <h3>It will not make things up</h3>
          <p>
            Provisio rewrites your input to make it sharper. It never invents a number, a customer
            or a partnership. Every figure in the finished deck is checked against what you
            supplied, and anything that doesn't match is flagged before you send it anywhere.
          </p>
        </aside>
      </div>
    </section>
  );
}

function Design() {
  const features = [
    ["Templates that are actually different",
     "Seven of them, and they don't just swap colours. Each has its own grid, type scale and way of building a page. Switch, and the whole deck rebuilds."],
    ["Change anything, in real time",
     "Colours, fonts, spacing and alignment applied across every slide as you adjust them. If contrast drops too low to read on a projector, Provisio says so."],
    ["Drag anything anywhere",
     "Every element on every slide moves and resizes. Things snap to the grid and to each other, so hand-placed doesn't mean slightly crooked. Undo works properly."],
    ["Your images, handled well",
     "Screenshots, team photos, diagrams. Choose what stays in frame when an image is cropped, pick a treatment, drop it exactly where you want it."],
    ["Fonts that survive the journey",
     "Typefaces are embedded in the PowerPoint file, so your deck looks the same on an investor's laptop as it does on yours."],
    ["Every claim shows its source",
     "Each slide records where its content came from, so when someone asks \u201Cwhere's this from?\u201D in a meeting, you know."],
  ];

  return (
    <section className="mk-section mk-design">
      <div className="mk-container">
        <header className="mk-section-head">
          <h2>Decks you'd be happy to put your name on</h2>
          <p>Not a template with your logo dropped in. Real layout systems, and a proper editor when you want to change something.</p>
        </header>
        <div className="mk-feature-grid">
          {features.map(([title, body]) => (
            <article key={title}>
              <h3>{title}</h3>
              <p>{body}</p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

function Data() {
  return (
    <section className="mk-section mk-data">
      <div className="mk-container mk-narrow">
        <h2>Bring your numbers, get charts that are actually right</h2>
        <p className="mk-section-lede">
          Drop in a spreadsheet, a CSV, a PDF report, or paste a table. Provisio works out what each
          column is, then shows you the charts that suit that shape of data.
        </p>
        <ul className="mk-tick-list">
          <li>Reads Excel, CSV, PDF and JSON, including files with several tables inside them</li>
          <li>Understands currencies, percentages, dates and missing values instead of guessing</li>
          <li>Suggests the right chart, and says plainly which ones would mislead, and why</li>
          <li>Flags problems in your data, like an outlier that would distort a chart's scale</li>
          <li>Drops a chart onto any slide with a note explaining what it shows</li>
        </ul>
      </div>
    </section>
  );
}

function Pricing({ onTryNow }: { onTryNow: () => void }) {
  const plans = [
    { name: "Free", price: "$0", interval: "", blurb: "Build and preview as much as you like.",
      features: ["Unlimited decks", "Full editor and every template", "Repository analysis", "Charts and data import"],
      cta: "Start free", best: false },
    { name: "Single deck", price: "$10", interval: "once", blurb: "Raising once? Pay once.",
      features: ["Everything in Free", "Download one deck", "PowerPoint and PDF", "Embedded fonts"],
      cta: "Get started", best: false },
    { name: "Monthly", price: "$30", interval: "per month", blurb: "For iterating across several decks.",
      features: ["Everything in Free", "Unlimited downloads", "Every format", "Cancel any time"],
      cta: "Get started", best: false },
    { name: "Yearly", price: "$99.99", interval: "per year", blurb: "The same thing, at a far lower rate.",
      features: ["Everything in Monthly", "Twelve months of downloads", "72% less than monthly", "Priority support"],
      cta: "Get started", best: true },
  ];

  return (
    <section className="mk-section mk-pricing" id="pricing">
      <div className="mk-container">
        <header className="mk-section-head">
          <h2>Pricing</h2>
          <p>Build for free. Pay when you're ready to download.</p>
        </header>
        <div className="mk-plans">
          {plans.map((p) => (
            <article className={`mk-plan ${p.best ? "is-best" : ""}`} key={p.name}>
              {p.best && <span className="mk-plan-badge">Best value</span>}
              <h3>{p.name}</h3>
              <p className="mk-plan-price">
                <strong>{p.price}</strong>
                {p.interval && <em>{p.interval}</em>}
              </p>
              <p className="mk-plan-blurb">{p.blurb}</p>
              <ul>{p.features.map((f) => <li key={f}>{f}</li>)}</ul>
              <button className={`mk-btn ${p.best ? "mk-btn-primary" : "mk-btn-outline"}`} onClick={onTryNow}>
                {p.cta}
              </button>
            </article>
          ))}
        </div>
        <p className="mk-pricing-note">
          Paid by card in US dollars, or in naira through Paystack if you're in Nigeria. Your deck
          stays saved and editable whether or not you pay.
        </p>
      </div>
    </section>
  );
}

function Faq() {
  const items = [
    ["Do you keep a copy of my code?",
     "No. Provisio reads a selection of your files at the moment you ask it to analyse a repository, uses them to write the assessment, and doesn't store the source afterwards. You choose which repositories it can see, and you can disconnect at any time."],
    ["Will it invent things about my company?",
     "No, and this is enforced rather than promised. It rewrites what you give it to make it sharper, but it can't add facts. Every number in the finished deck is checked against what you supplied, and anything unmatched is shown to you as a warning before you send the deck anywhere."],
    ["What if I don't have a repository to connect?",
     "You can still use everything else. The repository analysis makes the technology slide much stronger, but the deck is built from your company information either way."],
    ["Can I edit what it writes?",
     "All of it. The generated deck is a starting point, not a finished thing. Every word, layout and colour is editable, and hand-edited slides keep your changes when you switch templates."],
    ["What do I actually get when I download?",
     "A PowerPoint file and a PDF. The PowerPoint has your typefaces embedded so it looks the same on someone else's computer, and every element stays editable in PowerPoint or Keynote if you want to keep working there."],
    ["I already have a deck. Is this useful?",
     "Import it. Provisio reads your existing PDF or PowerPoint, pulls the content into your profile, and you rebuild from there. It's often the fastest way to see the difference."],
    ["Is my company information private?",
     "Yes. Your profile, decks and data belong to your account and aren't shared or used to train anything. Two-factor authentication is available and worth turning on."],
    ["What happens if I stop paying?",
     "Nothing is deleted. Your decks stay in your account and stay editable. You just can't download new files until you're on a plan again."],
  ];

  return (
    <section className="mk-section mk-faq" id="faq">
      <div className="mk-container mk-narrow">
        <h2>Questions people actually ask</h2>
        <div className="mk-faq-list">
          {items.map(([q, a]) => (
            <details className="mk-faq-item" key={q}>
              <summary>{q}</summary>
              <p>{a}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}

function FinalCta({ onTryNow }: { onTryNow: () => void }) {
  return (
    <section className="mk-final">
      <div className="mk-container mk-narrow">
        <h2>Your next deck could take an afternoon</h2>
        <p>
          Connect a repository, answer a few questions, and see what Provisio makes of what you've
          built. It costs nothing until you download.
        </p>
        <button className="mk-btn mk-btn-primary mk-btn-lg" onClick={onTryNow}>
          Build a deck free
        </button>
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer className="mk-footer">
      <div className="mk-container mk-footer-inner">
        <div className="mk-footer-brand">
          <span className="mk-logo">Provisio</span>
          <p>Investor decks built on evidence, not adjectives.</p>
        </div>
        <nav aria-label="Footer">
          <a href="#how">How it works</a>
          <a href="#evidence">What's different</a>
          <a href="#pricing">Pricing</a>
          <a href="#faq">Questions</a>
        </nav>
        <p className="mk-copyright">© {new Date().getFullYear()} Provisio, by Domani.</p>
      </div>
    </footer>
  );
}
