"""Modelo de Puntos de Control (Checkpoint).

Un punto de control representa una ubicación física de una empresa que puede
identificarse mediante un código QR/NFC para las rondas de vigilancia.
"""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import (
    Boolean,
    DateTime,
    ForeignKey,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base


class Checkpoint(Base):
    """Punto de control configurable dentro de una empresa."""

    __tablename__ = "checkpoints"
    __table_args__ = (
        # El código se comparte entre QR y NFC; debe ser único en todo el
        # sistema para que una lectura identifique un único punto.
        UniqueConstraint("code", name="uq_checkpoints_code"),
    )

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    company_id: Mapped[int] = mapped_column(
        ForeignKey("companies.id", ondelete="CASCADE"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(String(150), nullable=False)
    code: Mapped[str] = mapped_column(String(100), nullable=False)
    location_description: Mapped[str | None] = mapped_column(Text, nullable=True)
    is_active: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=True, server_default="1", index=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )

    # --- Relaciones ---
    company: Mapped["Company"] = relationship(  # noqa: F821
        "Company", back_populates="checkpoints"
    )

    def __repr__(self) -> str:  # pragma: no cover - ayuda de depuración
        return (
            f"<Checkpoint id={self.id} company_id={self.company_id} "
            f"code={self.code!r}>"
        )


# Importación al final para evitar ciclos (registra el mapper de Company).
from app.models.company import Company  # noqa: E402,F401
