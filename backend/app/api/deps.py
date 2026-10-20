"""Dependencias compartidas por las rutas (autenticación y permisos)."""

from __future__ import annotations

from collections.abc import Callable
from typing import Annotated

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.security import decode_access_token
from app.crud import user as crud_user
from app.models import User, UserRole

# ``auto_error=False`` permite devolver un 401 homogéneo en español.
bearer_scheme = HTTPBearer(
    auto_error=False,
    description="Token JWT obtenido en POST /api/v1/auth/login",
)

DbSession = Annotated[Session, Depends(get_db)]


def get_current_user(
    db: DbSession,
    credentials: Annotated[
        HTTPAuthorizationCredentials | None, Depends(bearer_scheme)
    ] = None,
) -> User:
    """Resuelve el usuario autenticado a partir del header ``Authorization``."""
    unauthorized = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="No autenticado o token inválido",
        headers={"WWW-Authenticate": "Bearer"},
    )
    if credentials is None or not credentials.credentials:
        raise unauthorized

    payload = decode_access_token(credentials.credentials)
    if payload is None:
        raise unauthorized

    try:
        user_id = int(payload["sub"])
    except (KeyError, TypeError, ValueError):
        raise unauthorized from None

    user = crud_user.get_user_with_detail(db, user_id)
    if user is None:
        raise unauthorized
    if not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="El usuario está desactivado",
        )
    return user


CurrentUser = Annotated[User, Depends(get_current_user)]


def require_roles(*roles: UserRole) -> Callable[[CurrentUser], User]:
    """Genera una dependencia que exige uno de los roles indicados."""

    def role_checker(current_user: CurrentUser) -> User:
        if current_user.role not in roles:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="No tiene permisos para realizar esta acción",
            )
        return current_user

    return role_checker


AdminUser = Annotated[
    User, Depends(require_roles(UserRole.ADMIN))
]
"""Dependencia que exige rol ADMIN."""

SupervisorOrAdminUser = Annotated[
    User, Depends(require_roles(UserRole.ADMIN, UserRole.SUPERVISOR))
]
"""Dependencia que exige rol ADMIN o SUPERVISOR."""


def user_company_ids(user: User) -> list[int]:
    """IDs de las empresas asignadas al usuario."""
    return [company.id for company in user.companies]


def ensure_company_access(user: User, company_id: int) -> None:
    """Lanza 403 si el usuario no es admin ni pertenece a la empresa."""
    if user.role is UserRole.ADMIN:
        return
    if company_id not in user_company_ids(user):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="No tiene acceso a la empresa indicada",
        )
