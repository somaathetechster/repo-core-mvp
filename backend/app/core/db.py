"""
Async SQLAlchemy setup. One engine for the whole app; sessions are created
per-request via get_db().
"""
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from sqlalchemy.orm import DeclarativeBase

from app.core.config import settings

engine = create_async_engine(settings.database_url, pool_pre_ping=True)
AsyncSessionLocal = async_sessionmaker(engine, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


async def get_db():
    async with AsyncSessionLocal() as session:
        yield session


async def init_models():
    """Create tables if they don't exist. Fine for early dev; switch to real
    migrations (Alembic) once the schema needs to evolve carefully."""
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
