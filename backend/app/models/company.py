"""Modelo de Empresa (Company)."""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import Boolean, DateTime, String, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.associations import user_companies
from app.models.base import Base
from app.models.enums import PointType, point_type_type


class Company(Base):
    """Empresa cliente para la que se ejecutan las rondas."""

    __tablename__ = "companies"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(150), unique=True, nullable=False)
    tax_id: Mapped[str] = mapped_column(String(30), unique=True, nullable=False)
    address: Mapped[str | None] = mapped_column(String(255), nullable=True)
    phone: Mapped[str | None] = mapped_column(String(30), nullable=True)
    #: Tecnología de identificación de los puntos: QR (impreso) o NFC (etiqueta).
    point_type: Mapped[PointType] = mapped_column(
        point_type_type,
        nullable=False,
        default=PointType.QR,
        server_default=PointType.QR.value,
        index=True,
    )
    is_active: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=True, server_default="1", index=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )

    # --- Relaciones ---
    users: Mapped[list["User"]] = relationship(  # noqa: F821 (forward ref)
        "User",
        secondary=user_companies,
        back_populates="companies",
    )
    rounds: Mapped[list["Round"]] = relationship(  # noqa: F821
        "Round",
        back_populates="company",
    )
    checkpoints: Mapped[list["Checkpoint"]] = relationship(  # noqa: F821
        "Checkpoint",
        back_populates="company",
        cascade="all, delete-orphan",
    )

    def __repr__(self) -> str:  # pragma: no cover - ayuda de depuración
        return f"<Company id={self.id} name={self.name!r}>"


from app.models.checkpoint import Checkpoint  # noqa: E402,F401
from app.models.round import Round  # noqa: E402,F401  (registro del mapper)
from app.models.user import User  # noqa: E402,F401
