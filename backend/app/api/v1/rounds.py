"""Endpoints de lectura de Rondas para informes y vista de cliente."""

from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, HTTPException, Query, status

from app.api.deps import CurrentUser, DbSession, user_company_ids
from app.crud import round as crud_round
from app.models import Round, RoundStatus, User, UserRole
from app.schemas.common import Paginated
from app.schemas.round import (
    RoundCommentCreate,
    RoundDetail,
    RoundLogRead,
    RoundRead,
    RoundStatusCount,
    RoundSummary,
)

router = APIRouter(prefix="/rounds", tags=["Rondas"])

#: Estados en el orden en que se muestran en el panel.
STATUS_ORDER = [
    RoundStatus.PENDING,
    RoundStatus.IN_PROGRESS,
    RoundStatus.PAUSED,
    RoundStatus.COMPLETED,
    RoundStatus.CANCELLED,
]


def _scope(current_user: User) -> tuple[list[int] | None, int | None]:
    """Calcula el alcance de datos según el rol del usuario.

    Returns:
        ``(allowed_company_ids, restricted_to_guard_id)``.
        ``None`` significa "sin restricción" en ese criterio.
    """
    if current_user.role is UserRole.ADMIN:
        return None, None
    if current_user.role is UserRole.GUARD:
        return None, current_user.id
    # SUPERVISOR y COMPANY_USER: solo sus empresas asignadas.
    return user_company_ids(current_user), None


def _ensure_round_access(current_user: User, round_obj: Round) -> None:
    """Valida que el usuario pueda ver una ronda concreta."""
    if current_user.role is UserRole.ADMIN:
        return
    if current_user.role is UserRole.GUARD:
        # Un guardia solo accede a sus propias rondas; no hereda el acceso por
        # empresa (las empresas asignadas se usan para guardias y supervisores).
        if round_obj.guard_id == current_user.id:
            return
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="No tiene acceso a esta ronda",
        )
    if round_obj.company_id in user_company_ids(current_user):
        return
    if current_user.role is UserRole.SUPERVISOR and any(
        guard.id == round_obj.guard_id for guard in current_user.supervised_guards
    ):
        return
    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail="No tiene acceso a esta ronda",
    )


@router.get("", response_model=Paginated[RoundRead], summary="Listar rondas")
def list_rounds(
    db: DbSession,
    current_user: CurrentUser,
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    company_id: int | None = Query(None),
    guard_id: int | None = Query(None),
    round_status: RoundStatus | None = Query(None, alias="status"),
    date_from: datetime | None = Query(
        None, description="Fecha/hora inicial (ISO 8601) sobre created_at"
    ),
    date_to: datetime | None = Query(
        None, description="Fecha/hora final (ISO 8601) sobre created_at"
    ),
) -> Paginated[RoundRead]:
    """Listado paginado con filtros; el alcance depende del rol autenticado."""
    allowed_company_ids, restricted_guard_id = _scope(current_user)

    items, total = crud_round.list_rounds(
        db,
        page=page,
        page_size=page_size,
        company_id=company_id,
        guard_id=guard_id,
        status=round_status,
        date_from=date_from,
        date_to=date_to,
        allowed_company_ids=allowed_company_ids,
        restricted_to_guard_id=restricted_guard_id,
    )
    return Paginated[RoundRead](
        items=[RoundRead.model_validate(item) for item in items],
        total=total,
        page=page,
        page_size=page_size,
    )


@router.get(
    "/summary",
    response_model=RoundSummary,
    summary="Resumen de rondas por estado",
)
def get_rounds_summary(
    db: DbSession,
    current_user: CurrentUser,
    company_id: int | None = Query(None),
    date_from: datetime | None = Query(None),
    date_to: datetime | None = Query(None),
) -> RoundSummary:
    """Totales por estado para las tarjetas/gráficos del panel."""
    allowed_company_ids, restricted_guard_id = _scope(current_user)
    counts = crud_round.count_by_status(
        db,
        company_id=company_id,
        date_from=date_from,
        date_to=date_to,
        allowed_company_ids=allowed_company_ids,
        restricted_to_guard_id=restricted_guard_id,
    )
    by_status = [
        RoundStatusCount(status=item, count=counts.get(item, 0))
        for item in STATUS_ORDER
    ]
    return RoundSummary(
        total=sum(counts.values()),
        by_status=by_status,
    )


@router.get(
    "/{round_id}",
    response_model=RoundDetail,
    summary="Obtener ronda con su trazabilidad",
)
def get_round(
    round_id: int,
    db: DbSession,
    current_user: CurrentUser,
) -> RoundDetail:
    """Devuelve la ronda junto a sus checkpoints NFC."""
    round_obj = crud_round.get_round(db, round_id, with_logs=True)
    if round_obj is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Ronda no encontrada"
        )
    _ensure_round_access(current_user, round_obj)
    return RoundDetail.model_validate(round_obj)


@router.post(
    "/{round_id}/comments",
    response_model=RoundDetail,
    status_code=status.HTTP_201_CREATED,
    summary="Añadir un comentario a una ronda",
)
def add_round_comment(
    round_id: int,
    payload: RoundCommentCreate,
    db: DbSession,
    current_user: CurrentUser,
) -> RoundDetail:
    """Añade una nota operativa firmada al historial de observaciones.

    No existe una tabla de comentarios: se anexa al campo ``observations``
    con el autor y la fecha para conservar la trazabilidad sin migraciones.
    """
    round_obj = crud_round.get_round(db, round_id, with_logs=True)
    if round_obj is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Ronda no encontrada"
        )
    _ensure_round_access(current_user, round_obj)

    stamp = datetime.now().strftime("%d/%m/%Y %H:%M")
    entry = f"[{stamp}] {current_user.name}: {payload.comment}"
    previous = (round_obj.observations or "").strip()
    round_obj.observations = f"{previous}\n{entry}" if previous else entry

    db.add(round_obj)
    db.commit()
    db.refresh(round_obj)
    return RoundDetail.model_validate(round_obj)


@router.get(
    "/{round_id}/logs",
    response_model=list[RoundLogRead],
    summary="Checkpoints de una ronda",
)
def list_round_logs(
    round_id: int,
    db: DbSession,
    current_user: CurrentUser,
) -> list[RoundLogRead]:
    """Devuelve los registros NFC de la ronda ordenados cronológicamente."""
    round_obj = crud_round.get_round(db, round_id)
    if round_obj is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Ronda no encontrada"
        )
    _ensure_round_access(current_user, round_obj)
    logs = crud_round.list_logs(db, round_id)
    return [RoundLogRead.model_validate(log) for log in logs]
