"""Operaciones de base de datos para Usuarios y sus asignaciones."""

from __future__ import annotations

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session, selectinload

from app.core.security import hash_password
from app.models import Company, User, UserRole
from app.schemas.user import UserCreate, UserUpdate

#: Carga anticipada de las relaciones que se serializan en ``UserRead``.
USER_READ_OPTIONS = (selectinload(User.companies),)
USER_DETAIL_OPTIONS = (
    selectinload(User.companies),
    selectinload(User.supervisors),
    selectinload(User.supervised_guards),
)


def get_user(db: Session, user_id: int) -> User | None:
    """Devuelve un usuario por ID sin cargar relaciones."""
    return db.get(User, user_id)


def get_user_with_detail(db: Session, user_id: int) -> User | None:
    """Devuelve un usuario con empresas y relaciones de supervisión."""
    return db.scalar(
        select(User).options(*USER_DETAIL_OPTIONS).where(User.id == user_id)
    )


def get_user_by_email(db: Session, email: str) -> User | None:
    """Busca un usuario por email (normalizado a minúsculas)."""
    return db.scalar(select(User).where(User.email == email.lower()))


def get_users_by_ids(db: Session, user_ids: list[int]) -> list[User]:
    """Recupera los usuarios existentes para una lista de IDs."""
    if not user_ids:
        return []
    return list(db.scalars(select(User).where(User.id.in_(user_ids))))


def get_companies_by_ids(db: Session, company_ids: list[int]) -> list[Company]:
    """Recupera las empresas existentes para una lista de IDs."""
    if not company_ids:
        return []
    return list(db.scalars(select(Company).where(Company.id.in_(company_ids))))


def list_users(
    db: Session,
    *,
    page: int,
    page_size: int,
    search: str | None = None,
    role: UserRole | None = None,
    is_active: bool | None = None,
    company_id: int | None = None,
    supervisor_id: int | None = None,
    allowed_ids: list[int] | None = None,
) -> tuple[list[User], int]:
    """Lista usuarios paginados con filtros y carga de empresas."""
    filters = []
    if search:
        term = f"%{search}%"
        filters.append(or_(User.name.ilike(term), User.email.ilike(term)))
    if role is not None:
        filters.append(User.role == role)
    if is_active is not None:
        filters.append(User.is_active.is_(is_active))
    if company_id is not None:
        filters.append(User.companies.any(Company.id == company_id))
    if supervisor_id is not None:
        filters.append(
            User.supervisors.any(User.id == supervisor_id)
        )
    if allowed_ids is not None:
        filters.append(User.id.in_(allowed_ids))

    base = select(User).where(*filters)
    total = db.scalar(select(func.count()).select_from(base.subquery())) or 0
    items = list(
        db.scalars(
            base.options(*USER_READ_OPTIONS)
            .order_by(User.name)
            .offset((page - 1) * page_size)
            .limit(page_size)
        )
    )
    return items, total


def create_user(db: Session, payload: UserCreate) -> User:
    """Crea un usuario aplicando hash a la contraseña.

    Las empresas y supervisores se asignan fuera de esta función (en la capa
    de rutas) para poder validar los IDs y roles antes de persistir.
    """
    user = User(
        name=payload.name,
        email=payload.email,
        password_hash=hash_password(payload.password),
        role=payload.role,
        is_active=payload.is_active,
    )
    db.add(user)
    db.flush()  # obtener el ID sin cerrar la transacción
    return user


def update_user(db: Session, user: User, payload: UserUpdate) -> User:
    """Actualiza los datos escalares del usuario."""
    data = payload.model_dump(
        exclude_unset=True,
        exclude={"company_ids", "supervisor_ids", "password"},
    )
    for field, value in data.items():
        setattr(user, field, value)

    if payload.password:
        user.password_hash = hash_password(payload.password)

    db.add(user)
    db.flush()
    return user


def replace_companies(db: Session, user: User, companies: list[Company]) -> None:
    """Reemplaza la asignación de empresas del usuario."""
    user.companies = companies
    db.add(user)
    db.flush()


def add_company(db: Session, user: User, company: Company) -> None:
    """Asigna una empresa al usuario si aún no la tiene."""
    if company not in user.companies:
        user.companies.append(company)
        db.add(user)
        db.flush()


def remove_company(db: Session, user: User, company: Company) -> None:
    """Quita una empresa del usuario si la tenía asignada."""
    if company in user.companies:
        user.companies.remove(company)
        db.add(user)
        db.flush()


def replace_supervisors(
    db: Session, guard: User, supervisors: list[User]
) -> None:
    """Reemplaza los supervisores asignados a un guardia."""
    guard.supervisors = supervisors
    db.add(guard)
    db.flush()


def assign_guard(db: Session, supervisor: User, guard: User) -> None:
    """Asocia un guardia a un supervisor."""
    if guard not in supervisor.supervised_guards:
        supervisor.supervised_guards.append(guard)
        db.add(supervisor)
        db.flush()


def unassign_guard(db: Session, supervisor: User, guard: User) -> None:
    """Elimina la asociación guardia-supervisor."""
    if guard in supervisor.supervised_guards:
        supervisor.supervised_guards.remove(guard)
        db.add(supervisor)
        db.flush()


def deactivate_user(db: Session, user: User) -> User:
    """Baja lógica del usuario."""
    user.is_active = False
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def delete_user(db: Session, user: User) -> None:
    """Elimina físicamente al usuario (fallará si tiene rondas asociadas)."""
    db.delete(user)
    db.commit()
