"""Esquemas de Puntos de Control."""

from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.schemas.company import CompanySummary


def _normalize_code(value: str | None) -> str | None:
    """Normaliza el código para que QR/NFC no dependan de mayúsculas."""
    return value.strip().upper() if value is not None else None


class CheckpointBase(BaseModel):
    """Campos editables comunes de un punto de control."""

    model_config = ConfigDict(str_strip_whitespace=True)

    name: str = Field(
        min_length=2,
        max_length=150,
        examples=["Entrada Principal"],
    )
    code: str = Field(
        min_length=2,
        max_length=100,
        examples=["QR-EMP1-PT01"],
        description="Código único del punto; se usa para generar el QR/NFC.",
    )
    location_description: str | None = Field(
        default=None,
        max_length=2000,
        description="Detalles de la ubicación física del punto de control.",
    )

    @field_validator("code")
    @classmethod
    def normalize_code(cls, value: str) -> str:
        """Guarda siempre el código en mayúsculas y sin espacios exteriores."""
        return _normalize_code(value) or value


class CheckpointCreate(CheckpointBase):
    """Payload para crear un punto de control."""

    company_id: int = Field(gt=0)
    is_active: bool = True


class CheckpointUpdate(BaseModel):
    """Payload para actualizar parcialmente un punto de control."""

    model_config = ConfigDict(str_strip_whitespace=True)

    company_id: int | None = Field(default=None, gt=0)
    name: str | None = Field(default=None, min_length=2, max_length=150)
    code: str | None = Field(default=None, min_length=2, max_length=100)
    location_description: str | None = Field(default=None, max_length=2000)
    is_active: bool | None = None

    @field_validator("code")
    @classmethod
    def normalize_code(cls, value: str | None) -> str | None:
        """Normaliza el código cuando se envía en una actualización parcial."""
        return _normalize_code(value)


class CheckpointRead(CheckpointBase):
    """Representación completa de un punto de control."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    company_id: int
    is_active: bool
    created_at: datetime
    company: CompanySummary | None = None
