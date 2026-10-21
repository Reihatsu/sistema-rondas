"""Endpoints de Rondas: ciclo de vida, historial, comentarios y marcación QR.

Cubre el flujo operativo completo del guardia:

* Consulta de la ronda activa, de sus checkpoints y del historial.
* Creación e inicio directo de una ronda nueva por parte del guardia.
* Inicio de rondas asignadas, pausa (con motivo obligatorio), reanudación y
  cancelación.
* Marcación por QR con ubicación GPS, tiempos por tramo y cierre automático
  de la ronda al visitar el último checkpoint. La proximidad al punto solo se
  exige si ``ENFORCE_CHECKPOINT_GEOFENCE`` está activo.
* Cancelación automática cuando pasan más de
  ``ROUND_INACTIVITY_TIMEOUT_MINUTES`` minutos sin actividad.
"""

from __future__ import annotations

from datetime import datetime, timedelta

from fastapi import APIRouter, HTTPException, Query, status

from app.api.deps import CurrentUser, DbSession, user_company_ids
from app.core.config import settings
from app.core.geo import haversine_distance_m
from app.core.timeutils import elapsed_seconds as compute_elapsed_seconds
from app.core.timeutils import ensure_utc, utc_now
from app.crud import checkpoint as crud_checkpoint
from app.crud import round as crud_round
from app.models import (
    Checkpoint,
    Round,
    RoundCheckpointStatus,
    RoundLog,
    RoundLogStatus,
    RoundStatus,
    User,
    UserRole,
)
from app.schemas.common import Paginated
from app.schemas.round import (
    RoundCancelCreate,
    RoundCheckInCreate,
    RoundCheckInRead,
    RoundCheckpointRead,
    RoundCommentCreate,
    RoundDetail,
    RoundLogRead,
    RoundPauseCreate,
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

#: Estados que se listan por defecto en el historial del guardia.
HISTORY_STATUSES = (
    RoundStatus.PAUSED,
    RoundStatus.COMPLETED,
    RoundStatus.CANCELLED,
)

#: Ventana por defecto del historial: últimas 24 horas.
HISTORY_WINDOW_HOURS = 24

INACTIVITY_REASON = "Cancelada por inactividad"

INACTIVITY_OBSERVATION = (
    "Cancelación automática por inactividad: "
    f"{settings.ROUND_INACTIVITY_TIMEOUT_MINUTES} minutos sin marcaciones."
)

INACTIVITY_CANCELLED_MESSAGE = (
    "La ronda fue cancelada automáticamente por inactividad: transcurrieron "
    f"más de {settings.ROUND_INACTIVITY_TIMEOUT_MINUTES} minutos sin marcaciones. "
    "Inicie una nueva ronda para continuar."
)



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


def _append_observation(
    round_obj: Round,
    author: str,
    text: str,
    moment: datetime | None = None,
) -> None:
    """Añade una entrada firmada al historial de observaciones de la ronda.

    No existe una tabla de comentarios: se anexa al campo ``observations`` con
    el autor y la fecha UTC para conservar la trazabilidad sin migraciones.
    """
    stamp = (ensure_utc(moment) or utc_now()).strftime("%d/%m/%Y %H:%M UTC")
    entry = f"[{stamp}] {author}: {text.strip()}"
    previous = (round_obj.observations or "").strip()
    round_obj.observations = f"{previous}\n{entry}" if previous else entry


def _close_pause(round_obj: Round, moment: datetime) -> None:
    """Acumula la pausa abierta y limpia ``paused_at``.

    Debe llamarse antes de reanudar o cancelar una ronda pausada para que el
    cronómetro descuente también el último tramo en pausa.
    """
    paused_at = ensure_utc(round_obj.paused_at)
    if paused_at is None:
        round_obj.paused_at = None
        return

    span = max(0, int(((ensure_utc(moment) or utc_now()) - paused_at).total_seconds()))
    round_obj.paused_seconds = (round_obj.paused_seconds or 0) + span
    round_obj.paused_at = None


def _expire_round_if_inactive(
    db: DbSession,
    round_obj: Round,
    *,
    now: datetime | None = None,
) -> bool:
    """Cancela la ronda si superó la ventana de inactividad.

    Solo aplica a rondas ``IN_PROGRESS``; las pausadas pueden retomarse desde
    el historial sin límite de tiempo.

    Returns:
        ``True`` si la ronda acaba de cancelarse por inactividad.
    """
    if round_obj.status is not RoundStatus.IN_PROGRESS:
        return False

    deadline = round_obj.inactivity_deadline
    moment = ensure_utc(now) or utc_now()
    if deadline is None or moment <= deadline:
        return False

    round_obj.status = RoundStatus.CANCELLED
    round_obj.end_time = moment
    round_obj.paused_at = None
    round_obj.cancel_reason = INACTIVITY_REASON
    round_obj.last_activity_at = moment
    _append_observation(round_obj, "Sistema", INACTIVITY_OBSERVATION, moment)

    db.add(round_obj)
    db.commit()
    db.refresh(round_obj)
    return True


def _ensure_own_round(current_user: User, round_obj: Round, action: str) -> None:
    """Restringe las acciones operativas al guardia asignado."""
    if round_obj.guard_id != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"Solo el guardia asignado puede {action}",
        )


def _ensure_open_round(round_obj: Round) -> None:
    """Rechaza acciones sobre rondas ya cerradas."""
    if round_obj.status in (RoundStatus.COMPLETED, RoundStatus.CANCELLED):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="La ronda ya está cerrada y no admite cambios.",
        )


def _round_detail(round_obj: Round) -> RoundDetail:
    """Serializa una ronda con sus marcaciones y campos calculados."""
    return RoundDetail.model_validate(round_obj)



def _to_round_checkpoint(
    checkpoint: Checkpoint,
    *,
    visited_at: datetime | None = None,
    elapsed_seconds: int | None = None,
    segment_seconds: int | None = None,
) -> RoundCheckpointRead:
    """Combina un punto de control con su estado de visita en la ronda."""
    visited = visited_at is not None
    return RoundCheckpointRead(
        id=checkpoint.id,
        name=checkpoint.name,
        code=checkpoint.code,
        location_description=checkpoint.location_description,
        latitude=checkpoint.latitude,
        longitude=checkpoint.longitude,
        geofence_radius_m=checkpoint.geofence_radius_m or 50,
        status=(
            RoundCheckpointStatus.COMPLETED
            if visited
            else RoundCheckpointStatus.PENDING
        ),
        is_visited=visited,
        visited_at=visited_at,
        elapsed_seconds=elapsed_seconds,
        segment_seconds=segment_seconds,
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

    # Si superó la ventana de inactividad se cancela aquí y se devuelve la
    # ronda ya cerrada para que la app muestre la alerta al guardia. En la
    # siguiente consulta ``/active`` ya devolverá ``null``.
    _expire_round_if_inactive(db, round_obj)
    return RoundDetail.model_validate(round_obj)


@router.post(
    "/start-new",
    response_model=RoundDetail,
    status_code=status.HTTP_201_CREATED,
    summary="Crear e iniciar una ronda nueva",
)
def start_new_round(
    db: DbSession,
    current_user: CurrentUser,
) -> RoundDetail:
    """Crea una ronda en curso asignada al guardia autenticado.

    El guardia ya no necesita una ronda ``PENDING`` previamente asignada: la
    app móvil llama a este endpoint y recibe la ronda lista para escanear.

    Reglas:

    * Solo el rol ``GUARD`` puede crear su propia ronda.
    * Si el guardia ya tiene una ronda ``IN_PROGRESS`` o ``PAUSED`` se responde
      ``409`` con su identificador para que el cliente continúe esa ronda.
      Una ronda en curso que superó la ventana de inactividad se cancela y no
      bloquea la creación de la nueva.
    * La empresa se toma de las empresas activas asignadas al guardia. Si
      ninguna tiene checkpoints activos se responde ``400``.
    * La ronda se crea directamente en ``IN_PROGRESS`` con el cronómetro
      iniciado. Su recorrido son los checkpoints activos de la empresa, que se
      consultan con ``GET /rounds/{id}/checkpoints``.
    """
    if current_user.role is not UserRole.GUARD:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Solo un guardia puede iniciar una ronda nueva",
        )

    active = crud_round.get_guard_active_round(db, current_user.id)

    # Una ronda en curso que ya caducó se cierra y deja de bloquear el inicio.
    if active is not None and _expire_round_if_inactive(db, active):
        active = None

    if active is not None:
        state = (
            "pausada"
            if active.status is RoundStatus.PAUSED
            else "en curso"
        )
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                f"Ya tiene una ronda {state} (#{active.id}). Continúe esa "
                "ronda antes de iniciar otra."
            ),
        )

    companies = [company for company in current_user.companies if company.is_active]
    if not companies:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                "No tiene una empresa activa asignada. Solicite al "
                "administrador que le asigne una empresa."
            ),
        )

    # Se elige la primera empresa activa que tenga puntos operativos.
    company = None
    checkpoints: list[Checkpoint] = []
    for candidate in companies:
        candidate_checkpoints = crud_checkpoint.list_active_by_company(
            db, candidate.id
        )
        if candidate_checkpoints:
            company = candidate
            checkpoints = candidate_checkpoints
            break

    if company is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                "Ninguna de sus empresas tiene checkpoints activos. "
                "Solicite al administrador que configure los puntos de control."
            ),
        )

    now = utc_now()
    round_obj = Round(
        company_id=company.id,
        guard_id=current_user.id,
        status=RoundStatus.IN_PROGRESS,
        start_time=now,
        last_activity_at=now,
        paused_seconds=0,
    )
    _append_observation(
        round_obj,
        current_user.name,
        (
            "Ronda iniciada desde la app móvil con "
            f"{len(checkpoints)} checkpoints activos."
        ),
        now,
    )

    db.add(round_obj)
    db.commit()

    refreshed = _get_round_or_404(db, round_obj.id, with_logs=True)
    return _round_detail(refreshed)


@router.get(
    "/history",
    response_model=Paginated[RoundDetail],
    summary="Historial de rondas del guardia",
)
def list_round_history(
    db: DbSession,
    current_user: CurrentUser,
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    round_status: RoundStatus | None = Query(
        None,
        alias="status",
        description=(
            "Filtra por estado. Por defecto devuelve las rondas pausadas, "
            "completadas y canceladas."
        ),
    ),
    date_from: datetime | None = Query(
        None,
        description=(
            "Desde created_at. Si se omite, se aplica la ventana de "
            f"{HISTORY_WINDOW_HOURS} horas."
        ),
    ),
    date_to: datetime | None = Query(None, description="Hasta created_at"),
    last_hours: int = Query(
        HISTORY_WINDOW_HOURS,
        ge=1,
        le=24 * 365,
        description=(
            "Ventana en horas cuando no se envía date_from "
            f"({HISTORY_WINDOW_HOURS} por defecto)."
        ),
    ),
    all_time: bool = Query(
        False,
        description="Ignora la ventana y devuelve todo el historial disponible.",
    ),
) -> Paginated[RoundDetail]:
    """Rondas pasadas (y pausadas) con sus marcaciones para el historial móvil.

    Por defecto solo devuelve las rondas de las **últimas 24 horas**
    (``date_from = now - 24 h``). El cliente puede ampliar la ventana con
    ``last_hours``, fijar un inicio exacto con ``date_from`` o desactivar el
    filtro con ``all_time=true``.

    Las rondas pausadas se incluyen porque el guardia puede continuarlas desde
    la pantalla de historial. El alcance por rol es el mismo que en el resto
    del módulo; un guardia solo ve las suyas.
    """
    allowed_company_ids, restricted_guard_id = _scope(current_user)
    statuses = (round_status,) if round_status else HISTORY_STATUSES

    effective_date_from = ensure_utc(date_from)
    if effective_date_from is None and not all_time:
        effective_date_from = utc_now() - timedelta(hours=last_hours)

    items, total = crud_round.list_rounds(
        db,
        page=page,
        page_size=page_size,
        statuses=statuses,
        date_from=effective_date_from,
        date_to=date_to,
        allowed_company_ids=allowed_company_ids,
        restricted_to_guard_id=restricted_guard_id,
        with_logs=True,
    )

    return Paginated[RoundDetail](
        items=[RoundDetail.model_validate(item) for item in items],
        total=total,
        page=page,
        page_size=page_size,
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
    """Devuelve la ronda junto a sus checkpoints NFC/QR."""
    round_obj = _get_round_or_404(db, round_id, with_logs=True)
    _ensure_round_access(current_user, round_obj)

    # Una ronda en curso que superó la inactividad se muestra ya cancelada.
    _expire_round_if_inactive(db, round_obj)
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
    con el autor y la fecha UTC para conservar la trazabilidad sin migraciones.
    Un comentario cuenta como actividad y reinicia el plazo de inactividad.
    """
    round_obj = _get_round_or_404(db, round_id, with_logs=True)
    _ensure_round_access(current_user, round_obj)

    if _expire_round_if_inactive(db, round_obj):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=INACTIVITY_CANCELLED_MESSAGE,
        )

    now = utc_now()
    _append_observation(round_obj, current_user.name, payload.comment, now)
    if round_obj.status is RoundStatus.IN_PROGRESS:
        round_obj.last_activity_at = now

    db.add(round_obj)
    db.commit()
    db.refresh(round_obj)
    return _round_detail(round_obj)


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
    """Lista los puntos activos de la empresa con su estado y tiempos.

    Es el listado operativo del guardia (a diferencia de ``/checkpoints``, que
    es administrativo y no está disponible para el rol ``GUARD``).

    Para cada punto visitado devuelve:

    * ``elapsed_seconds``: segundos de ronda acumulados (sin pausas) al marcarlo.
    * ``segment_seconds``: segundos desde la marcación anterior de la ronda.
    """
    round_obj = _get_round_or_404(db, round_id)
    _ensure_round_access(current_user, round_obj)

    if _expire_round_if_inactive(db, round_obj):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=INACTIVITY_CANCELLED_MESSAGE,
        )

    checkpoints = crud_checkpoint.list_active_by_company(db, round_obj.company_id)

    # Primera marcación válida por punto: es la que se muestra en la lista.
    visits: dict[int, tuple[datetime, int | None, int | None]] = {}
    previous_elapsed = 0
    for log in crud_round.list_logs(db, round_id):
        if log.checkpoint_id is None or log.checkpoint_id in visits:
            continue

        log_elapsed = log.elapsed_seconds
        segment: int | None = None
        if log_elapsed is not None:
            segment = max(0, log_elapsed - previous_elapsed)
            previous_elapsed = log_elapsed

        visits[log.checkpoint_id] = (log.timestamp, log_elapsed, segment)

    result: list[RoundCheckpointRead] = []
    for checkpoint in checkpoints:
        visited_at, elapsed, segment = visits.get(
            checkpoint.id, (None, None, None)
        )
        result.append(
            _to_round_checkpoint(
                checkpoint,
                visited_at=visited_at,
                elapsed_seconds=elapsed,
                segment_seconds=segment,
            )
        )
    return result


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
    """Valida el QR, la ubicación y registra la marcación del guardia.

    Reglas aplicadas:

    * Solo el guardia asignado puede marcar checkpoints de su ronda.
    * Si la ronda está pendiente, la primera marcación la inicia; una ronda
      pausada, completada o cancelada no admite marcaciones.
    * El código leído debe existir, estar activo y pertenecer a la empresa de
      la ronda.
    * El punto debe tener coordenadas configuradas; con
      ``ENFORCE_CHECKPOINT_GEOFENCE`` activo el dispositivo además debe estar
      dentro del radio de la geovalla.
    * Un punto no puede marcarse dos veces en la misma ronda.
    * Si supera la ventana de inactividad, la ronda se cancela y se devuelve
      un 409 con el motivo para que la app muestre la alerta.
    * Al marcar el último checkpoint pendiente, la ronda pasa a ``COMPLETED``.
    """
    round_obj = _get_round_or_404(db, round_id)
    _ensure_round_access(current_user, round_obj)

    if round_obj.guard_id != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Solo el guardia asignado puede registrar marcaciones",
        )

    now = utc_now()
    # Hora real del escaneo. Las marcaciones offline llegan después, pero deben
    # conservar su instante original para el cronómetro y el historial.
    event_time = ensure_utc(payload.timestamp) or now
    if event_time > now:
        # Un reloj adelantado no debe generar marcaciones futuras.
        event_time = now

    round_start = ensure_utc(round_obj.start_time)
    if round_start is not None and event_time < round_start:
        event_time = round_start

    # Se evalúa la inactividad contra la hora del escaneo, no contra la hora de
    # sincronización: un corte de red no convierte una ronda activa en cancelada.
    if _expire_round_if_inactive(db, round_obj, now=event_time):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=INACTIVITY_CANCELLED_MESSAGE,
        )

    # Idempotencia: si la respuesta de una marcación se perdió y la ronda ya se
    # pausó/cerró, el reintento debe reconocer que el punto sí quedó registrado.
    if round_obj.status in (
        RoundStatus.PAUSED,
        RoundStatus.COMPLETED,
        RoundStatus.CANCELLED,
    ):
        existing_checkpoint = crud_checkpoint.get_checkpoint_by_code(
            db, payload.qr_code
        )
        if existing_checkpoint is not None:
            existing_log = crud_round.get_round_log_for_checkpoint(
                db, round_id, existing_checkpoint.id
            )
            if existing_log is not None:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail=(
                        f"Ya registró el punto «{existing_checkpoint.name}» "
                        "en esta ronda."
                    ),
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
    # La proximidad solo se exige cuando ``ENFORCE_CHECKPOINT_GEOFENCE`` está
    # activo. Desactivada, la distancia se sigue calculando y guardando en el
    # log, pero una marcación lejana no bloquea el registro.
    radius = checkpoint.geofence_radius_m or settings.DEFAULT_GEOFENCE_RADIUS_M
    if settings.ENFORCE_CHECKPOINT_GEOFENCE and distance > radius:
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

    if round_obj.status is RoundStatus.PENDING:
        round_obj.status = RoundStatus.IN_PROGRESS
        round_obj.start_time = round_obj.start_time or event_time

    previous_logs = crud_round.list_logs(db, round_id)
    latest_log_time = max(
        (
            ensure_utc(item.timestamp)
            for item in previous_logs
            if item.timestamp is not None
        ),
        default=None,
    )
    if latest_log_time is not None and event_time < latest_log_time:
        # Evita que un desfase del reloj del dispositivo retroceda el recorrido.
        event_time = latest_log_time

    previous_elapsed = max(
        (item.elapsed_seconds or 0 for item in previous_logs),
        default=0,
    )
    round_elapsed = compute_elapsed_seconds(
        round_obj.start_time,
        event_time,
        round_obj.paused_seconds or 0,
    )
    segment = max(0, round_elapsed - previous_elapsed)

    log = RoundLog(
        round_id=round_obj.id,
        checkpoint_id=checkpoint.id,
        nfc_tag_id=checkpoint.code,
        checkpoint_name=checkpoint.name,
        latitude=payload.latitude,
        longitude=payload.longitude,
        distance_m=round(distance, 1),
        elapsed_seconds=round_elapsed,
        timestamp=event_time,
        status=RoundLogStatus.OK,
    )

    # La actividad del servidor se actualiza al momento de la sincronización:
    # así los elementos restantes del lote no vuelven a caducar mientras llegan.
    round_obj.last_activity_at = now

    active_checkpoints = crud_checkpoint.list_active_by_company(
        db, round_obj.company_id
    )
    visited_ids = {
        item.checkpoint_id for item in previous_logs if item.checkpoint_id is not None
    }
    visited_ids.add(checkpoint.id)
    visited_active_ids = {
        item.id for item in active_checkpoints if item.id in visited_ids
    }
    round_completed = bool(active_checkpoints) and len(visited_active_ids) >= len(
        active_checkpoints
    )

    if round_completed:
        round_obj.status = RoundStatus.COMPLETED
        round_obj.end_time = event_time
        round_obj.paused_at = None
        _append_observation(
            round_obj,
            "Sistema",
            (
                "Ronda completada automáticamente: todos los checkpoints "
                "fueron marcados."
            ),
            event_time,
        )

    db.add(round_obj)
    db.add(log)
    db.commit()
    db.refresh(log)
    db.refresh(round_obj)

    message = (
        f"Checkpoint «{checkpoint.name}» registrado correctamente "
        f"a {distance:.0f} m del punto."
    )
    if round_completed:
        message += " ¡Ronda completada! Todos los puntos fueron visitados."

    return RoundCheckInRead(
        message=message,
        distance_m=round(distance, 1),
        checkpoint=_to_round_checkpoint(
            checkpoint,
            visited_at=event_time,
            elapsed_seconds=round_elapsed,
            segment_seconds=segment,
        ),
        log=RoundLogRead.model_validate(log),
        round_status=round_obj.status,
        round_completed=round_completed,
        remaining_checkpoints=max(
            0, len(active_checkpoints) - len(visited_active_ids)
        ),
        round_elapsed_seconds=round_elapsed,
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
    """Pone en marcha una ronda pendiente del guardia autenticado.

    Es idempotente sobre una ronda ya en curso (solo actualiza la actividad).
    Para retomar una ronda pausada debe usarse ``POST /rounds/{id}/resume``.
    """
    round_obj = _get_round_or_404(db, round_id, with_logs=True)
    _ensure_own_round(current_user, round_obj, "iniciar esta ronda")
    _ensure_open_round(round_obj)

    # Una ronda en curso que ya caducó no puede "revivir" al llamar a start.
    if _expire_round_if_inactive(db, round_obj):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=INACTIVITY_CANCELLED_MESSAGE,
        )

    if round_obj.status is RoundStatus.PAUSED:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                "La ronda está pausada. Use «Reanudar ronda» para continuar "
                "el cronómetro donde lo dejó."
            ),
        )

    now = utc_now()
    if round_obj.status is RoundStatus.PENDING or round_obj.start_time is None:
        round_obj.status = RoundStatus.IN_PROGRESS
        round_obj.start_time = now
        round_obj.end_time = None
        round_obj.paused_at = None
        round_obj.paused_seconds = 0
        round_obj.cancel_reason = None
        round_obj.last_activity_at = now
        _append_observation(round_obj, current_user.name, "Ronda iniciada.", now)
    else:
        round_obj.last_activity_at = now

    db.add(round_obj)
    db.commit()

    refreshed = _get_round_or_404(db, round_id, with_logs=True)
    return _round_detail(refreshed)


@router.post(
    "/{round_id}/pause",
    response_model=RoundDetail,
    summary="Pausar una ronda con un motivo obligatorio",
)
def pause_round(
    round_id: int,
    payload: RoundPauseCreate,
    db: DbSession,
    current_user: CurrentUser,
) -> RoundDetail:
    """Pausa la ronda y congela el cronómetro.

    El motivo es obligatorio y queda firmado en las observaciones de la ronda
    (por ejemplo: «Pausado por emergencia»). Una ronda pausada no caduca por
    inactividad y puede retomarse desde el historial.
    """
    round_obj = _get_round_or_404(db, round_id, with_logs=True)
    _ensure_round_access(current_user, round_obj)
    _ensure_own_round(current_user, round_obj, "pausar esta ronda")
    _ensure_open_round(round_obj)

    if _expire_round_if_inactive(db, round_obj):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=INACTIVITY_CANCELLED_MESSAGE,
        )

    if round_obj.status is RoundStatus.PENDING:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Inicie la ronda antes de pausarla.",
        )
    if round_obj.status is RoundStatus.PAUSED:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="La ronda ya está pausada.",
        )

    now = utc_now()
    round_obj.status = RoundStatus.PAUSED
    round_obj.paused_at = now
    round_obj.last_activity_at = now
    _append_observation(
        round_obj,
        current_user.name,
        f"Ronda pausada: {payload.comment}",
        now,
    )

    db.add(round_obj)
    db.commit()

    refreshed = _get_round_or_404(db, round_id, with_logs=True)
    return _round_detail(refreshed)


@router.post(
    "/{round_id}/resume",
    response_model=RoundDetail,
    summary="Reanudar una ronda pausada",
)
def resume_round(
    round_id: int,
    db: DbSession,
    current_user: CurrentUser,
) -> RoundDetail:
    """Retoma una ronda pausada y descuenta el tiempo en pausa.

    Los checkpoints ya marcados se conservan: el cliente los vuelve a cargar
    con ``GET /rounds/{id}/checkpoints`` para mostrar el progreso previo.
    """
    round_obj = _get_round_or_404(db, round_id, with_logs=True)
    _ensure_round_access(current_user, round_obj)
    _ensure_own_round(current_user, round_obj, "reanudar esta ronda")
    _ensure_open_round(round_obj)

    if round_obj.status is not RoundStatus.PAUSED:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="La ronda no está pausada; no es necesario reanudarla.",
        )

    now = utc_now()
    _close_pause(round_obj, now)
    round_obj.status = RoundStatus.IN_PROGRESS
    round_obj.last_activity_at = now
    _append_observation(round_obj, current_user.name, "Ronda reanudada.", now)

    db.add(round_obj)
    db.commit()

    refreshed = _get_round_or_404(db, round_id, with_logs=True)
    return _round_detail(refreshed)


@router.post(
    "/{round_id}/cancel",
    response_model=RoundDetail,
    summary="Cancelar una ronda con un motivo obligatorio",
)
def cancel_round(
    round_id: int,
    payload: RoundCancelCreate,
    db: DbSession,
    current_user: CurrentUser,
) -> RoundDetail:
    """Aborta la ronda y conserva el motivo en el historial.

    Si la ronda estaba pausada, el tramo en pausa se descuenta del cronómetro
    antes de cerrarla.
    """
    round_obj = _get_round_or_404(db, round_id, with_logs=True)
    _ensure_round_access(current_user, round_obj)
    _ensure_own_round(current_user, round_obj, "cancelar esta ronda")
    _ensure_open_round(round_obj)

    if _expire_round_if_inactive(db, round_obj):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=INACTIVITY_CANCELLED_MESSAGE,
        )

    now = utc_now()
    if round_obj.status is RoundStatus.PAUSED:
        _close_pause(round_obj, now)

    round_obj.status = RoundStatus.CANCELLED
    round_obj.end_time = now
    round_obj.paused_at = None
    round_obj.cancel_reason = payload.reason
    round_obj.last_activity_at = now
    _append_observation(
        round_obj,
        current_user.name,
        f"Ronda cancelada: {payload.reason}",
        now,
    )

    db.add(round_obj)
    db.commit()

    refreshed = _get_round_or_404(db, round_id, with_logs=True)
    return _round_detail(refreshed)
