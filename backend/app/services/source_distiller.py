"""
Source distillation: extracting the architecturally meaningful parts of a
file instead of sending raw truncated text to a model.

The naive approach, taking the first N characters of each file, wastes most
of its budget on imports, licence headers, and whatever happens to sit at
the top. It also blows through token limits fast: 40 files at 6,000
characters each is roughly 100k tokens, far above a typical per-minute
allowance.

What actually carries architectural signal is the skeleton: class and
function signatures, route declarations, model fields, integration calls,
and control-flow around external systems. A distilled file is often a tenth
the size of the original while saying considerably more about the design.
"""
import re

# Lines matching these carry structure. Ordered roughly by signal value.
SIGNATURE_PATTERNS = [
    # Python
    r"^\s*(async\s+)?def\s+\w+\s*\(",
    r"^\s*class\s+\w+",
    r"^\s*@\w+",                                  # decorators: routes, tasks, validators
    r"^\s*\w+\s*:\s*Mapped\[",                    # SQLAlchemy columns
    r"^\s*__tablename__",
    # JS / TS
    r"^\s*(export\s+)?(async\s+)?function\s+\w+",
    r"^\s*(export\s+)?const\s+\w+\s*=\s*(async\s*)?\(",
    r"^\s*(export\s+)?class\s+\w+",
    r"^\s*(export\s+)?(interface|type)\s+\w+",
    r"^\s*(app|router|server)\.(get|post|put|patch|delete|use)\s*\(",
    r"^\s*\w+\.(model|schema|define)\s*\(",
    # Go
    r"^\s*func\s+",
    r"^\s*type\s+\w+\s+struct",
    # Config-ish
    r"^\s*(FROM|RUN|CMD|ENTRYPOINT|EXPOSE)\s",     # Dockerfile
]

_SIGNATURE_RE = re.compile("|".join(f"({p})" for p in SIGNATURE_PATTERNS), re.MULTILINE)

# Lines referencing these suggest real integration work rather than glue.
INTEGRATION_HINTS = re.compile(
    r"(fetch|axios|requests\.|httpx|http\.|client\.|\.query\(|\.execute\(|"
    r"transaction|webhook|retry|idempot|reconcil|settle|payout|ledger|"
    r"signature|verify|encrypt|decrypt|queue|publish|subscribe|consumer)",
    re.IGNORECASE,
)

COMMENT_PREFIXES = ("#", "//", "*", "/*", '"""', "'''")


def distil_file(path: str, content: str, max_chars: int = 1800) -> str:
    """
    Reduces a source file to its structural skeleton plus the lines that
    touch external systems or hard logic.

    Keeps a line when it declares structure, references an integration, or
    immediately follows a declaration (the first line of a body often
    states what the function actually does).
    """
    lines = content.splitlines()
    if not lines:
        return ""

    kept: list[str] = []
    keep_next = 0

    for line in lines:
        stripped = line.strip()
        if not stripped:
            continue

        is_signature = bool(_SIGNATURE_RE.match(line))
        is_integration = bool(INTEGRATION_HINTS.search(line)) and not stripped.startswith(COMMENT_PREFIXES)

        if is_signature:
            kept.append(line.rstrip())
            keep_next = 1          # take the first body line for context
        elif keep_next > 0:
            if not stripped.startswith(COMMENT_PREFIXES):
                kept.append(line.rstrip())
            keep_next -= 1
        elif is_integration:
            kept.append(line.rstrip())

        if sum(len(k) for k in kept) > max_chars:
            kept.append("    …")
            break

    if not kept:
        # No structure found (a config file, say). Fall back to a short head,
        # which for small config files is the whole meaningful content anyway.
        return "\n".join(lines[:24])[:max_chars]

    return "\n".join(kept)


def budget_files(
    files: list[tuple[str, str, str]],
    total_char_budget: int,
) -> list[dict]:
    """
    Distils a set of (path, category, content) files to fit inside a total
    character budget, allocating more room to higher-signal categories.

    Business logic and data models get the largest share, because that's
    where the answerable questions live. Manifests get very little; their
    dependency lists are already extracted separately.
    """
    weights = {
        "business_logic": 3.0,
        "data_model": 3.0,
        "api_surface": 2.0,
        "entrypoint": 2.0,
        "infrastructure": 1.0,
        "manifest": 0.4,
    }

    total_weight = sum(weights.get(cat, 1.0) for _, cat, _ in files) or 1.0
    out: list[dict] = []

    for path, category, content in files:
        share = weights.get(category, 1.0) / total_weight
        allowance = max(400, int(total_char_budget * share))
        distilled = distil_file(path, content, max_chars=allowance)
        if distilled.strip():
            out.append({"path": path, "category": category, "content": distilled})

    return out
