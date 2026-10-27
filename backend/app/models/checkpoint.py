"""Modelo de Puntos de Control (Checkpoint).

Un punto de control representa una ubicación física de una empresa que puede
identificarse mediante un código QR/NFC para las rondas de vigilancia.
"""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import (
    Boolean,
    DateTime,
    Float,
    ForeignKey,
    Integer,
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
        #: UID físico de la etiqueta NFC; solo los puntos NFC lo utilizan.
        UniqueConstraint("uid_nfc", name="uq_checkpoints_uid_nfc"),
    )

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    company_id: Mapped[int] = mapped_column(
        ForeignKey("companies.id", ondelete="CASCADE"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(String(150), nullable=False)
    code: Mapped[str] = mapped_column(String(100), nullable=False)
    #: UID de la etiqueta NFC normalizado (hex en mayúsculas, sin separadores).
    uid_nfc: Mapped[str | None] = mapped_column(
        String(100), nullable=True, index=True
    )
    location_description: Mapped[str | None] = mapped_column(Text, nullable=True)
    #: Coordenadas del punto para validar la geovalla al marcar por QR.
    latitude: Mapped[float | None] = mapped_column(Float, nullable=True)
    longitude: Mapped[float | None] = mapped_column(Float, nullable=True)
    #: Radio (en metros) dentro del cual se acepta una marcación.
    geofence_radius_m: Mapped[int] = mapped_column(
        Integer, nullable=False, default=50, server_default="50"
    )
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
