from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.core.config import settings
from app.routers import github_auth, repos

app = FastAPI(title="repo-core API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.frontend_url],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(github_auth.router)
app.include_router(repos.router)


@app.get("/health")
async def health():
    return {"status": "ok"}
