"""Registro central de modelos.

Importar este paquete garantiza que todos los mappers y tablas de asociación
queden registrados en ``Base.metadata`` (requerido por Alembic y por
``create_all``).
"""

from app.models.associations import supervisor_guards, user_companies
from app.models.base import Base
from app.models.checkpoint import Checkpoint
from app.models.company import Company
from app.models.enums import (
    PointType,
    RoundCheckpointStatus,
    RoundLogStatus,
    RoundStatus,
    UserRole,
)
from app.models.round import Round, RoundLog
from app.models.user import User

__all__ = [
    "Base",
    "Checkpoint",
    "Company",
    "PointType",
    "Round",
    "RoundCheckpointStatus",
    "RoundLog",
    "RoundLogStatus",
    "RoundStatus",
    "User",
    "UserRole",
    "supervisor_guards",
    "user_companies",
]
