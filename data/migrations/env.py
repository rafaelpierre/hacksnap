"""Alembic environment using the project's IPv4 Supabase pooler."""

from __future__ import annotations

from logging.config import fileConfig

from alembic import context
from sqlalchemy import create_engine, pool

from hn_trending.cli import resolve_database_url


config = context.config
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

target_metadata = None


def sqlalchemy_database_url() -> str:
    """Translate the psycopg connection URI for SQLAlchemy's psycopg v3 dialect."""
    return resolve_database_url().replace("postgresql://", "postgresql+psycopg://", 1)


def run_migrations_offline() -> None:
    """Emit SQL without opening a database connection."""
    context.configure(
        url=sqlalchemy_database_url(),
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    """Run migrations through the TLS-protected IPv4 session pooler."""
    connectable = create_engine(sqlalchemy_database_url(), poolclass=pool.NullPool)
    with connectable.connect() as connection:
        context.configure(connection=connection, target_metadata=target_metadata)
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
