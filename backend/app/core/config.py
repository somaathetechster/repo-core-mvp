"""
Central settings. Never hardcode secrets — everything comes from env vars.
Copy .env.example to .env and fill in real values for local dev.
"""
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # GitHub App (github.com/settings/apps) — user picks which repos to grant during install,
    # unlike an OAuth App which gets blanket access to everything.
    github_app_slug: str = ""          # from the app's URL: github.com/apps/<slug>
    github_client_id: str = ""         # GitHub App's OAuth Client ID
    github_client_secret: str = ""     # GitHub App's OAuth Client Secret
    github_oauth_redirect_uri: str = "http://localhost:8000/auth/github/callback"

    # Fernet key for encrypting stored OAuth tokens at rest.
    # Generate with: python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
    token_encryption_key: str = ""

    # Anthropic
    anthropic_api_key: str = ""

    # OpenAI
    openai_api_key: str = ""

    # Which provider to use by default: "anthropic" or "openai"
    ai_provider: str = "anthropic"

    # Supabase Auth — used to verify JWTs on incoming requests.
    # Find under Supabase project settings -> API -> JWT Settings -> JWT Secret.
    supabase_jwt_secret: str = ""
    supabase_url: str = ""  # e.g. https://xxxx.supabase.co (frontend needs this too)
    supabase_anon_key: str = ""  # public, safe to expose to frontend

    # Service role key — NEVER expose this to the frontend or any client.
    # Used server-side only, to check via Supabase's Admin API whether a user
    # has a verified MFA factor enrolled, so 2FA can be enforced on the
    # backend and not just the UI. Find under Settings -> API -> service_role.
    supabase_service_role_key: str = ""

    # DB
    database_url: str = "postgresql+asyncpg://postgres:postgres@localhost:5432/repo_core"

    # Where the frontend lives, for CORS + post-oauth redirect
    frontend_url: str = "http://localhost:5173"


settings = Settings()
