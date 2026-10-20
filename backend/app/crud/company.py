"""Operaciones de base de datos para Empresas."""

from __future__ import annotations

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.models import Company
from app.schemas.company import CompanyCreate, CompanyUpdate


def get_company(db: Session, company_id: int) -> Company | None:
    """Devuelve una empresa por ID (incluye inactivas)."""
    return db.get(Company, company_id)


def get_company_by_name(db: Session, name: str) -> Company | None:
    """Busca una empresa por nombre exacto."""
    return db.scalar(select(Company).where(Company.name == name))


def get_company_by_tax_id(db: Session, tax_id: str) -> Company | None:
    """Busca una empresa por identificación fiscal exacta."""
    return db.scalar(select(Company).where(Company.tax_id == tax_id))


def list_companies(
    db: Session,
    *,
    page: int,
    page_size: int,
    search: str | None = None,
    is_active: bool | None = None,
    allowed_ids: list[int] | None = None,
) -> tuple[list[Company], int]:
    """Lista empresas paginadas con filtros.

    Args:
        allowed_ids: Si no es ``None``, restringe el resultado a esos IDs
            (usado para que cada rol vea solo sus empresas).
    """
    filters = []
    if search:
        term = f"%{search}%"
        filters.append(
            or_(
                Company.name.ilike(term),
                Company.tax_id.ilike(term),
                Company.address.ilike(term),
            )
        )
    if is_active is not None:
        filters.append(Company.is_active.is_(is_active))
    if allowed_ids is not None:
        filters.append(Company.id.in_(allowed_ids))

    base = select(Company).where(*filters)
    total = db.scalar(
        select(func.count()).select_from(base.subquery())
    ) or 0
    items = list(
        db.scalars(
            base.order_by(Company.name).offset((page - 1) * page_size).limit(page_size)
        )
    )
    return items, total


def create_company(db: Session, payload: CompanyCreate) -> Company:
    """Crea una empresa y la persiste."""
    company = Company(**payload.model_dump())
    db.add(company)
    db.commit()
    db.refresh(company)
    return company


def update_company(
    db: Session, company: Company, payload: CompanyUpdate
) -> Company:
    """Actualiza únicamente los campos enviados."""
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(company, field, value)
    db.add(company)
    db.commit()
    db.refresh(company)
    return company


def deactivate_company(db: Session, company: Company) -> Company:
    """Baja lógica: mantiene el histórico de rondas intacto."""
    company.is_active = False
    db.add(company)
    db.commit()
    db.refresh(company)
    return company


def delete_company(db: Session, company: Company) -> None:
    """Elimina físicamente la empresa (fallará si tiene rondas asociadas)."""
    db.delete(company)
    db.commit()
