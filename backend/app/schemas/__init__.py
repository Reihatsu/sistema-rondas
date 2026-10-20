"""Esquemas Pydantic de la API."""

from app.schemas.auth import LoginRequest, TokenResponse
from app.schemas.checkpoint import (
    CheckpointCreate,
    CheckpointRead,
    CheckpointUpdate,
)
from app.schemas.common import Message, Paginated
from app.schemas.company import (
    CompanyCreate,
    CompanyRead,
    CompanySummary,
    CompanyUpdate,
)
from app.schemas.round import (
    RoundDetail,
    RoundLogRead,
    RoundRead,
    RoundStatusCount,
    RoundSummary,
)
from app.schemas.user import (
    UserCompaniesUpdate,
    UserCreate,
    UserDetail,
    UserRead,
    UserSummary,
    UserUpdate,
)

__all__ = [
    "CheckpointCreate",
    "CheckpointRead",
    "CheckpointUpdate",
    "CompanyCreate",
    "CompanyRead",
    "CompanySummary",
    "CompanyUpdate",
    "LoginRequest",
    "Message",
    "Paginated",
    "RoundDetail",
    "RoundLogRead",
    "RoundRead",
    "RoundStatusCount",
    "RoundSummary",
    "TokenResponse",
    "UserCompaniesUpdate",
    "UserCreate",
    "UserDetail",
    "UserRead",
    "UserSummary",
    "UserUpdate",
]
