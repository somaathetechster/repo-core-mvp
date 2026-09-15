"""
Turns a connected GitHub repo into a structured, factual summary — NOT a raw
file dump. This structured object is what gets handed to Claude for the
narrative-writing step. Keeping this separate means:
  - cheaper/faster LLM calls (no need to paste thousands of lines of code)
  - claims are traceable back to a specific field (LOC count, dep file, etc.)
  - we don't ship a customer's full proprietary source into a prompt
    unless a specific, later "deep code review" feature explicitly opts into it
"""
import base64
import httpx
from pydantic import BaseModel

GITHUB_API = "https://api.github.com"

# Dependency manifest files we know how to parse, mapped to a simple label.
MANIFEST_FILES = {
    "package.json": "node",
    "requirements.txt": "python",
    "pyproject.toml": "python",
    "go.mod": "go",
    "Gemfile": "ruby",
    "Cargo.toml": "rust",
}


class RepoSummary(BaseModel):
    full_name: str
    description: str | None
    primary_language: str | None
    languages: dict[str, int]  # language -> bytes, from GitHub's own detection
    stars: int
    default_branch: str
    contributor_count: int
    commit_count_last_90_days: int
    detected_dependencies: dict[str, list[str]]  # manifest file -> top-level deps
    has_tests: bool
    readme_excerpt: str | None
    last_pushed_at: str | None


async def _gh_get(client: httpx.AsyncClient, path: str, token: str) -> httpx.Response:
    return await client.get(
        f"{GITHUB_API}{path}",
        headers={
            "Authorization": f"Bearer {token}",
            "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
        },
    )


async def list_installation_repos(token: str, installation_id: str) -> list[dict]:
    """
    List only the repos the user actually granted during GitHub App install —
    not everything the token could theoretically see. This is the whole point
    of using a GitHub App instead of a plain OAuth App.
    """
    async with httpx.AsyncClient() as client:
        resp = await _gh_get(
            client, f"/user/installations/{installation_id}/repositories?per_page=100", token
        )
        resp.raise_for_status()
        data = resp.json()
        return [
            {
                "full_name": r["full_name"],
                "private": r["private"],
                "description": r.get("description"),
                "updated_at": r["updated_at"],
            }
            for r in data.get("repositories", [])
        ]


async def extract_repo_summary(token: str, full_name: str) -> RepoSummary:
    async with httpx.AsyncClient() as client:
        repo_resp = await _gh_get(client, f"/repos/{full_name}", token)
        if repo_resp.status_code in (403, 404):
            raise ValueError(f"Repo '{full_name}' not found or not accessible — check it was granted during GitHub App install.")
        repo_resp.raise_for_status()
        repo = repo_resp.json()
        languages = (await _gh_get(client, f"/repos/{full_name}/languages", token)).json()
        contributors = (await _gh_get(client, f"/repos/{full_name}/contributors?per_page=100", token)).json()
        commits = (await _gh_get(
            client, f"/repos/{full_name}/commits?since={_ninety_days_ago_iso()}&per_page=100", token
        )).json()

        readme_excerpt = None
        readme_resp = await _gh_get(client, f"/repos/{full_name}/readme", token)
        if readme_resp.status_code == 200:
            content = readme_resp.json().get("content", "")
            try:
                decoded = base64.b64decode(content).decode("utf-8", errors="ignore")
                readme_excerpt = decoded[:1500]  # cap it — we don't need the whole thing
            except Exception:
                pass

        detected_deps: dict[str, list[str]] = {}
        has_tests = False
        tree_resp = await _gh_get(
            client, f"/repos/{full_name}/git/trees/{repo['default_branch']}?recursive=1", token
        )
        if tree_resp.status_code == 200:
            paths = [item["path"] for item in tree_resp.json().get("tree", [])]
            has_tests = any(
                "test" in p.lower() or "spec" in p.lower() for p in paths
            )
            for path in paths:
                filename = path.split("/")[-1]
                if filename in MANIFEST_FILES and "/" not in path:  # root-level only for v1
                    deps = await _fetch_and_parse_manifest(client, full_name, path, filename, token)
                    if deps:
                        detected_deps[filename] = deps

        return RepoSummary(
            full_name=repo["full_name"],
            description=repo.get("description"),
            primary_language=repo.get("language"),
            languages=languages,
            stars=repo.get("stargazers_count", 0),
            default_branch=repo["default_branch"],
            contributor_count=len(contributors) if isinstance(contributors, list) else 0,
            commit_count_last_90_days=len(commits) if isinstance(commits, list) else 0,
            detected_dependencies=detected_deps,
            has_tests=has_tests,
            readme_excerpt=readme_excerpt,
            last_pushed_at=repo.get("pushed_at"),
        )


async def _fetch_and_parse_manifest(
    client: httpx.AsyncClient, full_name: str, path: str, filename: str, token: str
) -> list[str]:
    resp = await _gh_get(client, f"/repos/{full_name}/contents/{path}", token)
    if resp.status_code != 200:
        return []
    try:
        content = base64.b64decode(resp.json()["content"]).decode("utf-8", errors="ignore")
    except Exception:
        return []

    if filename == "package.json":
        import json
        try:
            data = json.loads(content)
            deps = list(data.get("dependencies", {}).keys())
            return deps[:25]  # top-level only, cap it
        except Exception:
            return []
    elif filename == "requirements.txt":
        lines = [l.strip().split("==")[0].split(">=")[0] for l in content.splitlines() if l.strip() and not l.startswith("#")]
        return lines[:25]
    # go.mod / Gemfile / Cargo.toml parsing can be added the same way when needed
    return []


def _ninety_days_ago_iso() -> str:
    from datetime import datetime, timedelta, timezone
    return (datetime.now(timezone.utc) - timedelta(days=90)).strftime("%Y-%m-%dT%H:%M:%SZ")
