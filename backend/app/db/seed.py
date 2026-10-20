"""Datos de demostración (seed) del Sistema de Rondas.

Este módulo centraliza el seed para que pueda ejecutarse de dos formas:

* Manualmente con ``python init_db.py`` (CLI, desde ``backend/``).
* Automáticamente al arrancar la API si la base de datos está vacía
  (ver :func:`app.db.init_db.init_db`), por ejemplo en Render con SQLite.

Todas las funciones son idempotentes: se pueden ejecutar varias veces sin
duplicar registros. Las contraseñas se guardan con bcrypt.

Cuentas creadas (solo para desarrollo/demo)::

    admin@demo.com       admin123      ADMIN
    supervisor@demo.com  super123      SUPERVISOR
    guardia1@demo.com    guardia123    GUARD
    guardia2@demo.com    guardia123    GUARD
    cliente@demo.com     cliente123    COMPANY_USER
"""

from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.security import hash_password
from app.models import (
    Checkpoint,
    Company,
    Round,
    RoundLog,
    RoundLogStatus,
    RoundStatus,
    User,
    UserRole,
)

logger = logging.getLogger(__name__)

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
        "latitude": 40.415462,
        "longitude": -3.709687,
        "geofence_radius_m": 50,
    },
    {
        "name": "Estacionamiento Nivel -1",
        "code": "QR-EMP1-PT02",
        "location_description": (
            "Columna central del nivel -1, frente a la rampa vehicular."
        ),
        "latitude": 40.415100,
        "longitude": -3.710150,
        "geofence_radius_m": 50,
    },
    {
        "name": "Bodega Principal",
        "code": "QR-EMP1-PT03",
        "location_description": (
            "Puerta de acceso a la bodega principal, sector de carga."
        ),
        "latitude": 40.414700,
        "longitude": -3.709500,
        "geofence_radius_m": 50,
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
        "status": RoundStatus.IN_PROGRESS,
        "start_minutes_ago": 10,
        "end_minutes_ago": None,
        "observations": (
            "Ronda nocturna en curso: recorrido de los puntos de control "
            "del perímetro. Permite probar el escaneo QR desde la app móvil."
        ),
        "logs": (),
    },
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
    """Crea los puntos demo que falten y completa sus coordenadas."""
    existing = {
        checkpoint.code: checkpoint
        for checkpoint in db.scalars(
            select(Checkpoint).where(
                Checkpoint.company_id == company.id,
                Checkpoint.code.in_(
                    [str(spec["code"]) for spec in DEMO_CHECKPOINTS]
                ),
            )
        )
    }

    created = 0
    for spec in DEMO_CHECKPOINTS:
        code = str(spec["code"])
        checkpoint = existing.get(code)

        if checkpoint is not None:
            # Bases sembradas antes de la geovalla: se completan las
            # coordenadas sin sobrescribir las que haya configurado el cliente.
            if checkpoint.latitude is None:
                checkpoint.latitude = float(spec["latitude"])
                checkpoint.longitude = float(spec["longitude"])
            continue

        db.add(
            Checkpoint(
                company_id=company.id,
                name=str(spec["name"]),
                code=code,
                location_description=str(spec["location_description"]),
                latitude=float(spec["latitude"]),
                longitude=float(spec["longitude"]),
                geofence_radius_m=int(spec.get("geofence_radius_m", 50)),
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
