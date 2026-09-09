"""
Placeholder persistence for encrypted GitHub tokens. Swap the in-memory dict
for a real `github_connections` table (user_id, encrypted_token, connected_at)
via SQLAlchemy once the DB is wired up. Interface stays the same either way.
"""
from app.core.crypto import decrypt_token

_fake_db: dict[str, str] = {}  # user_id -> encrypted_token


async def save_user_token(user_id: str, encrypted_token: str) -> None:
    _fake_db[user_id] = encrypted_token


async def get_user_token(user_id: str) -> str | None:
    encrypted = _fake_db.get(user_id)
    return decrypt_token(encrypted) if encrypted else None


async def delete_user_token(user_id: str) -> None:
    _fake_db.pop(user_id, None)
