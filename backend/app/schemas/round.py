"""Esquemas de Rondas y checkpoints."""

from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.models.enums import RoundLogStatus, RoundStatus
from app.schemas.company import CompanySummary
from app.schemas.user import UserSummary


class RoundLogRead(BaseModel):
    """Lectura de un checkpoint NFC/QR."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    round_id: int
    checkpoint_id: int | None = None
    nfc_tag_id: str
    checkpoint_name: str
    latitude: float | None = None
    longitude: float | None = None
    distance_m: float | None = None
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


class RoundCheckpointRead(BaseModel):
    """Punto de control de la ronda con su estado de visita."""

    id: int
    name: str
    code: str
    location_description: str | None = None
    latitude: float | None = None
    longitude: float | None = None
    geofence_radius_m: int = 50
    is_visited: bool = False
    visited_at: datetime | None = None


class RoundCheckInCreate(BaseModel):
    """Payload de la marcación de un checkpoint mediante QR."""

    model_config = ConfigDict(str_strip_whitespace=True)

    qr_code: str = Field(
        min_length=2,
        max_length=100,
        examples=["QR-EMP1-PT01"],
        description="Contenido leído del código QR (código único del punto).",
    )
    latitude: float = Field(
        ge=-90, le=90, description="Latitud capturada por el dispositivo."
    )
    longitude: float = Field(
        ge=-180, le=180, description="Longitud capturada por el dispositivo."
    )

    @field_validator("qr_code")
    @classmethod
    def normalize_qr_code(cls, value: str) -> str:
        """Normaliza el código para que el escaneo no dependa de mayúsculas."""
        return value.strip().upper()


class RoundCheckInRead(BaseModel):
    """Resultado de una marcación validada por el servidor."""

    message: str
    distance_m: float
    checkpoint: RoundCheckpointRead
    log: RoundLogRead


class RoundStatusCount(BaseModel):
    """Conteo de rondas por estado."""

    status: RoundStatus
    count: int


class RoundSummary(BaseModel):
    """Resumen agregado para el panel de informes."""

    total: int
    by_status: list[RoundStatusCount]
