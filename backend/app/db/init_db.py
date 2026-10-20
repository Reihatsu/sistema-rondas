"""Inicialización de la base de datos y datos mínimos de arranque."""

from __future__ import annotations

import logging

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.database import SessionLocal, create_database_if_not_exists, engine
from app.core.security import hash_password
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


def init_db() -> None:
    """Crea la base de datos (si no existe), las tablas y el admin inicial.

    Se ejecuta al arrancar la API (ver ``lifespan`` en ``app/main.py``) y es
    idempotente. Para entornos con migraciones controladas, desactive
    ``INIT_DB_ON_STARTUP`` y use ``alembic upgrade head``.
    """
    create_database_if_not_exists()
    Base.metadata.create_all(bind=engine)
    logger.info("Esquema de base de datos verificado (create_all).")

    if settings.AUTO_SEED_ADMIN:
        with SessionLocal() as db:
            seed_admin(db)
