"""Endpoints de Rondas: consultas, comentarios y marcación QR con GPS."""

from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException, Query, status

from app.api.deps import CurrentUser, DbSession, user_company_ids
from app.core.geo import haversine_distance_m
from app.crud import checkpoint as crud_checkpoint
from app.crud import round as crud_round
from app.models import (
    Checkpoint,
    Round,
    RoundLog,
    RoundLogStatus,
    RoundStatus,
    User,
    UserRole,
)
from app.schemas.common import Paginated
from app.schemas.round import (
    RoundCheckInCreate,
    RoundCheckInRead,
    RoundCheckpointRead,
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


def _get_round_or_404(db: DbSession, round_id: int, *, with_logs: bool = False) -> Round:
    """Recupera una ronda o lanza 404 con un mensaje en español."""
    round_obj = crud_round.get_round(db, round_id, with_logs=with_logs)
    if round_obj is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Ronda no encontrada"
        )
    return round_obj


def _to_round_checkpoint(
    checkpoint: Checkpoint,
    visited_at: datetime | None = None,
) -> RoundCheckpointRead:
    """Combina un punto de control con su estado de visita en la ronda."""
    return RoundCheckpointRead(
        id=checkpoint.id,
        name=checkpoint.name,
        code=checkpoint.code,
        location_description=checkpoint.location_description,
        latitude=checkpoint.latitude,
        longitude=checkpoint.longitude,
        geofence_radius_m=checkpoint.geofence_radius_m or 50,
        is_visited=visited_at is not None,
        visited_at=visited_at,
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
    "/active",
    response_model=RoundDetail | None,
    summary="Ronda activa del guardia",
)
def get_active_round(
    db: DbSession,
    current_user: CurrentUser,
) -> RoundDetail | None:
    """Devuelve la ronda en curso (o pausada) del guardia autenticado.

    Responde ``null`` cuando el guardia no tiene ninguna ronda abierta, para
    que el cliente muestre un estado vacío sin tratarlo como un error.

    Nota: debe declararse antes de ``GET /rounds/{round_id}`` para que
    ``active`` no se interprete como un identificador numérico.
    """
    if current_user.role is not UserRole.GUARD:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="La ronda activa solo está disponible para guardias",
        )

    round_obj = crud_round.get_guard_active_round(db, current_user.id)
    if round_obj is None:
        return None
    return RoundDetail.model_validate(round_obj)


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
    round_obj = _get_round_or_404(db, round_id)
    _ensure_round_access(current_user, round_obj)
    logs = crud_round.list_logs(db, round_id)
    return [RoundLogRead.model_validate(log) for log in logs]


@router.get(
    "/{round_id}/checkpoints",
    response_model=list[RoundCheckpointRead],
    summary="Checkpoints asignados a la ronda con su estado",
)
def list_round_checkpoints(
    round_id: int,
    db: DbSession,
    current_user: CurrentUser,
) -> list[RoundCheckpointRead]:
    """Lista los puntos activos de la empresa con su estado de visita.

    Es el listado operativo del guardia (a diferencia de ``/checkpoints``, que
    es administrativo y no está disponible para el rol ``GUARD``).
    """
    round_obj = _get_round_or_404(db, round_id)
    _ensure_round_access(current_user, round_obj)

    checkpoints = crud_checkpoint.list_active_by_company(db, round_obj.company_id)
    # Primera marcación válida por punto: es la que se muestra en la lista.
    visited_at: dict[int, datetime] = {}
    for log in crud_round.list_logs(db, round_id):
        if log.checkpoint_id is not None and log.checkpoint_id not in visited_at:
            visited_at[log.checkpoint_id] = log.timestamp

    return [
        _to_round_checkpoint(checkpoint, visited_at.get(checkpoint.id))
        for checkpoint in checkpoints
    ]


@router.post(
    "/{round_id}/checkin",
    response_model=RoundCheckInRead,
    status_code=status.HTTP_201_CREATED,
    summary="Registrar la marcación de un checkpoint por QR",
)
def register_checkin(
    round_id: int,
    payload: RoundCheckInCreate,
    db: DbSession,
    current_user: CurrentUser,
) -> RoundCheckInRead:
    """Valida el QR, la geovalla y registra la marcación del guardia.

    Reglas aplicadas:

    * Solo el guardia asignado puede marcar checkpoints de su ronda.
    * Si la ronda está pendiente, la primera marcación la inicia; una ronda
      pausada, completada o cancelada no admite marcaciones.
    * El código leído debe existir, estar activo y pertenecer a la empresa de
      la ronda.
    * El punto debe tener coordenadas configuradas y el dispositivo debe estar
      dentro del radio de la geovalla.
    * Un punto no puede marcarse dos veces en la misma ronda.
    """
    round_obj = _get_round_or_404(db, round_id)
    _ensure_round_access(current_user, round_obj)

    if round_obj.guard_id != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Solo el guardia asignado puede registrar marcaciones",
        )
    if round_obj.status is RoundStatus.PAUSED:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="La ronda está pausada. Reanúdela antes de marcar checkpoints.",
        )
    if round_obj.status in (RoundStatus.COMPLETED, RoundStatus.CANCELLED):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="La ronda ya está cerrada y no admite nuevas marcaciones.",
        )

    checkpoint = crud_checkpoint.get_checkpoint_by_code(db, payload.qr_code)
    if checkpoint is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=(
                "El código QR no corresponde a ningún punto de control. "
                "Verifique que escaneó la etiqueta correcta."
            ),
        )
    if checkpoint.company_id != round_obj.company_id:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="El punto de control no pertenece a la empresa de esta ronda.",
        )
    if not checkpoint.is_active:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="El punto de control está desactivado.",
        )
    if checkpoint.latitude is None or checkpoint.longitude is None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                "El punto de control no tiene coordenadas configuradas; "
                "no es posible validar la ubicación."
            ),
        )

    distance = haversine_distance_m(
        payload.latitude,
        payload.longitude,
        checkpoint.latitude,
        checkpoint.longitude,
    )
    radius = checkpoint.geofence_radius_m or 50
    if distance > radius:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                f"Está a {distance:.0f} m del punto «{checkpoint.name}» y el "
                f"máximo permitido es {radius} m. Acérquese e inténtelo de nuevo."
            ),
        )

    previous_log = crud_round.get_round_log_for_checkpoint(
        db, round_id, checkpoint.id
    )
    if previous_log is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Ya registró el punto «{checkpoint.name}» en esta ronda.",
        )

    now = datetime.now(timezone.utc)
    if round_obj.status is RoundStatus.PENDING:
        round_obj.status = RoundStatus.IN_PROGRESS
        round_obj.start_time = round_obj.start_time or now

    log = RoundLog(
        round_id=round_obj.id,
        checkpoint_id=checkpoint.id,
        nfc_tag_id=checkpoint.code,
        checkpoint_name=checkpoint.name,
        latitude=payload.latitude,
        longitude=payload.longitude,
        distance_m=round(distance, 1),
        timestamp=now,
        status=RoundLogStatus.OK,
    )
    db.add(round_obj)
    db.add(log)
    db.commit()
    db.refresh(log)

    return RoundCheckInRead(
        message=(
            f"Checkpoint «{checkpoint.name}» registrado correctamente "
            f"a {distance:.0f} m del punto."
        ),
        distance_m=round(distance, 1),
        checkpoint=_to_round_checkpoint(checkpoint, now),
        log=RoundLogRead.model_validate(log),
    )


@router.post(
    "/{round_id}/start",
    response_model=RoundDetail,
    summary="Iniciar una ronda asignada al guardia",
)
def start_round(
    round_id: int,
    db: DbSession,
    current_user: CurrentUser,
) -> RoundDetail:
    """Pone en marcha una ronda pendiente del guardia autenticado."""
    round_obj = _get_round_or_404(db, round_id)
    if round_obj.guard_id != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Solo el guardia asignado puede iniciar esta ronda",
        )
    if round_obj.status in (RoundStatus.COMPLETED, RoundStatus.CANCELLED):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="La ronda ya está cerrada y no se puede iniciar.",
        )

    if round_obj.status is not RoundStatus.IN_PROGRESS:
        round_obj.status = RoundStatus.IN_PROGRESS
        round_obj.start_time = round_obj.start_time or datetime.now(timezone.utc)
        round_obj.end_time = None
        db.add(round_obj)
        db.commit()

    refreshed = crud_round.get_round(db, round_id, with_logs=True)
    if refreshed is None:  # pragma: no cover - la ronda se acaba de confirmar
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Ronda no encontrada"
        )
    return RoundDetail.model_validate(refreshed)
