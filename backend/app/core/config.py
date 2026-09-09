"""
Central settings. Never hardcode secrets — everything comes from env vars.
Copy .env.example to .env and fill in real values for local dev.
"""
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # GitHub OAuth App credentials (create at github.com/settings/developers)
    github_client_id: str = ""
    github_client_secret: str = ""
    github_oauth_redirect_uri: str = "http://localhost:8000/auth/github/callback"

    # Fernet key for encrypting stored OAuth tokens at rest.
    # Generate with: python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
    token_encryption_key: str = ""

    # Anthropic
    anthropic_api_key: str = ""

    # DB
    database_url: str = "postgresql+asyncpg://postgres:postgres@localhost:5432/repo_core"

    # Where the frontend lives, for CORS + post-oauth redirect
    frontend_url: str = "http://localhost:5173"


settings = Settings()
