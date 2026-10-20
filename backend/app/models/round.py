"""Modelos base para la fase de rondas y sus checkpoints NFC."""

from __future__ import annotations

from datetime import datetime, timedelta

from sqlalchemy import DateTime, Float, ForeignKey, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core import timeutils
from app.core.config import settings
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
    #: Momento en que empezó la pausa actual (``None`` si no está pausada).
    paused_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    #: Segundos acumulados en pausas ya cerradas; se descuentan del cronómetro.
    paused_seconds: Mapped[int] = mapped_column(
        Integer, nullable=False, default=0, server_default="0"
    )
    #: Última actividad del guardia (inicio, marcación, pausa o reanudación).
    last_activity_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True, index=True
    )
    #: Motivo del cierre cuando la ronda se cancela (manual o por inactividad).
    cancel_reason: Mapped[str | None] = mapped_column(String(255), nullable=True)
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

    # --- Propiedades calculadas (se exponen en ``RoundRead``) ---
    @property
    def effective_end_time(self) -> datetime:
        """Momento hasta el que corre el cronómetro de la ronda.

        * Cerrada: su ``end_time``.
        * Pausada: el instante en que comenzó la pausa.
        * En curso: ahora.
        """
        end = timeutils.ensure_utc(self.end_time)
        if end is not None:
            return end

        if self.status is RoundStatus.PAUSED:
            paused = timeutils.ensure_utc(self.paused_at)
            if paused is not None:
                return paused

        return timeutils.utc_now()

    @property
    def elapsed_seconds(self) -> int:
        """Tiempo efectivo de ronda en segundos, descontando las pausas."""
        if self.start_time is None or self.status is RoundStatus.PENDING:
            return 0
        return timeutils.elapsed_seconds(
            self.start_time,
            self.effective_end_time,
            self.paused_seconds or 0,
        )

    @property
    def inactivity_deadline(self) -> datetime | None:
        """Fecha límite antes de que la ronda se cancele por inactividad.

        Solo aplica a rondas ``IN_PROGRESS``: una ronda pausada puede
        retomarse desde el historial sin límite de tiempo.
        """
        if self.status is not RoundStatus.IN_PROGRESS:
            return None

        reference = (
            timeutils.ensure_utc(self.last_activity_at)
            or timeutils.ensure_utc(self.start_time)
            or timeutils.ensure_utc(self.created_at)
        )
        if reference is None:  # pragma: no cover - created_at nunca es nulo
            return None

        return reference + timedelta(
            seconds=settings.ROUND_INACTIVITY_TIMEOUT_SECONDS
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
    #: Segundos de ronda (sin pausas) transcurridos al marcar este punto.
    elapsed_seconds: Mapped[int | None] = mapped_column(Integer, nullable=True)
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
