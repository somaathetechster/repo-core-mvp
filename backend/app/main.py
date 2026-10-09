import asyncio
import logging
import os

import httpx
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.core.config import settings
from app.core.db import init_models
# Imported for the side effect of registering the tables on Base.metadata,
# so create_all knows about them. Without this the billing tables are never
# created and every entitlement check fails at runtime.
from app.models import billing as _billing_models  # noqa: F401
from app.models import support as _support_models  # noqa: F401
from app.models import review as _review_models  # noqa: F401
from app.routers import github_auth, repos, company_profile, decks, data_records, export, data_studio, deck_import, billing, support, payments, ai, review

app = FastAPI(title="repo-core API")

# In local dev, Vite may bump to a different port (5174, 5175, ...) if the
# default is already taken by another running instance. Allow a small range
# of localhost ports so this doesn't silently break every time that happens.
_dev_origins = [f"http://localhost:{p}" for p in range(5173, 5180)]

# Defensive: a trailing slash on FRONTEND_URL (e.g. "https://x.vercel.app/")
# will never match the Origin header the browser actually sends (which never
# has a trailing slash), causing every single request to fail CORS silently.
_frontend_url = settings.frontend_url.rstrip("/")

# EXTRA_ORIGINS lets you add more allowed origins without changing code:
# set it in Render to a comma-separated list, e.g.:
#   https://www.provisio.site,https://app.provisio.site
_extra = [
    o.strip().rstrip("/")
    for o in os.environ.get("EXTRA_ORIGINS", "").split(",")
    if o.strip()
]

def _with_www_variants(origins: list[str]) -> list[str]:
    """For every public origin, make sure both the www and non-www host are
    allowed, so e.g. https://provisio.site and https://www.provisio.site are
    always accepted together regardless of which one FRONTEND_URL/EXTRA_ORIGINS
    happens to supply. Local/dev origins (localhost, ports, bare IPs) are left
    untouched — the www prefix is meaningless there."""
    expanded: list[str] = []
    for origin in origins:
        expanded.append(origin)
        try:
            scheme, host = origin.split("://", 1)
        except ValueError:
            continue
        # Skip anything with a port or path, and localhost / IP-style hosts:
        # the www variant only makes sense for bare public domains.
        if ":" in host or "/" in host or host == "localhost":
            continue
        if host.replace(".", "").isdigit():  # e.g. 127.0.0.1
            continue
        variant = host[4:] if host.startswith("www.") else f"www.{host}"
        expanded.append(f"{scheme}://{variant}")
    return expanded


_configured_origins = list({*_with_www_variants([_frontend_url, *_extra]), *_dev_origins})
print(f"[CORS] Allowed origins: {_configured_origins}")
print("[CORS] Also allowing any *.vercel.app origin via regex.")

app.add_middleware(
    CORSMiddleware,
    allow_origins=_configured_origins,
    allow_origin_regex=r"https://.*\.vercel\.app",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(github_auth.router)
app.include_router(repos.router)
app.include_router(company_profile.router)
app.include_router(decks.router)
app.include_router(data_records.router)
app.include_router(export.router)
app.include_router(data_studio.router)
app.include_router(deck_import.router)
app.include_router(support.router)
app.include_router(support.admin)
app.include_router(billing.router)
app.include_router(billing.admin)
app.include_router(payments.router)
app.include_router(ai.router)
app.include_router(review.router)


@app.get("/health")
async def health():
    # Deliberately trivial: no DB, no auth, no logging. Body is `{"ok":true}`
    # (12 bytes), well under 20, so the self-ping below stays cheap.
    return {"ok": True}


# ── Internal keep-alive self-ping ────────────────────────────────────────
# Render (and similar hosts) idle a free web service after inactivity. Rather
# than paying an external pinger (cronjob.org / UptimeRobot), the app pings its
# own /health on the loopback interface every 4 minutes. The request never
# leaves the box — it targets localhost, so it consumes zero egress bandwidth.
_log = logging.getLogger("selfping")

# Render routes traffic to $PORT; 10000 is Render's default when unset.
_PORT = os.environ.get("PORT", "10000")
# Loopback only — never a public hostname. Keeps the ping on-box.
_SELF_PING_URL = f"http://localhost:{_PORT}/health"
_SELF_PING_INTERVAL = 240  # seconds (4 minutes)


async def _self_ping_loop():
    async with httpx.AsyncClient(timeout=10.0) as client:
        while True:
            await asyncio.sleep(_SELF_PING_INTERVAL)
            try:
                await client.get(_SELF_PING_URL)
            except Exception as exc:  # noqa: BLE001 — a failed ping must not crash the loop
                _log.warning("self-ping failed: %s", exc)


@app.on_event("startup")
async def on_startup():
    await init_models()
    # Hold a reference so the task isn't garbage-collected mid-flight.
    app.state.self_ping_task = asyncio.create_task(_self_ping_loop())


@app.on_event("shutdown")
async def on_shutdown():
    task = getattr(app.state, "self_ping_task", None)
    if task is not None:
        task.cancel()
