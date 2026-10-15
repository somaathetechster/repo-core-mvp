"""
Async SQLAlchemy setup. One engine for the whole app; sessions are created
per-request via get_db().
"""
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from sqlalchemy.orm import DeclarativeBase

from app.core.config import settings

# prepared_statement_cache_size / statement_cache_size are set to 0 because
# asyncpg's prepared-statement caching breaks behind a transaction-pooling
# proxy (pgbouncer / Supabase): a cached statement can land on a different
# backend connection than the one that prepared it, raising
# "prepared statement does not exist" / "already exists" errors.
#
# pool_pre_ping is disabled for the same reason: its per-checkout liveness
# probe runs an extra statement against a pooled connection, which is one more
# chance for a prepared statement to collide across backend connections.
engine = create_async_engine(
    settings.database_url,
    pool_pre_ping=False,
    connect_args={
        "prepared_statement_cache_size": 0,
        "statement_cache_size": 0,
        # Force generic plans so the server does not retain per-statement
        # custom plans tied to a prepared statement on a pooled connection.
        "server_settings": {
            "plan_cache_mode": "force_generic_plan",
        },
    },
)
AsyncSessionLocal = async_sessionmaker(engine, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


async def get_db():
    async with AsyncSessionLocal() as session:
        yield session


def _add_missing_columns(conn) -> list[str]:
    """
    Adds columns that exist on a model but not yet in the database.

    ``create_all`` only ever creates missing *tables*. Adding a field to an
    existing model therefore leaves the database one column short, and every
    query against that table fails — which looks like the whole API being
    down rather than one schema change being incomplete.

    This closes that gap for the additive case, which is the only kind of
    change made so far: new nullable-or-defaulted columns. It deliberately
    never drops, renames or retypes anything, so it cannot lose data. Once a
    change needs any of those, this should be replaced with Alembic.
    """
    from sqlalchemy import inspect as sa_inspect, text as sa_text

    inspector = sa_inspect(conn)
    existing_tables = set(inspector.get_table_names())
    applied: list[str] = []

    for table in Base.metadata.sorted_tables:
        if table.name not in existing_tables:
            continue  # create_all handles this one

        have = {c["name"] for c in inspector.get_columns(table.name)}
        for column in table.columns:
            if column.name in have:
                continue

            type_sql = column.type.compile(dialect=conn.dialect)
            # The membership check above already guarantees the column is
            # absent; IF NOT EXISTS is belt-and-braces and only Postgres
            # accepts it on ADD COLUMN.
            guard = "IF NOT EXISTS " if conn.dialect.name == "postgresql" else ""
            ddl = f'ALTER TABLE "{table.name}" ADD COLUMN {guard}"{column.name}" {type_sql}'

            # A scalar Python default becomes a server default, so existing
            # rows get a sensible value instead of NULL.
            default = getattr(column.default, "arg", None)
            if default is not None and not callable(default):
                literal = (
                    "true" if default is True else
                    "false" if default is False else
                    str(default) if isinstance(default, (int, float)) else
                    "'" + str(default).replace("'", "''") + "'"
                )
                ddl += f" DEFAULT {literal}"

            conn.execute(sa_text(ddl))

            # Backfill, then enforce NOT NULL, in that order — the reverse
            # fails on any table that already has rows.
            if not column.nullable:
                if default is not None and not callable(default):
                    conn.execute(sa_text(
                        f'UPDATE "{table.name}" SET "{column.name}" = {literal} '
                        f'WHERE "{column.name}" IS NULL'
                    ))
                    # SQLite can't alter a column's nullability in place. It
                    # isn't the production database, and the backfill above
                    # already means no NULLs, so skipping it is safe.
                    if conn.dialect.name == "postgresql":
                        conn.execute(sa_text(
                            f'ALTER TABLE "{table.name}" '
                            f'ALTER COLUMN "{column.name}" SET NOT NULL'
                        ))

            applied.append(f"{table.name}.{column.name}")

    return applied


async def init_models():
    """Create missing tables, then add any columns the models have gained."""
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        try:
            added = await conn.run_sync(_add_missing_columns)
            if added:
                print(f"[db] added missing columns: {', '.join(added)}")
        except Exception as exc:
            # A failed column add must not stop the app from booting; the
            # error is loud in the logs and the affected route will say so.
            print(f"[db] column sync failed: {exc!r}")
