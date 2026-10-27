"""Esquemas de Empresa."""

from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

from app.models.enums import PointType


class CompanyBase(BaseModel):
    """Campos editables de una empresa."""

    model_config = ConfigDict(str_strip_whitespace=True)

    name: str = Field(min_length=2, max_length=150, examples=["Vigilancia Norte S.A."])
    tax_id: str = Field(min_length=3, max_length=30, examples=["B12345678"])
    address: str | None = Field(default=None, max_length=255)
    phone: str | None = Field(default=None, max_length=30)
    point_type: PointType = Field(
        default=PointType.QR,
        description=(
            "Tecnología de sus puntos de control: QR (código impreso) o NFC "
            "(etiqueta física). Define qué campos se solicitan en los puntos."
        ),
        examples=[PointType.QR],
    )


class CompanyCreate(CompanyBase):
    """Payload para crear una empresa."""

    is_active: bool = True


class CompanyUpdate(BaseModel):
    """Payload para actualizar parcialmente una empresa."""

    model_config = ConfigDict(str_strip_whitespace=True)

    name: str | None = Field(default=None, min_length=2, max_length=150)
    tax_id: str | None = Field(default=None, min_length=3, max_length=30)
    address: str | None = Field(default=None, max_length=255)
    phone: str | None = Field(default=None, max_length=30)
    point_type: PointType | None = Field(
        default=None,
        description=(
            "Cambiar el tipo desactiva los puntos del tipo anterior para que "
            "la ronda solo use la tecnología configurada."
        ),
    )
    is_active: bool | None = None


class CompanySummary(BaseModel):
    """Representación reducida usada en respuestas anidadas."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    tax_id: str
    point_type: PointType = PointType.QR
    is_active: bool


class CompanyRead(CompanyBase):
    """Representación completa de una empresa."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    is_active: bool
    created_at: datetime
