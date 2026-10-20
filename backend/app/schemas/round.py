"""Esquemas de Rondas y checkpoints."""

from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

from app.models.enums import RoundLogStatus, RoundStatus
from app.schemas.company import CompanySummary
from app.schemas.user import UserSummary


class RoundLogRead(BaseModel):
    """Lectura de un checkpoint NFC."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    round_id: int
    nfc_tag_id: str
    checkpoint_name: str
    timestamp: datetime
    status: RoundLogStatus


class RoundRead(BaseModel):
    """Datos de una ronda para el panel de informes."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    company_id: int
    guard_id: int
    status: RoundStatus
    start_time: datetime | None
    end_time: datetime | None
    observations: str | None
    created_at: datetime
    company: CompanySummary | None = None
    guard: UserSummary | None = None


class RoundDetail(RoundRead):
    """Ronda con el detalle de sus checkpoints."""

    logs: list[RoundLogRead] = Field(default_factory=list)


class RoundCommentCreate(BaseModel):
    """Payload para añadir una nota operativa a una ronda."""

    model_config = ConfigDict(str_strip_whitespace=True)

    comment: str = Field(min_length=2, max_length=1000)


class RoundStatusCount(BaseModel):
    """Conteo de rondas por estado."""

    status: RoundStatus
    count: int


class RoundSummary(BaseModel):
    """Resumen agregado para el panel de informes."""

    total: int
    by_status: list[RoundStatusCount]
