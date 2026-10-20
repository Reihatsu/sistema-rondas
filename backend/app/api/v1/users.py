"""CRUD de Usuarios, asignación de empresas y asociación guardia-supervisor."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.api.deps import AdminUser, CurrentUser, DbSession
from app.crud import user as crud_user
from app.models import Company, User, UserRole
from app.schemas.common import Message, Paginated
from app.schemas.company import CompanySummary
from app.schemas.user import (
    UserCompaniesUpdate,
    UserCreate,
    UserDetail,
    UserRead,
    UserSummary,
    UserUpdate,
)

router = APIRouter(prefix="/users", tags=["Usuarios"])


# ---------------------------------------------------------------------------
# Helpers de validación
# ---------------------------------------------------------------------------
def _resolve_companies(db: Session, company_ids: list[int]) -> list[Company]:
    """Valida que todos los IDs de empresa existan (sin duplicados)."""
    unique_ids = list(dict.fromkeys(company_ids))
    companies = crud_user.get_companies_by_ids(db, unique_ids)
    if len(companies) != len(unique_ids):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Una o más empresas indicadas no existen",
        )
    return companies


def _resolve_supervisors(db: Session, supervisor_ids: list[int]) -> list[User]:
    """Valida que los IDs correspondan a usuarios con rol SUPERVISOR."""
    unique_ids = list(dict.fromkeys(supervisor_ids))
    supervisors = crud_user.get_users_by_ids(db, unique_ids)
    if len(supervisors) != len(unique_ids):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Uno o más supervisores indicados no existen",
        )
    invalid = [
        supervisor.email
        for supervisor in supervisors
        if supervisor.role is not UserRole.SUPERVISOR
    ]
    if invalid:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Los siguientes usuarios no son SUPERVISOR: {', '.join(invalid)}",
        )
    return supervisors


def _get_user_or_404(db: Session, user_id: int) -> User:
    """Recupera un usuario con sus relaciones o lanza 404."""
    user = crud_user.get_user_with_detail(db, user_id)
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Usuario no encontrado"
        )
    return user


def _ensure_user_visible(current_user: User, target: User) -> None:
    """Admin ve todo; un usuario se ve a sí mismo; supervisor ve a sus guardias."""
    if current_user.role is UserRole.ADMIN:
        return
    if current_user.id == target.id:
        return
    if current_user.role is UserRole.SUPERVISOR and any(
        guard.id == target.id for guard in current_user.supervised_guards
    ):
        return
    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail="No tiene acceso a este usuario",
    )


# ---------------------------------------------------------------------------
# CRUD
# ---------------------------------------------------------------------------
@router.get("", response_model=Paginated[UserRead], summary="Listar usuarios")
def list_users(
    db: DbSession,
    current_user: CurrentUser,
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    search: str | None = Query(None, description="Busca por nombre o email"),
    role: UserRole | None = Query(None),
    is_active: bool | None = Query(None),
    company_id: int | None = Query(None),
    supervisor_id: int | None = Query(None),
) -> Paginated[UserRead]:
    """ADMIN lista a todos; SUPERVISOR solo a sí mismo y a sus guardias."""
    if current_user.role is UserRole.ADMIN:
        allowed_ids = None
    elif current_user.role is UserRole.SUPERVISOR:
        allowed_ids = [current_user.id] + [
            guard.id for guard in current_user.supervised_guards
        ]
    else:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="No tiene permisos para listar usuarios",
        )

    items, total = crud_user.list_users(
        db,
        page=page,
        page_size=page_size,
        search=search,
        role=role,
        is_active=is_active,
        company_id=company_id,
        supervisor_id=supervisor_id,
        allowed_ids=allowed_ids,
    )
    return Paginated[UserRead](
        items=[UserRead.model_validate(item) for item in items],
        total=total,
        page=page,
        page_size=page_size,
    )


@router.post(
    "",
    response_model=UserDetail,
    status_code=status.HTTP_201_CREATED,
    summary="Crear usuario (ADMIN)",
)
def create_user(
    payload: UserCreate,
    db: DbSession,
    _: AdminUser,
) -> UserDetail:
    """Crea un usuario y, opcionalmente, asigna empresas y supervisores."""
    if crud_user.get_user_by_email(db, payload.email):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Ya existe un usuario con ese email",
        )
    if payload.supervisor_ids and payload.role is not UserRole.GUARD:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Solo los usuarios con rol GUARD pueden tener supervisores",
        )

    companies = _resolve_companies(db, payload.company_ids)
    supervisors = _resolve_supervisors(db, payload.supervisor_ids)

    try:
        user = crud_user.create_user(db, payload)
        if companies:
            crud_user.replace_companies(db, user, companies)
        if supervisors:
            crud_user.replace_supervisors(db, user, supervisors)
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Conflicto al crear el usuario (email duplicado)",
        ) from None

    return UserDetail.model_validate(_get_user_or_404(db, user.id))


@router.get("/{user_id}", response_model=UserDetail, summary="Obtener usuario")
def get_user(
    user_id: int,
    db: DbSession,
    current_user: CurrentUser,
) -> UserDetail:
    """Devuelve un usuario si el solicitante tiene visibilidad sobre él."""
    user = _get_user_or_404(db, user_id)
    _ensure_user_visible(current_user, user)
    return UserDetail.model_validate(user)


@router.put(
    "/{user_id}",
    response_model=UserDetail,
    summary="Actualizar usuario (ADMIN)",
)
def update_user(
    user_id: int,
    payload: UserUpdate,
    db: DbSession,
    current_user: AdminUser,
) -> UserDetail:
    """Actualiza datos, rol, empresas y supervisores del usuario."""
    user = _get_user_or_404(db, user_id)

    if payload.email and payload.email != user.email:
        if crud_user.get_user_by_email(db, payload.email):
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Ya existe un usuario con ese email",
            )

    final_role = payload.role or user.role
    if payload.supervisor_ids is not None and final_role is not UserRole.GUARD:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Solo los usuarios con rol GUARD pueden tener supervisores",
        )

    # Un admin no puede quitarse a sí mismo el acceso.
    if current_user.id == user.id:
        if payload.is_active is False:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="No puede desactivar su propio usuario",
            )
        if payload.role is not None and payload.role is not UserRole.ADMIN:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="No puede cambiar su propio rol de ADMIN",
            )

    companies = (
        _resolve_companies(db, payload.company_ids)
        if payload.company_ids is not None
        else None
    )
    supervisors = (
        _resolve_supervisors(db, payload.supervisor_ids)
        if payload.supervisor_ids is not None
        else None
    )

    try:
        crud_user.update_user(db, user, payload)
        if companies is not None:
            crud_user.replace_companies(db, user, companies)
        if supervisors is not None:
            crud_user.replace_supervisors(db, user, supervisors)
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Conflicto al actualizar el usuario",
        ) from None

    return UserDetail.model_validate(_get_user_or_404(db, user.id))


@router.delete(
    "/{user_id}",
    response_model=Message,
    summary="Eliminar o desactivar usuario (ADMIN)",
)
def delete_user(
    user_id: int,
    db: DbSession,
    current_user: AdminUser,
    hard: bool = Query(
        False,
        description="true = borrado físico (falla si tiene rondas); false = baja lógica",
    ),
) -> Message:
    """Por defecto desactiva el usuario para no perder trazabilidad."""
    user = _get_user_or_404(db, user_id)
    if user.id == current_user.id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No puede eliminar su propio usuario",
        )

    if not hard:
        crud_user.deactivate_user(db, user)
        return Message(detail="Usuario desactivado correctamente")

    try:
        crud_user.delete_user(db, user)
    except IntegrityError:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="No se puede eliminar: el usuario tiene rondas asociadas",
        ) from None
    return Message(detail="Usuario eliminado correctamente")


# ---------------------------------------------------------------------------
# Empresas asignadas
# ---------------------------------------------------------------------------
@router.get(
    "/{user_id}/companies",
    response_model=list[CompanySummary],
    summary="Empresas asignadas a un usuario",
)
def list_user_companies(
    user_id: int,
    db: DbSession,
    current_user: CurrentUser,
) -> list[CompanySummary]:
    """Devuelve las empresas del usuario (con control de visibilidad)."""
    user = _get_user_or_404(db, user_id)
    _ensure_user_visible(current_user, user)
    return [CompanySummary.model_validate(company) for company in user.companies]


@router.put(
    "/{user_id}/companies",
    response_model=UserDetail,
    summary="Reemplazar empresas de un usuario (ADMIN)",
)
def replace_user_companies(
    user_id: int,
    payload: UserCompaniesUpdate,
    db: DbSession,
    _: AdminUser,
) -> UserDetail:
    """Asigna exactamente las empresas indicadas (lista vacía = ninguna)."""
    user = _get_user_or_404(db, user_id)
    companies = _resolve_companies(db, payload.company_ids)
    crud_user.replace_companies(db, user, companies)
    db.commit()
    return UserDetail.model_validate(_get_user_or_404(db, user.id))


@router.post(
    "/{user_id}/companies/{company_id}",
    response_model=UserDetail,
    summary="Asignar una empresa a un usuario (ADMIN)",
)
def add_user_company(
    user_id: int,
    company_id: int,
    db: DbSession,
    _: AdminUser,
) -> UserDetail:
    """Añade una empresa a la lista del usuario (idempotente)."""
    user = _get_user_or_404(db, user_id)
    company = _resolve_companies(db, [company_id])[0]
    crud_user.add_company(db, user, company)
    db.commit()
    return UserDetail.model_validate(_get_user_or_404(db, user.id))


@router.delete(
    "/{user_id}/companies/{company_id}",
    response_model=UserDetail,
    summary="Quitar una empresa a un usuario (ADMIN)",
)
def remove_user_company(
    user_id: int,
    company_id: int,
    db: DbSession,
    _: AdminUser,
) -> UserDetail:
    """Quita la empresa indicada del usuario (idempotente)."""
    user = _get_user_or_404(db, user_id)
    company = _resolve_companies(db, [company_id])[0]
    crud_user.remove_company(db, user, company)
    db.commit()
    return UserDetail.model_validate(_get_user_or_404(db, user.id))


# ---------------------------------------------------------------------------
# Asociación Supervisor -> Guardias
# ---------------------------------------------------------------------------
@router.get(
    "/{supervisor_id}/guards",
    response_model=list[UserSummary],
    summary="Guardias a cargo de un supervisor",
)
def list_supervisor_guards(
    supervisor_id: int,
    db: DbSession,
    current_user: CurrentUser,
) -> list[UserSummary]:
    """Visible para ADMIN y para el propio supervisor."""
    supervisor = _get_user_or_404(db, supervisor_id)
    if current_user.role is not UserRole.ADMIN and current_user.id != supervisor.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="No tiene acceso a los guardias de este supervisor",
        )
    return [
        UserSummary.model_validate(guard) for guard in supervisor.supervised_guards
    ]


@router.post(
    "/{supervisor_id}/guards/{guard_id}",
    response_model=Message,
    summary="Asociar guardia a supervisor (ADMIN)",
)
def assign_guard(
    supervisor_id: int,
    guard_id: int,
    db: DbSession,
    _: AdminUser,
) -> Message:
    """Crea la relación supervisor -> guardia si ambos roles son correctos."""
    supervisor = _get_user_or_404(db, supervisor_id)
    guard = _get_user_or_404(db, guard_id)

    if supervisor.role is not UserRole.SUPERVISOR:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="El usuario indicado como supervisor no tiene rol SUPERVISOR",
        )
    if guard.role is not UserRole.GUARD:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="El usuario indicado como guardia no tiene rol GUARD",
        )
    if supervisor.id == guard.id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Un usuario no puede supervisarse a sí mismo",
        )

    crud_user.assign_guard(db, supervisor, guard)
    db.commit()
    return Message(detail="Guardia asociado al supervisor correctamente")


@router.delete(
    "/{supervisor_id}/guards/{guard_id}",
    response_model=Message,
    summary="Desasociar guardia de supervisor (ADMIN)",
)
def unassign_guard(
    supervisor_id: int,
    guard_id: int,
    db: DbSession,
    _: AdminUser,
) -> Message:
    """Elimina la relación supervisor -> guardia."""
    supervisor = _get_user_or_404(db, supervisor_id)
    guard = _get_user_or_404(db, guard_id)
    crud_user.unassign_guard(db, supervisor, guard)
    db.commit()
    return Message(detail="Guardia desasociado del supervisor correctamente")
