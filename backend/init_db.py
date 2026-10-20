"""Inicializa la base de datos y carga los datos de demostración.

Uso (desde ``backend/``)::

    venv\\Scripts\\activate
    python init_db.py

Motor de base de datos (misma resolución que la API, ver ``app.core.config``):

* MySQL si existen variables ``DB_HOST``/``DB_USER``/... (o ``DATABASE_URL``).
* SQLite si ``USE_SQLITE=true`` o si no hay variables de MySQL, usando por
  defecto ``backend/sistema_rondas.db``.

El script es idempotente:

* Crea la base de datos MySQL (si no existe) y todas las tablas a partir de los
  modelos SQLAlchemy (``Base.metadata.create_all``).
* Crea la empresa, los usuarios, las asignaciones, los puntos de control y las
  rondas demo solo si no existen; puede ejecutarse varias veces sin duplicar
  registros.

El seed vive en :mod:`app.db.seed` y también se ejecuta automáticamente al
arrancar la API cuando la base de datos está vacía (útil en Render con SQLite).

Cuentas creadas (solo para desarrollo)::

    admin@demo.com       admin123      ADMIN
    supervisor@demo.com  super123      SUPERVISOR
    guardia1@demo.com    guardia123    GUARD
    guardia2@demo.com    guardia123    GUARD
    cliente@demo.com     cliente123    COMPANY_USER
"""

from __future__ import annotations

import argparse
import logging
from collections.abc import Sequence

from app.core.config import settings
from app.core.database import SessionLocal, create_database_if_not_exists, engine
from app.db.seed import (
    COMPANY_USER_EMAIL,
    DEMO_CHECKPOINTS,
    DEMO_COMPANY,
    DEMO_ROUNDS,
    DEMO_USERS,
    GUARD_EMAILS,
    SUPERVISOR_EMAIL,
    seed_demo_data,
)
from app.models import Base

logger = logging.getLogger("init_db")

__all__ = [
    "COMPANY_USER_EMAIL",
    "DEMO_CHECKPOINTS",
    "DEMO_COMPANY",
    "DEMO_ROUNDS",
    "DEMO_USERS",
    "GUARD_EMAILS",
    "SUPERVISOR_EMAIL",
    "main",
    "seed_demo_data",
]


def _parse_args(argv: Sequence[str] | None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Crea las tablas y carga los datos de demostración del Sistema de Rondas."
        )
    )
    parser.add_argument(
        "--skip-create-db",
        action="store_true",
        help=(
            "No intenta crear la base de datos MySQL (útil si ya existe o el "
            "usuario no tiene permiso CREATE DATABASE). En SQLite no aplica."
        ),
    )
    return parser.parse_args(argv)


def _log_accounts() -> None:
    logger.info("Cuentas demo disponibles:")
    for spec in DEMO_USERS:
        logger.info(
            "  %-22s %-12s %s",
            spec["email"],
            spec["password"],
            spec["role"].value,
        )


def main(argv: Sequence[str] | None = None) -> int:
    """Punto de entrada: crea el esquema y siembra los datos demo."""
    args = _parse_args(argv)
    logging.basicConfig(
        level=logging.INFO,
        format="%(levelname)-8s | %(message)s",
    )

    logger.info("Motor de base de datos: %s", settings.database_backend)
    if settings.IS_SQLITE_FALLBACK:
        logger.warning(
            "No se detectaron variables MySQL; usando SQLite en %s",
            settings.SQLITE_DB_PATH,
        )
    logger.info(
        "Base de datos objetivo: %s",
        engine.url.render_as_string(hide_password=True),
    )

    try:
        if not args.skip_create_db:
            create_database_if_not_exists()
        Base.metadata.create_all(bind=engine)
        logger.info("Tablas verificadas/creadas correctamente.")

        with SessionLocal() as db:
            seed_demo_data(db)
    except Exception:
        logger.exception("No se pudo inicializar la base de datos.")
        return 1
    finally:
        engine.dispose()

    _log_accounts()
    logger.info("Inicialización finalizada.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
