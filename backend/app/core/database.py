"""Conexión a la base de datos (MySQL local o SQLite en Render).

Responsabilidades:

* Crear la base de datos MySQL si no existe (``CREATE DATABASE IF NOT EXISTS``);
  en SQLite el archivo se crea automáticamente.
* Exponer el ``engine``, la fábrica de sesiones y la dependencia ``get_db``
  utilizada por las rutas de FastAPI.

La URL se resuelve en ``app.core.config``:

* ``DATABASE_URL`` si está definida (máxima prioridad).
* SQLite si ``USE_SQLITE=true`` o si no hay variables de MySQL.
* MySQL con PyMySQL en caso contrario.
"""

from __future__ import annotations

import logging
import re
from collections.abc import Generator
from pathlib import Path

from sqlalchemy import create_engine, event, text
from sqlalchemy.engine import Engine, make_url
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app.core.config import settings

logger = logging.getLogger(__name__)

# Nombre de base de datos válido: evita inyección al interpolar en el DDL.
_SAFE_IDENTIFIER = re.compile(r"^[A-Za-z0-9_]+$")


def _sqlite_engine(url: str) -> Engine:
    """Crea el engine de SQLite con las opciones que requiere FastAPI.

    ``check_same_thread=False`` permite reutilizar la conexión entre los hilos
    del threadpool de FastAPI. Se usa ``StaticPool`` solo para bases en memoria
    (pruebas), de modo que todas las sesiones compartan la misma base.
    """
    database = make_url(url).database
    if database and database != ":memory:":
        # Garantiza que el directorio del archivo exista (p. ej. volumen en Render).
        Path(database).expanduser().parent.mkdir(parents=True, exist_ok=True)

    engine_kwargs: dict[str, object] = {
        "connect_args": {"check_same_thread": False},
        "echo": settings.DB_ECHO,
        "future": True,
    }
    if not database or database == ":memory:":
        engine_kwargs["poolclass"] = StaticPool

    engine = create_engine(url, **engine_kwargs)

    @event.listens_for(engine, "connect")
    def _enable_sqlite_foreign_keys(  # type: ignore[no-untyped-def]
        dbapi_connection, _record
    ) -> None:
        """Activa las claves foráneas (MySQL las aplica por defecto)."""
        cursor = dbapi_connection.cursor()
        try:
            cursor.execute("PRAGMA foreign_keys=ON")
        finally:
            cursor.close()

    return engine


def _create_engine() -> Engine:
    """Crea el engine de SQLAlchemy con opciones adecuadas por motor."""
    if settings.is_sqlite:
        return _sqlite_engine(settings.DATABASE_URL)

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

if settings.is_sqlite:
    logger.info(
        "Base de datos SQLite en uso (%s%s).",
        engine.url.database,
        " - fallback sin configuración MySQL" if settings.IS_SQLITE_FALLBACK else "",
    )
else:
    logger.info(
        "Base de datos MySQL en uso (%s:%s/%s).",
        settings.DB_HOST,
        settings.DB_PORT,
        settings.DB_NAME,
    )


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
