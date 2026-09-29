import os
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.core.config import settings
from app.core.db import init_models
# Imported for the side effect of registering the tables on Base.metadata,
# so create_all knows about them. Without this the billing tables are never
# created and every entitlement check fails at runtime.
from app.models import billing as _billing_models  # noqa: F401
from app.models import support as _support_models  # noqa: F401
from app.routers import github_auth, repos, company_profile, decks, data_records, export, data_studio, deck_import, billing, support, payments, ai

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
_configured_origins = list({_frontend_url, *_dev_origins, *_extra})
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


@app.on_event("startup")
async def on_startup():
    await init_models()


@app.get("/health")
async def health():
    return {"status": "ok"}
