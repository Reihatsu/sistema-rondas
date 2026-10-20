"""Entorno de Alembic.

Toma la URL de conexión desde la configuración de la aplicación (``.env``) y
usa los metadatos de ``app.models.Base`` como objetivo de autogeneración.
"""

from __future__ import annotations

from logging.config import fileConfig

from alembic import context
from sqlalchemy import engine_from_config, pool

from app.core.config import settings
from app.core.database import create_database_if_not_exists
from app.models import Base  # importa todos los modelos

config = context.config

if config.config_file_name is not None:
    fileConfig(config.config_file_name)

# La URL siempre proviene de la configuración de la app (nunca del .ini).
config.set_main_option("sqlalchemy.url", settings.DATABASE_URL)

target_metadata = Base.metadata


def run_migrations_offline() -> None:
    """Genera el SQL de migración sin conectarse (``alembic upgrade --sql``)."""
    context.configure(
        url=settings.DATABASE_URL,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        compare_type=True,
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    """Ejecuta las migraciones contra la base de datos configurada."""
    # Garantiza que la base de datos exista antes de migrar (solo MySQL).
    create_database_if_not_exists()

    connectable = engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )

    with connectable.connect() as connection:
        context.configure(
            connection=connection,
            target_metadata=target_metadata,
            compare_type=True,
        )
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
