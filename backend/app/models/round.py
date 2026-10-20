"""Modelos base para la fase de rondas y sus checkpoints NFC."""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, Float, ForeignKey, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base
from app.models.enums import (
    RoundLogStatus,
    RoundStatus,
    round_log_status_type,
    round_status_type,
)


class Round(Base):
    """Ronda de vigilancia ejecutada por un guardia en una empresa."""

    __tablename__ = "rounds"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    company_id: Mapped[int] = mapped_column(
        ForeignKey("companies.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    guard_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    status: Mapped[RoundStatus] = mapped_column(
        round_status_type,
        nullable=False,
        default=RoundStatus.PENDING,
        server_default=RoundStatus.PENDING.value,
        index=True,
    )
    start_time: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    end_time: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    observations: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), index=True
    )

    # --- Relaciones ---
    company: Mapped["Company"] = relationship(  # noqa: F821
        "Company", back_populates="rounds"
    )
    guard: Mapped["User"] = relationship(  # noqa: F821
        "User", back_populates="rounds", foreign_keys=[guard_id]
    )
    logs: Mapped[list["RoundLog"]] = relationship(
        "RoundLog",
        back_populates="round",
        cascade="all, delete-orphan",
        order_by="RoundLog.timestamp",
    )

    def __repr__(self) -> str:  # pragma: no cover - ayuda de depuración
        return f"<Round id={self.id} status={self.status.value}>"


class RoundLog(Base):
    """Lectura de un checkpoint (NFC o QR) dentro de una ronda."""

    __tablename__ = "round_logs"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    round_id: Mapped[int] = mapped_column(
        ForeignKey("rounds.id", ondelete="CASCADE"), nullable=False, index=True
    )
    #: Punto de control marcado. Nulo en lecturas NFC antiguas que solo
    #: guardaban el nombre y el identificador de la etiqueta.
    checkpoint_id: Mapped[int | None] = mapped_column(
        ForeignKey("checkpoints.id", ondelete="SET NULL"), nullable=True, index=True
    )
    #: Código leído del QR/NFC; se conserva para la trazabilidad histórica.
    nfc_tag_id: Mapped[str] = mapped_column(String(100), nullable=False, index=True)
    checkpoint_name: Mapped[str] = mapped_column(String(150), nullable=False)
    #: Coordenadas capturadas por el dispositivo al marcar por QR.
    latitude: Mapped[float | None] = mapped_column(Float, nullable=True)
    longitude: Mapped[float | None] = mapped_column(Float, nullable=True)
    #: Distancia calculada entre el guardia y el punto, en metros.
    distance_m: Mapped[float | None] = mapped_column(Float, nullable=True)
    timestamp: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), index=True
    )
    status: Mapped[RoundLogStatus] = mapped_column(
        round_log_status_type,
        nullable=False,
        default=RoundLogStatus.OK,
        server_default=RoundLogStatus.OK.value,
    )

    # --- Relaciones ---
    round: Mapped["Round"] = relationship("Round", back_populates="logs")

    def __repr__(self) -> str:  # pragma: no cover - ayuda de depuración
        return (
            f"<RoundLog id={self.id} round_id={self.round_id} "
            f"tag={self.nfc_tag_id!r}>"
        )


# Importaciones al final para evitar ciclos (registran los mappers).
from app.models.company import Company  # noqa: E402,F401
from app.models.user import User  # noqa: E402,F401
