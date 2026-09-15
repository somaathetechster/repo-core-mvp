from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.core.config import settings
from app.core.db import init_models
from app.routers import github_auth, repos, company_profile, decks, data_records, export

app = FastAPI(title="repo-core API")

# In local dev, Vite may bump to a different port (5174, 5175, ...) if the
# default is already taken by another running instance. Allow a small range
# of localhost ports so this doesn't silently break every time that happens.
# In production, replace this with the single real frontend origin.
_dev_origins = [f"http://localhost:{p}" for p in range(5173, 5180)]

app.add_middleware(
    CORSMiddleware,
    allow_origins=list({settings.frontend_url, *_dev_origins}),
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
