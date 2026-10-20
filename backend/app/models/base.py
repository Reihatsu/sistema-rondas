"""Clase base declarativa de SQLAlchemy."""

from __future__ import annotations

from sqlalchemy import MetaData
from sqlalchemy.orm import DeclarativeBase

# Convención de nombres estable: evita migraciones "fantasma" cuando Alembic
# autogenera cambios (especialmente en índices y constraints sin nombre).
NAMING_CONVENTION = {
    "ix": "ix_%(table_name)s_%(column_0_name)s",
    "uq": "uq_%(table_name)s_%(column_0_name)s",
    "ck": "ck_%(table_name)s_%(constraint_name)s",
    "fk": "fk_%(table_name)s_%(column_0_name)s_%(referred_table_name)s",
    "pk": "pk_%(table_name)s",
}


class Base(DeclarativeBase):
    """Base declarativa para todos los modelos del proyecto."""

    metadata = MetaData(naming_convention=NAMING_CONVENTION)
