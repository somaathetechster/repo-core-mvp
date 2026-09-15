from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.core.config import settings
from app.core.db import init_models
from app.routers import github_auth, repos, company_profile, decks, data_records, export

app = FastAPI(title="repo-core API")

# In local dev, Vite may bump to a different port (5174, 5175, ...) if the
# default is already taken by another running instance. Allow a small range
# of localhost ports so this doesn't silently break every time that happens.
_dev_origins = [f"http://localhost:{p}" for p in range(5173, 5180)]

# Defensive: a trailing slash on FRONTEND_URL (e.g. "https://x.vercel.app/")
# will never match the Origin header the browser actually sends (which never
# has a trailing slash), causing every single request to fail CORS silently.
_frontend_url = settings.frontend_url.rstrip("/")

_configured_origins = list({_frontend_url, *_dev_origins})
print(f"[CORS] Allowed exact origins: {_configured_origins}")
print("[CORS] Also allowing any *.vercel.app origin via regex, for preview deployments.")

app.add_middleware(
    CORSMiddleware,
    allow_origins=_configured_origins,
    # Vercel gives every deployment (production + every preview/PR build) its
    # own unique subdomain. Rather than updating FRONTEND_URL by hand every
    # time a new preview URL shows up, trust the whole *.vercel.app pattern.
    # This is safe: it only widens which origins can CALL the API, it does
    # not grant those origins any elevated access, normal auth still applies.
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


@app.on_event("startup")
async def on_startup():
    await init_models()


@app.get("/health")
async def health():
    return {"status": "ok"}
