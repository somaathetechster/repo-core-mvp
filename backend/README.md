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
   - Create a Supabase project at supabase.com, then from Project Settings -> API fill in:
     `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_JWT_SECRET` (under JWT Settings —
     the signing secret, not the anon/service keys)
4. `uvicorn app.main:app --reload --port 8000`
5. Visit `http://localhost:8000/docs` for interactive API docs.

## Auth model

Real users authenticate via Supabase (email/password by default; Google/GitHub login etc.
can be turned on in the Supabase dashboard with no code changes). The frontend gets a JWT
from Supabase and sends it as `Authorization: Bearer <token>` on every request. The backend
verifies that JWT locally in `app/core/deps.py` (no network call per request) and trusts the
`sub` claim as the user id — that's the entire trust boundary.

The one exception: `GET /auth/github/login` is a plain browser redirect (an `<a href>` /
`window.location`), which can't carry a custom header — so that single route accepts the
token as a query param instead (`get_current_user_id_from_query`). Every other route uses
the header-based path. Don't extend the query-param path to other routes; a token in a URL
is more exposure-prone (browser history, server access logs) than one in a header.

## What's intentionally stubbed for now

- `app/services/github_store.py` — in-memory dict instead of a real DB table. Swap in
  SQLAlchemy once Postgres is wired up (Supabase's own Postgres instance works fine for this —
  one less service to run); the function signatures won't need to change.
- OAuth `state` param (CSRF protection during the GitHub handshake) is stored in-memory —
  fine for one process, needs Redis/DB once you run more than one backend instance.
