"""Modelos de Usuario y relaciones de asignación."""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import Boolean, DateTime, String, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.associations import supervisor_guards, user_companies
from app.models.base import Base
from app.models.enums import UserRole, user_role_type


class User(Base):
    """Usuario del sistema (Admin, Supervisor, Usuario de empresa o Guardia)."""

    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(150), nullable=False)
    email: Mapped[str] = mapped_column(String(150), unique=True, nullable=False)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    role: Mapped[UserRole] = mapped_column(
        user_role_type,
        nullable=False,
        default=UserRole.GUARD,
        server_default=UserRole.GUARD.value,
        index=True,
    )
    is_active: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=True, server_default="1", index=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )

    # --- Relaciones ---
    #: Empresas a las que el usuario tiene acceso.
    companies: Mapped[list["Company"]] = relationship(  # noqa: F821
        "Company",
        secondary=user_companies,
        back_populates="users",
    )

    #: Guardias que este usuario (SUPERVISOR) tiene a cargo.
    supervised_guards: Mapped[list["User"]] = relationship(
        "User",
        secondary=supervisor_guards,
        primaryjoin="User.id == supervisor_guards.c.supervisor_id",
        secondaryjoin="User.id == supervisor_guards.c.guard_id",
        back_populates="supervisors",
    )

    #: Supervisores a los que este usuario (GUARD) reporta.
    supervisors: Mapped[list["User"]] = relationship(
        "User",
        secondary=supervisor_guards,
        primaryjoin="User.id == supervisor_guards.c.guard_id",
        secondaryjoin="User.id == supervisor_guards.c.supervisor_id",
        back_populates="supervised_guards",
    )

    #: Rondas ejecutadas por este usuario (rol GUARD).
    rounds: Mapped[list["Round"]] = relationship(  # noqa: F821
        "Round",
        back_populates="guard",
        foreign_keys="Round.guard_id",
    )

    def __repr__(self) -> str:  # pragma: no cover - ayuda de depuración
        return f"<User id={self.id} email={self.email!r} role={self.role.value}>"


from app.models.company import Company  # noqa: E402,F401  (registro del mapper)
from app.models.round import Round  # noqa: E402,F401
