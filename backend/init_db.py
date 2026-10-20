"""Inicializa la base de datos y carga datos de demostración.

Uso (desde ``backend/``)::

    venv\\Scripts\\activate
    python init_db.py

El script es idempotente:

* Crea la base de datos MySQL (si no existe) y todas las tablas a partir de los
  modelos SQLAlchemy (``Base.metadata.create_all``).
* Crea la empresa, los usuarios, las asignaciones, los puntos de control y las
  rondas demo solo si no existen; puede ejecutarse varias veces sin duplicar
  registros.

Las contraseñas se guardan con hashing bcrypt mediante
``app.core.security.hash_password``.

Cuentas creadas (solo para desarrollo)::

    admin@demo.com       admin123      ADMIN
    supervisor@demo.com  super123      SUPERVISOR
    guardia1@demo.com    guardia123    GUARD
    guardia2@demo.com    guardia123    GUARD
    cliente@demo.com     cliente123    COMPANY_USER

Para usar otra base de datos (por ejemplo SQLite en pruebas), defina
``DATABASE_URL`` antes de ejecutar el script.
"""

from __future__ import annotations

import argparse
import logging
from collections.abc import Sequence
from datetime import datetime, timedelta, timezone
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.database import SessionLocal, create_database_if_not_exists, engine
from app.core.security import hash_password
from app.models import (
    Base,
    Checkpoint,
    Company,
    Round,
    RoundLog,
    RoundLogStatus,
    RoundStatus,
    User,
    UserRole,
)

logger = logging.getLogger("init_db")

#: Empresa única de demostración.
DEMO_COMPANY: dict[str, Any] = {
    "name": "Empresa Demo S.A.",
    "tax_id": "B12345678",
    "address": "Calle Mayor 10, 28013 Madrid",
    "phone": "+34 910 000 000",
    "is_active": True,
}

#: Puntos de control demo de la empresa. El código es global y único.
DEMO_CHECKPOINTS: tuple[dict[str, Any], ...] = (
    {
        "name": "Recepción",
        "code": "QR-EMP1-PT01",
        "location_description": (
            "Mostrador de recepción, junto al acceso peatonal principal."
        ),
    },
    {
        "name": "Estacionamiento Nivel -1",
        "code": "QR-EMP1-PT02",
        "location_description": (
            "Columna central del nivel -1, frente a la rampa vehicular."
        ),
    },
    {
        "name": "Bodega Principal",
        "code": "QR-EMP1-PT03",
        "location_description": (
            "Puerta de acceso a la bodega principal, sector de carga."
        ),
    },
)

#: Usuarios de demostración (contraseñas en texto plano solo para el seed).
DEMO_USERS: tuple[dict[str, Any], ...] = (
    {
        "name": "Administrador Demo",
        "email": "admin@demo.com",
        "password": "admin123",
        "role": UserRole.ADMIN,
    },
    {
        "name": "Supervisora Demo",
        "email": "supervisor@demo.com",
        "password": "super123",
        "role": UserRole.SUPERVISOR,
    },
    {
        "name": "Guardia Uno",
        "email": "guardia1@demo.com",
        "password": "guardia123",
        "role": UserRole.GUARD,
    },
    {
        "name": "Guardia Dos",
        "email": "guardia2@demo.com",
        "password": "guardia123",
        "role": UserRole.GUARD,
    },
    {
        "name": "Cliente Demo",
        "email": "cliente@demo.com",
        "password": "cliente123",
        "role": UserRole.COMPANY_USER,
    },
)

SUPERVISOR_EMAIL = "supervisor@demo.com"
GUARD_EMAILS = ("guardia1@demo.com", "guardia2@demo.com")
COMPANY_USER_EMAIL = "cliente@demo.com"

#: Rondas de demostración con sus checkpoints NFC.
#: ``start_minutes_ago``/``end_minutes_ago`` son relativos al momento del seed.
DEMO_ROUNDS: tuple[dict[str, Any], ...] = (
    {
        "guard": "guardia1@demo.com",
        "status": RoundStatus.COMPLETED,
        "start_minutes_ago": 180,
        "end_minutes_ago": 120,
        "observations": (
            "Ronda completada sin incidencias; todos los checkpoints fueron leídos."
        ),
        "logs": (
            ("NFC-0001", "Entrada principal", 175, RoundLogStatus.OK),
            ("NFC-0002", "Recepción", 155, RoundLogStatus.OK),
            ("NFC-0003", "Almacén", 135, RoundLogStatus.OK),
        ),
    },
    {
        "guard": "guardia2@demo.com",
        "status": RoundStatus.PAUSED,
        "start_minutes_ago": 60,
        "end_minutes_ago": None,
        "observations": (
            "Ronda pausada por una alerta en el sector B; pendiente de reanudar."
        ),
        "logs": (
            ("NFC-0001", "Entrada principal", 55, RoundLogStatus.OK),
            ("NFC-0010", "Patio trasero", 40, RoundLogStatus.INCIDENT),
        ),
    },
    {
        "guard": "guardia1@demo.com",
        "status": RoundStatus.CANCELLED,
        "start_minutes_ago": None,
        "end_minutes_ago": None,
        "observations": (
            "Ronda cancelada por el cliente debido a un mantenimiento programado."
        ),
        "logs": (),
    },
)


def _minutes_ago(now: datetime, minutes: int | None) -> datetime | None:
    """Convierte un desplazamiento en minutos a una fecha absoluta UTC."""
    if minutes is None:
        return None
    return now - timedelta(minutes=minutes)


def _seed_company(db: Session) -> tuple[Company, bool]:
    """Devuelve la empresa demo, creándola si todavía no existe."""
    company = db.scalar(
        select(Company).where(Company.tax_id == DEMO_COMPANY["tax_id"])
    )
    if company is not None:
        return company, False

    company = Company(**DEMO_COMPANY)
    db.add(company)
    db.flush()  # asigna el ID sin cerrar la transacción
    return company, True


def _seed_users(db: Session) -> tuple[dict[str, User], int]:
    """Crea los usuarios demo que falten y los devuelve indexados por email."""
    users: dict[str, User] = {}
    created = 0

    for spec in DEMO_USERS:
        email = str(spec["email"]).lower()
        user = db.scalar(select(User).where(User.email == email))
        if user is None:
            user = User(
                name=str(spec["name"]),
                email=email,
                password_hash=hash_password(str(spec["password"])),
                role=spec["role"],
                is_active=True,
            )
            db.add(user)
            db.flush()
            created += 1
        users[email] = user

    return users, created


def _seed_assignments(company: Company, users: dict[str, User]) -> None:
    """Asigna la empresa demo a los usuarios y los guardias a la supervisora."""
    for email in (SUPERVISOR_EMAIL, *GUARD_EMAILS, COMPANY_USER_EMAIL):
        user = users[email]
        if company not in user.companies:
            user.companies.append(company)

    supervisor = users[SUPERVISOR_EMAIL]
    for email in GUARD_EMAILS:
        guard = users[email]
        if guard not in supervisor.supervised_guards:
            supervisor.supervised_guards.append(guard)


def _seed_checkpoints(db: Session, company: Company) -> int:
    """Crea los puntos de control demo que aún no existan por código."""
    existing_codes = set(
        db.scalars(
            select(Checkpoint.code).where(
                Checkpoint.company_id == company.id,
                Checkpoint.code.in_(
                    [str(spec["code"]) for spec in DEMO_CHECKPOINTS]
                ),
            )
        )
    )
    created = 0
    for spec in DEMO_CHECKPOINTS:
        code = str(spec["code"])
        if code in existing_codes:
            continue
        db.add(
            Checkpoint(
                company_id=company.id,
                name=str(spec["name"]),
                code=code,
                location_description=str(spec["location_description"]),
                is_active=True,
            )
        )
        created += 1
    return created


def _seed_rounds(
    db: Session,
    company: Company,
    users: dict[str, User],
    now: datetime,
) -> tuple[int, int]:
    """Crea las rondas demo con sus checkpoints; omite las ya existentes."""
    rounds_created = 0
    logs_created = 0

    for spec in DEMO_ROUNDS:
        # Clave natural del seed: empresa + estado + observaciones.
        exists = db.scalar(
            select(Round).where(
                Round.company_id == company.id,
                Round.status == spec["status"],
                Round.observations == spec["observations"],
            )
        )
        if exists is not None:
            continue

        guard = users[str(spec["guard"])]
        round_obj = Round(
            company_id=company.id,
            guard_id=guard.id,
            status=spec["status"],
            start_time=_minutes_ago(now, spec["start_minutes_ago"]),
            end_time=_minutes_ago(now, spec["end_minutes_ago"]),
            observations=str(spec["observations"]),
        )
        db.add(round_obj)
        db.flush()  # necesitamos round_obj.id para los logs

        for tag, checkpoint, minutes, status in spec["logs"]:
            db.add(
                RoundLog(
                    round_id=round_obj.id,
                    nfc_tag_id=tag,
                    checkpoint_name=checkpoint,
                    timestamp=_minutes_ago(now, minutes),
                    status=status,
                )
            )
            logs_created += 1

        rounds_created += 1

    return rounds_created, logs_created


def seed_demo_data(db: Session) -> dict[str, int]:
    """Siembra empresa, usuarios, asignaciones, puntos y rondas demo.

    Returns:
        Contadores de registros creados: ``companies``, ``users``,
        ``checkpoints``, ``rounds`` y ``logs``. En una segunda ejecución todos
        valen ``0``.
    """
    now = datetime.now(timezone.utc)

    company, company_created = _seed_company(db)
    users, users_created = _seed_users(db)
    _seed_assignments(company, users)
    checkpoints_created = _seed_checkpoints(db, company)
    rounds_created, logs_created = _seed_rounds(db, company, users, now)
    db.commit()

    stats = {
        "companies": int(company_created),
        "users": users_created,
        "checkpoints": checkpoints_created,
        "rounds": rounds_created,
        "logs": logs_created,
    }
    logger.info(
        "Seed completado -> empresa: %s | usuarios nuevos: %d | "
        "puntos de control nuevos: %d | rondas nuevas: %d | logs nuevos: %d",
        "creada" if company_created else "ya existía",
        users_created,
        checkpoints_created,
        rounds_created,
        logs_created,
    )
    return stats


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
            "usuario no tiene permiso CREATE DATABASE)."
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
