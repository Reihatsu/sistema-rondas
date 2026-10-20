"""Conexión a la base de datos MySQL.

Responsabilidades:

* Crear la base de datos si no existe (``CREATE DATABASE IF NOT EXISTS``).
* Exponer el ``engine``, la fábrica de sesiones y la dependencia ``get_db``
  utilizada por las rutas de FastAPI.

La URL puede sobrescribirse con la variable de entorno ``DATABASE_URL``
(útil para pruebas con SQLite o para despliegues gestionados).
"""

from __future__ import annotations

import logging
import re
from collections.abc import Generator

from sqlalchemy import create_engine, text
from sqlalchemy.engine import Engine
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session, sessionmaker

from app.core.config import settings

logger = logging.getLogger(__name__)

# Nombre de base de datos válido: evita inyección al interpolar en el DDL.
_SAFE_IDENTIFIER = re.compile(r"^[A-Za-z0-9_]+$")


def _create_engine() -> Engine:
    """Crea el engine de SQLAlchemy con opciones adecuadas por motor."""
    connect_args: dict[str, object] = {}
    if settings.DATABASE_URL.startswith("sqlite"):
        # SQLite en memoria/archivo requiere esto para usarse con FastAPI.
        connect_args["check_same_thread"] = False
        return create_engine(settings.DATABASE_URL, connect_args=connect_args)

    return create_engine(
        settings.DATABASE_URL,
        pool_pre_ping=True,   # descarta conexiones muertas tras inactividad
        pool_recycle=3600,    # evita "MySQL server has gone away"
        pool_size=10,
        max_overflow=20,
        echo=settings.DB_ECHO,
        future=True,
    )


engine: Engine = _create_engine()

#: Fábrica de sesiones. ``expire_on_commit=False`` permite devolver objetos
#: recién creados sin provocar un SELECT extra al serializar la respuesta.
SessionLocal = sessionmaker(
    bind=engine,
    autocommit=False,
    autoflush=False,
    expire_on_commit=False,
)


def create_database_if_not_exists() -> bool:
    """Crea la base de datos configurada si aún no existe.

    Solo aplica a MySQL. Devuelve ``True`` si la base de datos existía o fue
    creada correctamente y ``False`` si no se pudo verificar (por ejemplo,
    servidor apagado). En ese último caso se registra un warning para no
    impedir que la API arranque y pueda reportar el error real en cada query.
    """
    if not settings.is_mysql:
        return False

    if not _SAFE_IDENTIFIER.match(settings.DB_NAME):
        raise ValueError(
            f"DB_NAME contiene caracteres no permitidos: {settings.DB_NAME!r}"
        )

    server_engine = create_engine(
        settings.server_url,
        pool_pre_ping=True,
        isolation_level="AUTOCOMMIT",  # CREATE DATABASE no puede ir en transacción
        future=True,
    )
    try:
        with server_engine.connect() as connection:
            connection.execute(
                text(
                    f"CREATE DATABASE IF NOT EXISTS `{settings.DB_NAME}` "
                    "CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci"
                )
            )
        logger.info("Base de datos '%s' verificada/creada.", settings.DB_NAME)
        return True
    except SQLAlchemyError as exc:
        logger.warning(
            "No se pudo crear/verificar la base de datos '%s': %s",
            settings.DB_NAME,
            exc,
        )
        return False
    finally:
        server_engine.dispose()


def get_db() -> Generator[Session, None, None]:
    """Dependencia de FastAPI que entrega una sesión por petición."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def check_connection() -> bool:
    """Comprueba que la base de datos responde (usado por ``/health``)."""
    try:
        with engine.connect() as connection:
            connection.execute(text("SELECT 1"))
        return True
    except SQLAlchemyError:
        logger.exception("Error de conectividad con la base de datos.")
        return False
