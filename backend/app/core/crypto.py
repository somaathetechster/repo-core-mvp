"""
Encrypt GitHub OAuth tokens (and any BYOK API keys, later) before they touch the DB.
We only decrypt in-memory, right before making the outbound API call.
"""
from cryptography.fernet import Fernet
from app.core.config import settings

_fernet = Fernet(settings.token_encryption_key.encode()) if settings.token_encryption_key else None


def encrypt_token(raw: str) -> str:
    if not _fernet:
        raise RuntimeError(
            "TOKEN_ENCRYPTION_KEY is not set. Generate one and put it in .env before storing any tokens."
        )
    return _fernet.encrypt(raw.encode()).decode()


def decrypt_token(encrypted: str) -> str:
    if not _fernet:
        raise RuntimeError("TOKEN_ENCRYPTION_KEY is not set.")
    return _fernet.decrypt(encrypted.encode()).decode()
