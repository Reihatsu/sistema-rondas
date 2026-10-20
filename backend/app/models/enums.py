"""Enumeraciones compartidas por modelos y esquemas."""

from __future__ import annotations

import enum

from sqlalchemy import Enum as SAEnum


class UserRole(str, enum.Enum):
    """Roles disponibles en el sistema."""

    ADMIN = "ADMIN"
    SUPERVISOR = "SUPERVISOR"
    COMPANY_USER = "COMPANY_USER"
    GUARD = "GUARD"


class RoundStatus(str, enum.Enum):
    """Ciclo de vida de una ronda."""

    PENDING = "PENDING"
    IN_PROGRESS = "IN_PROGRESS"
    COMPLETED = "COMPLETED"
    CANCELLED = "CANCELLED"
    PAUSED = "PAUSED"


class RoundLogStatus(str, enum.Enum):
    """Resultado de la lectura de un checkpoint NFC."""

    OK = "OK"
    INCIDENT = "INCIDENT"
    SKIPPED = "SKIPPED"


class RoundCheckpointStatus(str, enum.Enum):
    """Estado operativo de un checkpoint dentro de una ronda.

    No se persiste: se calcula a partir de la existencia de una marcación para
    el punto en la ronda.
    """

    PENDING = "PENDING"
    COMPLETED = "COMPLETED"


def sa_enum(enum_class: type[enum.Enum], name: str) -> SAEnum:
    """Crea una columna ``Enum`` que persiste los *valores* del Enum.

    Por defecto SQLAlchemy persistiría los nombres de los miembros. Aquí ambos
    coinciden, pero se deja explícito para evitar sorpresas si cambian.
    """
    return SAEnum(
        enum_class,
        name=name,
        values_callable=lambda members: [member.value for member in members],
        native_enum=True,
        validate_strings=True,
    )


user_role_type = sa_enum(UserRole, "user_role")
round_status_type = sa_enum(RoundStatus, "round_status")
round_log_status_type = sa_enum(RoundLogStatus, "round_log_status")
