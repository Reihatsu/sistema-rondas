"""CRUD de Empresas (solo ADMIN puede crear/editar/eliminar)."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query, status
from sqlalchemy.exc import IntegrityError

from app.api.deps import (
    AdminUser,
    CurrentUser,
    DbSession,
    ensure_company_access,
    user_company_ids,
)
from app.crud import company as crud_company
from app.models import UserRole
from app.schemas.common import Message, Paginated
from app.schemas.company import CompanyCreate, CompanyRead, CompanyUpdate

router = APIRouter(prefix="/companies", tags=["Empresas"])


@router.get(
    "",
    response_model=Paginated[CompanyRead],
    summary="Listar empresas",
)
def list_companies(
    db: DbSession,
    current_user: CurrentUser,
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    search: str | None = Query(None, description="Busca por nombre, NIF o dirección"),
    is_active: bool | None = Query(None),
) -> Paginated[CompanyRead]:
    """Admin ve todas las empresas; el resto solo las que tiene asignadas."""
    allowed_ids = None if current_user.role is UserRole.ADMIN else user_company_ids(
        current_user
    )
    items, total = crud_company.list_companies(
        db,
        page=page,
        page_size=page_size,
        search=search,
        is_active=is_active,
        allowed_ids=allowed_ids,
    )
    return Paginated[CompanyRead](
        items=[CompanyRead.model_validate(item) for item in items],
        total=total,
        page=page,
        page_size=page_size,
    )


@router.post(
    "",
    response_model=CompanyRead,
    status_code=status.HTTP_201_CREATED,
    summary="Crear empresa (ADMIN)",
)
def create_company(
    payload: CompanyCreate,
    db: DbSession,
    _: AdminUser,
) -> CompanyRead:
    """Registra una nueva empresa validando nombre y NIF únicos."""
    if crud_company.get_company_by_name(db, payload.name):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Ya existe una empresa con ese nombre",
        )
    if crud_company.get_company_by_tax_id(db, payload.tax_id):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Ya existe una empresa con ese NIF/CIF",
        )

    try:
        company = crud_company.create_company(db, payload)
    except IntegrityError:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Conflicto de unicidad al crear la empresa",
        ) from None

    return CompanyRead.model_validate(company)


@router.get(
    "/{company_id}",
    response_model=CompanyRead,
    summary="Obtener empresa",
)
def get_company(
    company_id: int,
    db: DbSession,
    current_user: CurrentUser,
) -> CompanyRead:
    """Devuelve una empresa si el usuario tiene acceso a ella."""
    company = crud_company.get_company(db, company_id)
    if company is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Empresa no encontrada"
        )
    ensure_company_access(current_user, company.id)
    return CompanyRead.model_validate(company)


@router.put(
    "/{company_id}",
    response_model=CompanyRead,
    summary="Actualizar empresa (ADMIN)",
)
def update_company(
    company_id: int,
    payload: CompanyUpdate,
    db: DbSession,
    _: AdminUser,
) -> CompanyRead:
    """Actualiza parcialmente una empresa existente."""
    company = crud_company.get_company(db, company_id)
    if company is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Empresa no encontrada"
        )

    if payload.name and payload.name != company.name:
        duplicate = crud_company.get_company_by_name(db, payload.name)
        if duplicate is not None and duplicate.id != company.id:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Ya existe una empresa con ese nombre",
            )
    if payload.tax_id and payload.tax_id != company.tax_id:
        duplicate = crud_company.get_company_by_tax_id(db, payload.tax_id)
        if duplicate is not None and duplicate.id != company.id:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Ya existe una empresa con ese NIF/CIF",
            )

    try:
        company = crud_company.update_company(db, company, payload)
    except IntegrityError:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Conflicto de unicidad al actualizar la empresa",
        ) from None

    return CompanyRead.model_validate(company)


@router.delete(
    "/{company_id}",
    response_model=Message,
    summary="Eliminar o desactivar empresa (ADMIN)",
)
def delete_company(
    company_id: int,
    db: DbSession,
    _: AdminUser,
    hard: bool = Query(
        False,
        description="true = borrado físico (falla si hay rondas); false = baja lógica",
    ),
) -> Message:
    """Por defecto aplica baja lógica para conservar el histórico."""
    company = crud_company.get_company(db, company_id)
    if company is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Empresa no encontrada"
        )

    if not hard:
        crud_company.deactivate_company(db, company)
        return Message(detail="Empresa desactivada correctamente")

    try:
        crud_company.delete_company(db, company)
    except IntegrityError:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="No se puede eliminar: la empresa tiene rondas asociadas",
        ) from None
    return Message(detail="Empresa eliminada correctamente")
