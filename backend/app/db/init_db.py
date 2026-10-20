"""Inicialización de la base de datos y datos de arranque.

Se ejecuta al arrancar la API (``lifespan`` en ``app/main.py``) y es
idempotente:

* Crea la base de datos MySQL si no existe (en SQLite el archivo se crea solo).
* Crea todas las tablas desde los modelos SQLAlchemy (``create_all``).
* Si la base de datos está vacía, siembra los datos de demostración (empresa,
  usuarios, puntos de control y rondas) siempre que ``AUTO_SEED_DEMO`` sea
  verdadero. Esto permite que un despliegue gratuito en Render con SQLite
  arranque con datos utilizables sin pasos manuales.
* Crea el usuario ADMIN configurado (``AUTO_SEED_ADMIN``) si no existe.
"""

from __future__ import annotations

import logging

from sqlalchemy import func, inspect, select, text
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.database import SessionLocal, create_database_if_not_exists, engine
from app.core.security import hash_password
from app.db.seed import DEMO_USERS, seed_demo_data
from app.models import Base, User, UserRole  # importa todos los modelos

logger = logging.getLogger(__name__)


def seed_admin(db: Session) -> None:
    """Crea el usuario ADMIN inicial si todavía no existe."""
    existing = db.scalar(
        select(User).where(User.email == settings.FIRST_ADMIN_EMAIL.lower())
    )
    if existing is not None:
        return

    admin = User(
        name=settings.FIRST_ADMIN_NAME,
        email=settings.FIRST_ADMIN_EMAIL.lower(),
        password_hash=hash_password(settings.FIRST_ADMIN_PASSWORD),
        role=UserRole.ADMIN,
        is_active=True,
    )
    db.add(admin)
    db.commit()
    logger.info("Usuario ADMIN inicial creado: %s", admin.email)


def database_is_empty(db: Session) -> bool:
    """Indica si no hay ningún usuario (base de datos recién creada)."""
    return db.scalar(select(func.count()).select_from(User)) == 0


#: Columnas agregadas después de la creación inicial de las tablas.
#: ``create_all`` no modifica tablas existentes, así que en instalaciones que
#: no ejecutan Alembic se añaden aquí de forma idempotente.
_ADDITIVE_COLUMNS: tuple[tuple[str, str, str], ...] = (
    ("checkpoints", "latitude", "FLOAT NULL"),
    ("checkpoints", "longitude", "FLOAT NULL"),
    ("checkpoints", "geofence_radius_m", "INTEGER NOT NULL DEFAULT 50"),
    ("round_logs", "checkpoint_id", "INTEGER NULL"),
    ("round_logs", "latitude", "FLOAT NULL"),
    ("round_logs", "longitude", "FLOAT NULL"),
    ("round_logs", "distance_m", "FLOAT NULL"),
)


def sync_additive_columns() -> None:
    """Añade columnas nuevas a tablas ya existentes (compatibilidad con ``create_all``).

    Es una red de seguridad para instalaciones que arrancan con
    ``INIT_DB_ON_STARTUP`` y nunca ejecutan ``alembic upgrade head``. Solo
    agrega columnas nulables o con valor por defecto, de modo que no destruye
    información ni obliga a recrear las tablas.
    """
    inspector = inspect(engine)
    existing_tables = set(inspector.get_table_names())

    for table, column, ddl in _ADDITIVE_COLUMNS:
        if table not in existing_tables:
            continue
        existing_columns = {
            item["name"] for item in inspector.get_columns(table)
        }
        if column in existing_columns:
            continue

        with engine.begin() as connection:
            connection.execute(text(f"ALTER TABLE {table} ADD COLUMN {column} {ddl}"))

        logger.warning(
            "Columna %s.%s añadida automáticamente (esquema previo sin migrar).",
            table,
            column,
        )


def init_db() -> None:
    """Crea la base de datos/tablas y siembra los datos iniciales.

    Se ejecuta al arrancar la API (ver ``lifespan`` en ``app/main.py``) y es
    idempotente. Para entornos con migraciones controladas, desactive
    ``INIT_DB_ON_STARTUP`` y use ``alembic upgrade head``.
    """
    create_database_if_not_exists()
    Base.metadata.create_all(bind=engine)
    sync_additive_columns()
    logger.info(
        "Esquema de base de datos verificado (create_all) en %s.",
        settings.database_backend,
    )

    with SessionLocal() as db:
        if settings.AUTO_SEED_DEMO and database_is_empty(db):
            stats = seed_demo_data(db)
            logger.warning(
                "Base de datos vacía: se cargaron los datos de demostración "
                "(%d usuarios, %d puntos de control). Cuentas: %s. "
                "Defina AUTO_SEED_DEMO=false para desactivarlo.",
                stats["users"],
                stats["checkpoints"],
                ", ".join(str(spec["email"]) for spec in DEMO_USERS),
            )

        if settings.AUTO_SEED_ADMIN:
            seed_admin(db)
