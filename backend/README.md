# repo-core backend (FastAPI)

## Setup

1. `python -m venv .venv && source .venv/bin/activate`
2. `pip install -r requirements.txt`
3. `cp .env.example .env` and fill in:
   - Create a GitHub OAuth App at https://github.com/settings/developers
     - Homepage URL: `http://localhost:5173`
     - Authorization callback URL: `http://localhost:8000/auth/github/callback`
     - Copy Client ID + generate a Client Secret into `.env`
   - Generate `TOKEN_ENCRYPTION_KEY`:
     `python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"`
   - Add your `ANTHROPIC_API_KEY`
4. `uvicorn app.main:app --reload --port 8000`
5. Visit `http://localhost:8000/docs` for interactive API docs.

## Flow to test manually right now (no frontend needed yet)

1. `GET /auth/github/login` with header `X-User-Id: test-user-1` — this redirects to GitHub.
2. Approve access to a repo you own (can be private).
3. You'll land back at `FRONTEND_URL/connect/github?status=success` — ignore the 404, the token is already saved.
4. `GET /repos` with `X-User-Id: test-user-1` — lists repos the token can see.
5. `POST /repos/{owner}/{repo}/analyze` with `X-User-Id: test-user-1` — runs extraction + generates
   the first AI-written slide content, with every claim traceable to the returned `summary` object.

## What's intentionally stubbed for now

- `app/core/deps.py` — trusts an `X-User-Id` header. Replace with real session/JWT auth before
  anything touches production.
- `app/services/github_store.py` — in-memory dict instead of a real DB table. Swap in SQLAlchemy
  once Postgres is wired up; the function signatures won't need to change.
- OAuth `state` param is stored in-memory — fine for one process, needs Redis/DB once you run
  more than one backend instance.
