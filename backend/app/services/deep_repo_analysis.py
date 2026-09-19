"""
Deep codebase analysis: actually reads source files and infers what the
system does, not just how many bytes of each language it contains.

This is the product's core differentiator. The earlier version of this
module only pulled GitHub metadata (language byte counts, commit counts,
dependency names) which tells an investor essentially nothing. This one
answers the questions a technical investor actually asks:

  - What does this system DO, architecturally?
  - What's genuinely hard about it?
  - What external systems does it integrate with, and how deeply?
  - What does the data model say about the business?
  - Is this production-grade or a prototype?

Strategy: we cannot read an entire repo (rate limits, token cost, and most
files are noise). Instead we do targeted retrieval, fetching the files that
carry the most architectural signal per byte:

  1. Entry points and config (what kind of system is this)
  2. Route/API definitions (what does it expose)
  3. Data models and schema (what does it store, i.e. what's the business)
  4. Service/business-logic layer (where the hard problems live)
  5. Infrastructure (how it deploys, scales, and is operated)

Everything fetched is real file content from the user's repo. Nothing here
is inferred from filenames alone except the initial selection heuristic.
"""
import asyncio
import base64
import fnmatch
import httpx
from dataclasses import dataclass, field

from app.services.source_distiller import budget_files

GITHUB_API = "https://api.github.com"

# Hard caps so a huge monorepo can't blow up latency or token cost.
#
# MAX_TOTAL_CONTENT_BYTES is the budget for DISTILLED source that reaches
# the model, not raw file bytes. Roughly 4 characters per token, so 48,000
# characters is about 12k tokens, leaving comfortable room under a 30k
# tokens-per-minute account limit once the prompt and response are counted.
# Raising this without checking the deployment's rate limit is how the
# analysis endpoint starts failing with 429s.
MAX_FILES_TO_READ = 40
MAX_FILE_BYTES = 60_000
MAX_RAW_FETCH_BYTES = 500_000
MAX_TOTAL_CONTENT_BYTES = 48_000

# Directories that are never architecturally interesting.
SKIP_DIR_SEGMENTS = {
    "node_modules", "vendor", "dist", "build", ".next", "out", "coverage",
    "__pycache__", ".venv", "venv", "env", "site-packages", ".git",
    "migrations/versions", "locales", "fixtures", "__snapshots__",
}

# Files whose contents carry high architectural signal, in priority order.
# Each tuple is (glob pattern, category, priority) where lower priority
# number means fetched first when we hit the file cap.
SIGNAL_PATTERNS: list[tuple[str, str, int]] = [
    # Infrastructure and deployment
    ("docker-compose*.y*ml", "infrastructure", 1),
    ("Dockerfile*", "infrastructure", 1),
    ("*.tf", "infrastructure", 3),
    ("k8s/**/*.y*ml", "infrastructure", 3),
    (".github/workflows/*.y*ml", "infrastructure", 3),
    ("Procfile", "infrastructure", 2),
    ("render.yaml", "infrastructure", 2),
    ("vercel.json", "infrastructure", 3),

    # Dependency manifests (already parsed elsewhere, but content helps)
    ("package.json", "manifest", 1),
    ("requirements.txt", "manifest", 1),
    ("pyproject.toml", "manifest", 1),
    ("go.mod", "manifest", 1),
    ("Cargo.toml", "manifest", 1),

    # Entry points
    ("main.py", "entrypoint", 1),
    ("app.py", "entrypoint", 1),
    ("index.js", "entrypoint", 2),
    ("index.ts", "entrypoint", 2),
    ("server.js", "entrypoint", 1),
    ("server.ts", "entrypoint", 1),
    ("app/main.py", "entrypoint", 1),
    ("src/index.*", "entrypoint", 2),
    ("src/main.*", "entrypoint", 2),
    ("cmd/**/main.go", "entrypoint", 1),

    # Data model / schema: what the business actually stores
    ("**/schema.prisma", "data_model", 1),
    ("**/models.py", "data_model", 1),
    ("**/models/*.py", "data_model", 1),
    ("**/models/*.ts", "data_model", 2),
    ("**/models/*.js", "data_model", 2),
    ("**/entities/*.ts", "data_model", 2),
    ("**/schema.sql", "data_model", 1),
    ("**/schema.ts", "data_model", 2),
    ("**/*.schema.ts", "data_model", 3),

    # API surface: what the system exposes
    ("**/routers/*.py", "api_surface", 1),
    ("**/routes/*.js", "api_surface", 2),
    ("**/routes/*.ts", "api_surface", 2),
    ("**/api/**/*.ts", "api_surface", 3),
    ("**/controllers/*.*", "api_surface", 2),
    ("**/handlers/*.go", "api_surface", 2),

    # Business logic: where the genuinely hard engineering lives
    ("**/services/*.py", "business_logic", 1),
    ("**/services/*.ts", "business_logic", 1),
    ("**/services/*.js", "business_logic", 1),
    ("**/lib/*.ts", "business_logic", 3),
    ("**/core/*.py", "business_logic", 2),
    ("**/workers/*.*", "business_logic", 2),
    ("**/jobs/*.*", "business_logic", 3),
]

# Third-party systems worth calling out by name if we find them referenced.
# Maps a detection substring to (display name, category).
INTEGRATION_SIGNALS: dict[str, tuple[str, str]] = {
    "stripe": ("Stripe", "payments"),
    "paystack": ("Paystack", "payments"),
    "flutterwave": ("Flutterwave", "payments"),
    "pawapay": ("pawaPay", "payments"),
    "plaid": ("Plaid", "financial data"),
    "twilio": ("Twilio", "messaging"),
    "whatsapp": ("WhatsApp", "messaging"),
    "sendgrid": ("SendGrid", "email"),
    "postmark": ("Postmark", "email"),
    "openai": ("OpenAI", "AI"),
    "anthropic": ("Anthropic", "AI"),
    "supabase": ("Supabase", "backend platform"),
    "firebase": ("Firebase", "backend platform"),
    "redis": ("Redis", "caching/queues"),
    "postgres": ("PostgreSQL", "database"),
    "mongodb": ("MongoDB", "database"),
    "mongoose": ("MongoDB", "database"),
    "prisma": ("Prisma ORM", "database"),
    "sqlalchemy": ("SQLAlchemy", "database"),
    "kafka": ("Kafka", "event streaming"),
    "rabbitmq": ("RabbitMQ", "message queue"),
    "celery": ("Celery", "task queue"),
    "bullmq": ("BullMQ", "task queue"),
    "s3": ("AWS S3", "storage"),
    "cloudinary": ("Cloudinary", "media"),
    "web3": ("Web3", "blockchain"),
    "ethers": ("Ethers.js", "blockchain"),
    "solana": ("Solana", "blockchain"),
}

# Engineering-maturity markers: presence of these in the tree says
# something real about how the team operates.
MATURITY_MARKERS: dict[str, str] = {
    ".github/workflows": "Continuous integration configured",
    "docker-compose": "Containerized local environment",
    "Dockerfile": "Containerized deployment",
    "migrations": "Versioned database migrations",
    "alembic": "Versioned database migrations (Alembic)",
    ".env.example": "Documented environment configuration",
    "tests/": "Dedicated test suite",
    "__tests__": "Dedicated test suite",
    ".eslintrc": "Enforced code style",
    "tsconfig.json": "Static typing (TypeScript)",
    "mypy.ini": "Static typing (mypy)",
    "sentry": "Error monitoring",
    "openapi": "API specification",
    "swagger": "API specification",
}


@dataclass
class SourceFile:
    path: str
    category: str
    content: str


@dataclass
class DeepRepoAnalysis:
    full_name: str
    description: str | None
    primary_language: str
    languages: dict[str, int]
    total_code_bytes: int
    contributor_count: int
    commit_count_last_90_days: int
    last_pushed_at: str | None

    # The parts that actually matter
    files_read: list[str] = field(default_factory=list)
    directory_structure: list[str] = field(default_factory=list)
    detected_integrations: list[dict] = field(default_factory=list)
    maturity_signals: list[str] = field(default_factory=list)
    dependencies_by_manifest: dict[str, list[str]] = field(default_factory=dict)
    source_excerpts: list[dict] = field(default_factory=list)
    api_endpoint_count: int = 0
    data_model_names: list[str] = field(default_factory=list)


async def _gh_get(client: httpx.AsyncClient, path: str, token: str) -> httpx.Response:
    return await client.get(
        f"{GITHUB_API}{path}",
        headers={
            "Authorization": f"Bearer {token}",
            "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
        },
        timeout=30,
    )


def _should_skip(path: str) -> bool:
    lowered = path.lower()
    return any(seg in lowered for seg in SKIP_DIR_SEGMENTS)


def _select_files(paths: list[str]) -> list[tuple[str, str, int]]:
    """
    Picks which files to actually fetch, by matching against SIGNAL_PATTERNS.
    Returns (path, category, priority), deduped and priority-sorted.
    """
    selected: dict[str, tuple[str, str, int]] = {}
    for path in paths:
        if _should_skip(path):
            continue
        for pattern, category, priority in SIGNAL_PATTERNS:
            # fnmatch doesn't handle ** the way glob does, so test both the
            # full path and the bare filename to catch nested matches.
            filename = path.split("/")[-1]
            simple_pattern = pattern.replace("**/", "")
            if fnmatch.fnmatch(path, pattern) or fnmatch.fnmatch(filename, simple_pattern):
                existing = selected.get(path)
                if not existing or priority < existing[2]:
                    selected[path] = (path, category, priority)
                break
    return sorted(selected.values(), key=lambda t: (t[2], len(t[0])))


async def _fetch_file(client: httpx.AsyncClient, full_name: str, path: str, token: str) -> str | None:
    resp = await _gh_get(client, f"/repos/{full_name}/contents/{path}", token)
    if resp.status_code != 200:
        return None
    payload = resp.json()
    if payload.get("size", 0) > MAX_FILE_BYTES:
        return None
    content_b64 = payload.get("content")
    if not content_b64:
        return None
    try:
        return base64.b64decode(content_b64).decode("utf-8", errors="ignore")
    except Exception:
        return None


def _detect_integrations(files: list[SourceFile]) -> list[dict]:
    """
    Finds third-party systems actually referenced in source, and counts how
    many distinct files touch each one, which is a rough proxy for how
    deeply integrated it is versus a passing mention.
    """
    hits: dict[str, set[str]] = {}
    for f in files:
        lowered = f.content.lower()
        for needle, (display, category) in INTEGRATION_SIGNALS.items():
            if needle in lowered:
                hits.setdefault(f"{display}||{category}", set()).add(f.path)

    results = []
    for key, paths in hits.items():
        display, category = key.split("||")
        results.append({
            "name": display,
            "category": category,
            "file_count": len(paths),
            "example_paths": sorted(paths)[:3],
        })
    return sorted(results, key=lambda r: -r["file_count"])


def _detect_maturity(all_paths: list[str]) -> list[str]:
    joined = "\n".join(all_paths).lower()
    found = []
    for marker, description in MATURITY_MARKERS.items():
        if marker.lower() in joined and description not in found:
            found.append(description)
    return found


def _count_api_endpoints(files: list[SourceFile]) -> int:
    """
    Counts route declarations across common frameworks. Approximate by
    design, it's a scale signal ("dozens of endpoints" vs "a handful"),
    not a precise API inventory.
    """
    markers = [
        "@router.get", "@router.post", "@router.put", "@router.delete", "@router.patch",
        "@app.get", "@app.post", "@app.put", "@app.delete",
        "router.get(", "router.post(", "router.put(", "router.delete(",
        "app.get(", "app.post(", "app.put(", "app.delete(",
        "@Get(", "@Post(", "@Put(", "@Delete(",
    ]
    count = 0
    for f in files:
        if f.category not in ("api_surface", "entrypoint"):
            continue
        for marker in markers:
            count += f.content.count(marker)
    return count


def _extract_model_names(files: list[SourceFile]) -> list[str]:
    """
    Pulls declared data-model/table names out of model files. What a system
    stores is often the clearest statement of what the business actually is.
    """
    names: list[str] = []
    for f in files:
        if f.category != "data_model":
            continue
        for line in f.content.splitlines():
            stripped = line.strip()
            # SQLAlchemy / Django style
            if stripped.startswith("__tablename__"):
                parts = stripped.split("=")
                if len(parts) > 1:
                    names.append(parts[1].strip().strip("\"'"))
            # Prisma
            elif stripped.startswith("model ") and "{" in stripped:
                names.append(stripped.split()[1])
            # Mongoose
            elif ".model(" in stripped:
                seg = stripped.split(".model(")[1]
                if seg:
                    names.append(seg.split(",")[0].strip().strip("\"'"))
            # SQL
            elif stripped.lower().startswith("create table"):
                tokens = stripped.split()
                if len(tokens) >= 3:
                    names.append(tokens[2].strip('"`;()'))
    # Dedupe, preserve order, drop obvious noise
    seen = set()
    cleaned = []
    for n in names:
        n = n.strip()
        if n and n not in seen and len(n) < 60:
            seen.add(n)
            cleaned.append(n)
    return cleaned[:40]


def _summarize_structure(paths: list[str]) -> list[str]:
    """Top-level and second-level directories, to show system shape."""
    dirs: dict[str, int] = {}
    for p in paths:
        if _should_skip(p):
            continue
        parts = p.split("/")
        if len(parts) > 1:
            top = parts[0]
            dirs[top] = dirs.get(top, 0) + 1
            if len(parts) > 2:
                second = f"{parts[0]}/{parts[1]}"
                dirs[second] = dirs.get(second, 0) + 1
    ranked = sorted(dirs.items(), key=lambda kv: -kv[1])
    return [f"{d} ({c} files)" for d, c in ranked[:25]]


async def analyze_repo_deeply(token: str, full_name: str) -> DeepRepoAnalysis:
    async with httpx.AsyncClient() as client:
        repo_resp = await _gh_get(client, f"/repos/{full_name}", token)
        if repo_resp.status_code in (403, 404):
            raise ValueError(
                f"Repo '{full_name}' not found or not accessible. Check it was granted during GitHub App install."
            )
        repo_resp.raise_for_status()
        repo = repo_resp.json()

        languages_resp = await _gh_get(client, f"/repos/{full_name}/languages", token)
        languages = languages_resp.json() if languages_resp.status_code == 200 else {}

        contributors_resp = await _gh_get(client, f"/repos/{full_name}/contributors?per_page=100", token)
        contributors = contributors_resp.json() if contributors_resp.status_code == 200 else []

        from datetime import datetime, timedelta, timezone
        since = (datetime.now(timezone.utc) - timedelta(days=90)).strftime("%Y-%m-%dT%H:%M:%SZ")
        commits_resp = await _gh_get(client, f"/repos/{full_name}/commits?since={since}&per_page=100", token)
        commits = commits_resp.json() if commits_resp.status_code == 200 else []

        tree_resp = await _gh_get(
            client, f"/repos/{full_name}/git/trees/{repo['default_branch']}?recursive=1", token
        )
        all_paths: list[str] = []
        if tree_resp.status_code == 200:
            all_paths = [
                item["path"] for item in tree_resp.json().get("tree", []) if item.get("type") == "blob"
            ]

        # Select and fetch the highest-signal files, in parallel batches.
        selected = _select_files(all_paths)[:MAX_FILES_TO_READ]
        source_files: list[SourceFile] = []
        total_bytes = 0

        async def fetch_one(path: str, category: str):
            content = await _fetch_file(client, full_name, path, token)
            if content:
                return SourceFile(path=path, category=category, content=content)
            return None

        results = await asyncio.gather(
            *[fetch_one(path, category) for path, category, _ in selected],
            return_exceptions=True,
        )
        for r in results:
            if isinstance(r, SourceFile):
                if total_bytes + len(r.content) > MAX_RAW_FETCH_BYTES:
                    continue
                total_bytes += len(r.content)
                source_files.append(r)

    # Parse dependency manifests from the content we already fetched.
    deps: dict[str, list[str]] = {}
    for f in source_files:
        if f.category != "manifest":
            continue
        if f.path.endswith("package.json"):
            import json
            try:
                data = json.loads(f.content)
                deps[f.path] = list(data.get("dependencies", {}).keys())[:40]
            except Exception:
                pass
        elif f.path.endswith("requirements.txt"):
            deps[f.path] = [
                line.strip().split("==")[0].split(">=")[0]
                for line in f.content.splitlines()
                if line.strip() and not line.startswith("#")
            ][:40]

    return DeepRepoAnalysis(
        full_name=repo["full_name"],
        description=repo.get("description"),
        primary_language=repo.get("language") or "unknown",
        languages=languages,
        total_code_bytes=sum(languages.values()) if languages else 0,
        contributor_count=len(contributors) if isinstance(contributors, list) else 0,
        commit_count_last_90_days=len(commits) if isinstance(commits, list) else 0,
        last_pushed_at=repo.get("pushed_at"),
        files_read=[f.path for f in source_files],
        directory_structure=_summarize_structure(all_paths),
        detected_integrations=_detect_integrations(source_files),
        maturity_signals=_detect_maturity(all_paths),
        dependencies_by_manifest=deps,
        # Distilled, not truncated: each file is reduced to its structural
        # skeleton so the model sees architecture across many files rather
        # than the opening lines of a few.
        source_excerpts=budget_files(
            [(f.path, f.category, f.content) for f in source_files],
            MAX_TOTAL_CONTENT_BYTES,
        ),
        api_endpoint_count=_count_api_endpoints(source_files),
        data_model_names=_extract_model_names(source_files),
    )
