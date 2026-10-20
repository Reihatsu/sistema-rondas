"""Utilidades de seguridad: hashing de contraseñas y tokens JWT."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any

from jose import JWTError, jwt
from passlib.context import CryptContext

from app.core.config import settings

# bcrypt limita las contraseñas a 72 bytes.
_BCRYPT_MAX_BYTES = 72
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")


def hash_password(password: str) -> str:
    """Genera el hash bcrypt de una contraseña en texto plano."""
    # Truncar de forma segura en bytes (bcrypt trunca en silencio >72 bytes
    # y algunas versiones lanzan ValueError).
    raw = password.encode("utf-8")[:_BCRYPT_MAX_BYTES].decode("utf-8", "ignore")
    return pwd_context.hash(raw)


def verify_password(plain_password: str, password_hash: str) -> bool:
    """Verifica una contraseña contra su hash bcrypt."""
    raw = plain_password.encode("utf-8")[:_BCRYPT_MAX_BYTES].decode(
        "utf-8", "ignore"
    )
    try:
        return pwd_context.verify(raw, password_hash)
    except ValueError:
        # Hash con formato inválido en base de datos.
        return False


def create_access_token(
    subject: str | int,
    extra_claims: dict[str, Any] | None = None,
    expires_delta: timedelta | None = None,
) -> tuple[str, int]:
    """Crea un JWT de acceso.

    Returns:
        Tupla ``(token, expires_in_segundos)``.
    """
    expire_delta = expires_delta or timedelta(
        minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES
    )
    expire = datetime.now(timezone.utc) + expire_delta
    payload: dict[str, Any] = {
        "sub": str(subject),
        "exp": expire,
        "iat": datetime.now(timezone.utc),
        "type": "access",
    }
    if extra_claims:
        payload.update(extra_claims)

    token = jwt.encode(payload, settings.SECRET_KEY, algorithm=settings.ALGORITHM)
    return token, int(expire_delta.total_seconds())


def decode_access_token(token: str) -> dict[str, Any] | None:
    """Decodifica y valida un JWT. Devuelve ``None`` si es inválido/expirado."""
    try:
        payload = jwt.decode(
            token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM]
        )
    except JWTError:
        return None

    if payload.get("type") != "access" or not payload.get("sub"):
        return None
    return payload
