"""Operaciones de base de datos para Puntos de Control."""

from __future__ import annotations

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session, joinedload

from app.models import Checkpoint, PointType
from app.schemas.checkpoint import CheckpointCreate, CheckpointUpdate

#: La respuesta incluye el resumen de la empresa propietaria.
CHECKPOINT_LOAD_OPTIONS = (joinedload(Checkpoint.company),)


def get_checkpoint(db: Session, checkpoint_id: int) -> Checkpoint | None:
    """Devuelve un punto de control por ID con su empresa cargada."""
    return db.scalar(
        select(Checkpoint)
        .options(*CHECKPOINT_LOAD_OPTIONS)
        .where(Checkpoint.id == checkpoint_id)
    )


def get_checkpoint_by_code(
    db: Session,
    code: str,
    *,
    exclude_id: int | None = None,
) -> Checkpoint | None:
    """Busca un punto por su código global único."""
    query = select(Checkpoint).where(Checkpoint.code == code)
    if exclude_id is not None:
        query = query.where(Checkpoint.id != exclude_id)
    return db.scalar(query)


def get_checkpoint_by_uid(
    db: Session,
    uid_nfc: str,
    *,
    exclude_id: int | None = None,
) -> Checkpoint | None:
    """Busca un punto por el UID de su etiqueta NFC (ya normalizado)."""
    query = select(Checkpoint).where(Checkpoint.uid_nfc == uid_nfc)
    if exclude_id is not None:
        query = query.where(Checkpoint.id != exclude_id)
    return db.scalar(query)


def generate_checkpoint_code(
    db: Session,
    company_id: int,
    point_type: PointType,
) -> str:
    """Genera un código único para un punto nuevo.

    El formato sigue el de los datos demo (``QR-EMP1-PT01`` / ``NFC-EMP2-PT01``)
    y se incrementa hasta encontrar un hueco libre, de modo que borrar un punto
    no reutiliza códigos ya impresos.
    """
    prefix = "NFC" if point_type is PointType.NFC else "QR"
    base = f"{prefix}-EMP{company_id}-PT"

    existing = set(
        db.scalars(
            select(Checkpoint.code).where(Checkpoint.code.like(f"{base}%"))
        )
    )

    sequence = 1
    while f"{base}{sequence:02d}" in existing:
        sequence += 1
    return f"{base}{sequence:02d}"


def list_checkpoints(
    db: Session,
    *,
    page: int,
    page_size: int,
    search: str | None = None,
    company_id: int | None = None,
    is_active: bool | None = None,
    allowed_company_ids: list[int] | None = None,
) -> tuple[list[Checkpoint], int]:
    """Lista puntos paginados con filtros y alcance por rol.

    Args:
        allowed_company_ids: Si no es ``None``, restringe el resultado a esas
            empresas (supervisores y usuarios de empresa).
    """
    filters = []
    if search:
        term = f"%{search}%"
        filters.append(
            or_(
                Checkpoint.name.ilike(term),
                Checkpoint.code.ilike(term),
                Checkpoint.location_description.ilike(term),
            )
        )
    if company_id is not None:
        filters.append(Checkpoint.company_id == company_id)
    if is_active is not None:
        filters.append(Checkpoint.is_active.is_(is_active))
    if allowed_company_ids is not None:
        filters.append(Checkpoint.company_id.in_(allowed_company_ids))

    base = select(Checkpoint).where(*filters)
    total = db.scalar(select(func.count()).select_from(base.subquery())) or 0
    items = list(
        db.scalars(
            base.options(*CHECKPOINT_LOAD_OPTIONS)
            .join(Checkpoint.company)
            .order_by(Checkpoint.company_id, Checkpoint.name, Checkpoint.id)
            .offset((page - 1) * page_size)
            .limit(page_size)
        )
    )
    return items, total


def list_active_by_company(db: Session, company_id: int) -> list[Checkpoint]:
    """Devuelve los puntos activos de una empresa ordenados por nombre.

    Se usa en el módulo operativo del guardia: los checkpoints de la ronda
    son los puntos activos de la empresa, no un listado administrativo.

    La empresa se carga con la consulta: `RoundCheckpointRead.point_type` se
    deriva de `checkpoint.company`, así que sin el eager load cada punto
    dispararía una consulta extra (o devolvería `None` en un contexto sin
    sesión).
    """
    return list(
        db.scalars(
            select(Checkpoint)
            .where(
                Checkpoint.company_id == company_id,
                Checkpoint.is_active.is_(True),
            )
            .options(*CHECKPOINT_LOAD_OPTIONS)
            .order_by(Checkpoint.name.asc(), Checkpoint.id.asc())
        )
    )


def create_checkpoint(db: Session, payload: CheckpointCreate) -> Checkpoint:
    """Crea y persiste un punto de control."""
    checkpoint = Checkpoint(**payload.model_dump())
    db.add(checkpoint)
    db.commit()
    return get_checkpoint(db, checkpoint.id) or checkpoint


def update_checkpoint(
    db: Session,
    checkpoint: Checkpoint,
    payload: CheckpointUpdate,
) -> Checkpoint:
    """Actualiza únicamente los campos enviados."""
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(checkpoint, field, value)
    db.add(checkpoint)
    db.commit()
    return get_checkpoint(db, checkpoint.id) or checkpoint


def deactivate_checkpoint(db: Session, checkpoint: Checkpoint) -> Checkpoint:
    """Baja lógica: conserva el punto para el histórico y la trazabilidad."""
    checkpoint.is_active = False
    db.add(checkpoint)
    db.commit()
    return get_checkpoint(db, checkpoint.id) or checkpoint


def deactivate_opposite_point_type(
    db: Session,
    company_id: int,
    keep: PointType,
) -> int:
    """Desactiva los puntos activos que no usan la tecnología ``keep``.

    Se usa al cambiar ``point_type`` de una empresa: los puntos del tipo
    anterior dejan de formar parte de las rondas para que el guardia no vea
    pasos que ya no puede marcar. No se reactiva ningún punto automáticamente:
    el administrador decide cuáles vuelven a estar operativos.

    Returns:
        Cantidad de puntos desactivados.
    """
    query = select(Checkpoint).where(
        Checkpoint.company_id == company_id,
        Checkpoint.is_active.is_(True),
    )
    if keep is PointType.NFC:
        # Al pasar a NFC solo sobreviven los puntos con etiqueta física.
        query = query.where(Checkpoint.uid_nfc.is_(None))
    else:
        query = query.where(Checkpoint.uid_nfc.is_not(None))

    stale = list(db.scalars(query))
    for checkpoint in stale:
        checkpoint.is_active = False
    if stale:
        db.add_all(stale)
        db.commit()
    return len(stale)
