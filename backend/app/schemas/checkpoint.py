"""Esquemas de Puntos de Control."""

from __future__ import annotations

import re
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.schemas.company import CompanySummary

#: Caracteres válidos de un UID NFC (hex) una vez normalizado.
_UID_ALLOWED = re.compile(r"[^0-9A-Z]")


def _normalize_code(value: str | None) -> str | None:
    """Normaliza el código para que QR/NFC no dependan de mayúsculas."""
    return value.strip().upper() if value is not None else None


def normalize_uid(value: str | None) -> str | None:
    """Normaliza el UID NFC a hexadecimal en mayúsculas y sin separadores.

    Android entrega el UID como ``04A23B4C5D6E`` mientras que iOS o una
    etiqueta impresa pueden mostrarlo como ``04:A2:3B:4C:5D:6E``. Se guarda una
    única forma canónica para que la marcación funcione con ambos formatos.
    """
    if value is None:
        return None
    cleaned = _UID_ALLOWED.sub("", value.strip().upper())
    return cleaned or None


class CheckpointBase(BaseModel):
    """Campos editables comunes de un punto de control."""

    model_config = ConfigDict(str_strip_whitespace=True)

    name: str = Field(
        min_length=2,
        max_length=150,
        examples=["Entrada Principal"],
    )
    location_description: str | None = Field(
        default=None,
        max_length=2000,
        description="Detalles de la ubicación física del punto de control.",
    )
    latitude: float | None = Field(
        default=None,
        ge=-90,
        le=90,
        description=(
            "Latitud del punto; necesaria para validar la marcación por QR. "
            "En empresas NFC es opcional."
        ),
    )
    longitude: float | None = Field(
        default=None,
        ge=-180,
        le=180,
        description=(
            "Longitud del punto; necesaria para validar la marcación por QR. "
            "En empresas NFC es opcional."
        ),
    )
    geofence_radius_m: int = Field(
        default=50,
        ge=10,
        le=1000,
        description="Radio en metros dentro del cual se acepta una marcación.",
    )


class CheckpointCreate(CheckpointBase):
    """Payload para crear un punto de control.

    ``code`` es opcional: si se omite, el servidor genera un código único con
    el prefijo del tipo de punto de la empresa (``QR-EMP1-PT04`` o
    ``NFC-EMP2-PT01``). ``uid_nfc`` es obligatorio en empresas NFC.
    """

    company_id: int = Field(gt=0)
    code: str | None = Field(
        default=None,
        min_length=2,
        max_length=100,
        examples=["QR-EMP1-PT01"],
        description="Código único del punto; se genera automáticamente si falta.",
    )
    uid_nfc: str | None = Field(
        default=None,
        max_length=100,
        examples=["04A23B4C5D6E"],
        description="UID de la etiqueta NFC; obligatorio en empresas con tipo NFC.",
    )
    is_active: bool = True

    @field_validator("code")
    @classmethod
    def normalize_code(cls, value: str | None) -> str | None:
        """Guarda siempre el código en mayúsculas y sin espacios exteriores."""
        return _normalize_code(value)

    @field_validator("uid_nfc")
    @classmethod
    def normalize_uid_field(cls, value: str | None) -> str | None:
        """Canoniza el UID para que Android e iOS coincidan."""
        return normalize_uid(value)

    @model_validator(mode="after")
    def validate_coordinates(self) -> "CheckpointCreate":
        """Exige latitud y longitud juntas para que la geovalla sea válida."""
        if (self.latitude is None) != (self.longitude is None):
            raise ValueError("Debe indicar latitud y longitud juntas")
        return self


class CheckpointUpdate(BaseModel):
    """Payload para actualizar parcialmente un punto de control."""

    model_config = ConfigDict(str_strip_whitespace=True)

    company_id: int | None = Field(default=None, gt=0)
    name: str | None = Field(default=None, min_length=2, max_length=150)
    code: str | None = Field(default=None, min_length=2, max_length=100)
    uid_nfc: str | None = Field(default=None, max_length=100)
    location_description: str | None = Field(default=None, max_length=2000)
    latitude: float | None = Field(default=None, ge=-90, le=90)
    longitude: float | None = Field(default=None, ge=-180, le=180)
    geofence_radius_m: int | None = Field(default=None, ge=10, le=1000)
    is_active: bool | None = None

    @field_validator("code")
    @classmethod
    def normalize_code(cls, value: str | None) -> str | None:
        """Normaliza el código cuando se envía en una actualización parcial."""
        return _normalize_code(value)

    @field_validator("uid_nfc")
    @classmethod
    def normalize_uid_field(cls, value: str | None) -> str | None:
        """Normaliza el UID NFC enviado en una actualización parcial."""
        return normalize_uid(value)


class CheckpointRead(CheckpointBase):
    """Representación completa de un punto de control."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    company_id: int
    code: str
    uid_nfc: str | None = None
    is_active: bool
    created_at: datetime
    company: CompanySummary | None = None
