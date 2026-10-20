"""Esquemas de autenticación."""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field

from app.schemas.user import EMAIL_PATTERN, UserRead


class LoginRequest(BaseModel):
    """Credenciales para obtener un token JWT (login por JSON)."""

    model_config = ConfigDict(str_strip_whitespace=True)

    email: str = Field(max_length=150, pattern=EMAIL_PATTERN)
    password: str = Field(min_length=1, max_length=72)


class TokenResponse(BaseModel):
    """Respuesta del endpoint de login."""

    access_token: str
    token_type: str = "bearer"
    expires_in: int = Field(description="Vigencia del token en segundos")
    user: UserRead
