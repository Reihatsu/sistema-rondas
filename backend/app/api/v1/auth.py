"""Autenticación: login con JWT y perfil del usuario autenticado."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException, status

from app.api.deps import CurrentUser, DbSession
from app.core.security import create_access_token, verify_password
from app.crud import user as crud_user
from app.schemas.auth import LoginRequest, TokenResponse
from app.schemas.user import UserDetail, UserRead

router = APIRouter(prefix="/auth", tags=["Autenticación"])


@router.post(
    "/login",
    response_model=TokenResponse,
    summary="Iniciar sesión",
    responses={401: {"description": "Credenciales inválidas"}},
)
def login(payload: LoginRequest, db: DbSession) -> TokenResponse:
    """Valida email/contraseña y devuelve un token JWT de acceso."""
    user = crud_user.get_user_by_email(db, payload.email)

    # Mensaje genérico: no revelar si el email existe.
    if user is None or not verify_password(payload.password, user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Credenciales inválidas",
            headers={"WWW-Authenticate": "Bearer"},
        )

    if not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="El usuario está desactivado",
        )

    token, expires_in = create_access_token(
        subject=user.id,
        extra_claims={"role": user.role.value, "email": user.email},
    )
    user_with_detail = crud_user.get_user_with_detail(db, user.id)
    return TokenResponse(
        access_token=token,
        expires_in=expires_in,
        user=UserRead.model_validate(user_with_detail),
    )


@router.get(
    "/me",
    response_model=UserDetail,
    summary="Perfil del usuario autenticado",
)
def read_current_user(current_user: CurrentUser) -> UserDetail:
    """Devuelve los datos del usuario dueño del token."""
    return UserDetail.model_validate(current_user)
