"""Esquemas de Usuario."""

from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.models.enums import UserRole
from app.schemas.company import CompanySummary

# Validación de email sin dependencias extra (email-validator no está en requirements).
EMAIL_PATTERN = r"^[^@\s]+@[^@\s]+\.[^@\s]+$"


class UserBase(BaseModel):
    """Campos comunes de un usuario."""

    model_config = ConfigDict(str_strip_whitespace=True)

    name: str = Field(min_length=2, max_length=150)
    email: str = Field(max_length=150, pattern=EMAIL_PATTERN)

    @field_validator("email")
    @classmethod
    def normalize_email(cls, value: str) -> str:
        """Normaliza el email a minúsculas para evitar duplicados."""
        return value.lower()


class UserCreate(UserBase):
    """Payload para crear un usuario.

    ``company_ids`` y ``supervisor_ids`` permiten asignar empresas y
    supervisores en la misma operación (opcional).
    """

    password: str = Field(min_length=8, max_length=72, examples=["Guardia123!"])
    role: UserRole = UserRole.GUARD
    is_active: bool = True
    company_ids: list[int] = Field(default_factory=list)
    supervisor_ids: list[int] = Field(
        default_factory=list,
        description="Supervisores a los que reporta el usuario (solo rol GUARD).",
    )


class UserUpdate(BaseModel):
    """Payload para actualizar parcialmente un usuario."""

    model_config = ConfigDict(str_strip_whitespace=True)

    name: str | None = Field(default=None, min_length=2, max_length=150)
    email: str | None = Field(default=None, max_length=150, pattern=EMAIL_PATTERN)
    password: str | None = Field(default=None, min_length=8, max_length=72)
    role: UserRole | None = None
    is_active: bool | None = None
    company_ids: list[int] | None = Field(
        default=None, description="Si se envía, reemplaza las empresas asignadas."
    )
    supervisor_ids: list[int] | None = Field(
        default=None,
        description="Si se envía, reemplaza los supervisores del guardia.",
    )

    @field_validator("email")
    @classmethod
    def normalize_email(cls, value: str | None) -> str | None:
        return value.lower() if value else value


class UserSummary(BaseModel):
    """Representación reducida usada en respuestas anidadas."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    email: str
    role: UserRole
    is_active: bool


class UserRead(UserSummary):
    """Representación de un usuario con sus empresas."""

    created_at: datetime
    companies: list[CompanySummary] = Field(default_factory=list)


class UserDetail(UserRead):
    """Usuario con relaciones de supervisión."""

    supervisors: list[UserSummary] = Field(default_factory=list)
    supervised_guards: list[UserSummary] = Field(default_factory=list)


class UserCompaniesUpdate(BaseModel):
    """Payload para reemplazar las empresas asignadas a un usuario."""

    company_ids: list[int] = Field(default_factory=list)
