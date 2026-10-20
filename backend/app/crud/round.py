"""Consultas de Rondas para el panel de informes."""

from __future__ import annotations

from collections.abc import Sequence
from datetime import datetime

from sqlalchemy import func, select
from sqlalchemy.orm import Session, joinedload, selectinload

from app.models import Round, RoundLog, RoundStatus

#: Relaciones necesarias para las respuestas ``RoundRead``.
ROUND_LOAD_OPTIONS = (
    joinedload(Round.company),
    joinedload(Round.guard),
)


def get_round(db: Session, round_id: int, *, with_logs: bool = False) -> Round | None:
    """Devuelve una ronda por ID con empresa y guardia cargados."""
    options: list = list(ROUND_LOAD_OPTIONS)
    if with_logs:
        options.append(selectinload(Round.logs))
    return db.scalar(select(Round).options(*options).where(Round.id == round_id))


def list_rounds(
    db: Session,
    *,
    page: int,
    page_size: int,
    company_id: int | None = None,
    guard_id: int | None = None,
    status: RoundStatus | None = None,
    statuses: Sequence[RoundStatus] | None = None,
    date_from: datetime | None = None,
    date_to: datetime | None = None,
    allowed_company_ids: list[int] | None = None,
    restricted_to_guard_id: int | None = None,
    with_logs: bool = False,
) -> tuple[list[Round], int]:
    """Lista rondas paginadas aplicando filtros y alcance por rol.

    Args:
        status: Filtra por un único estado.
        statuses: Filtra por varios estados (se ignora si ``status`` está dado).
        with_logs: Carga las marcaciones para las respuestas ``RoundDetail``.
    """
    filters = []
    if company_id is not None:
        filters.append(Round.company_id == company_id)
    if guard_id is not None:
        filters.append(Round.guard_id == guard_id)
    if status is not None:
        filters.append(Round.status == status)
    elif statuses:
        filters.append(Round.status.in_(tuple(statuses)))
    if date_from is not None:
        filters.append(Round.created_at >= date_from)
    if date_to is not None:
        filters.append(Round.created_at <= date_to)
    if allowed_company_ids is not None:
        filters.append(Round.company_id.in_(allowed_company_ids))
    if restricted_to_guard_id is not None:
        filters.append(Round.guard_id == restricted_to_guard_id)

    options: list = list(ROUND_LOAD_OPTIONS)
    if with_logs:
        options.append(selectinload(Round.logs))

    base = select(Round).where(*filters)
    total = db.scalar(select(func.count()).select_from(base.subquery())) or 0
    items = list(
        db.scalars(
            base.options(*options)
            .order_by(Round.created_at.desc(), Round.id.desc())
            .offset((page - 1) * page_size)
            .limit(page_size)
        )
    )
    return items, total


def list_logs(db: Session, round_id: int) -> list[RoundLog]:
    """Devuelve los checkpoints de una ronda ordenados cronológicamente."""
    return list(
        db.scalars(
            select(RoundLog)
            .where(RoundLog.round_id == round_id)
            .order_by(RoundLog.timestamp.asc(), RoundLog.id.asc())
        )
    )


def get_guard_active_round(db: Session, guard_id: int) -> Round | None:
    """Devuelve la ronda operativa actual del guardia (en curso o pausada).

    Si el guardia tuviera más de una ronda abierta por un error de datos, se
    devuelve la más reciente para no bloquear la operación en el móvil.
    """
    return db.scalar(
        select(Round)
        .options(*ROUND_LOAD_OPTIONS, selectinload(Round.logs))
        .where(
            Round.guard_id == guard_id,
            Round.status.in_((RoundStatus.IN_PROGRESS, RoundStatus.PAUSED)),
        )
        .order_by(Round.created_at.desc(), Round.id.desc())
        .limit(1)
    )


def get_round_log_for_checkpoint(
    db: Session,
    round_id: int,
    checkpoint_id: int,
) -> RoundLog | None:
    """Busca una marcación previa del mismo checkpoint en la ronda."""
    return db.scalar(
        select(RoundLog)
        .where(
            RoundLog.round_id == round_id,
            RoundLog.checkpoint_id == checkpoint_id,
        )
        .order_by(RoundLog.timestamp.asc(), RoundLog.id.asc())
        .limit(1)
    )


def count_by_status(
    db: Session,
    *,
    company_id: int | None = None,
    date_from: datetime | None = None,
    date_to: datetime | None = None,
    allowed_company_ids: list[int] | None = None,
    restricted_to_guard_id: int | None = None,
) -> dict[RoundStatus, int]:
    """Agrupa la cantidad de rondas por estado (para el panel de informes)."""
    filters = []
    if company_id is not None:
        filters.append(Round.company_id == company_id)
    if date_from is not None:
        filters.append(Round.created_at >= date_from)
    if date_to is not None:
        filters.append(Round.created_at <= date_to)
    if allowed_company_ids is not None:
        filters.append(Round.company_id.in_(allowed_company_ids))
    if restricted_to_guard_id is not None:
        filters.append(Round.guard_id == restricted_to_guard_id)

    rows = db.execute(
        select(Round.status, func.count(Round.id))
        .where(*filters)
        .group_by(Round.status)
    ).all()
    return {status: count for status, count in rows}
