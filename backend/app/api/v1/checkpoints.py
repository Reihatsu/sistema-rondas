"""CRUD de Puntos de Control con alcance por rol.

Reglas:

* ``ADMIN``: ve y gestiona los puntos de cualquier empresa.
* ``SUPERVISOR``: ve y gestiona solo los puntos de sus empresas asignadas.
* ``COMPANY_USER``: solo lectura de los puntos de sus empresas asignadas.
* ``GUARD``: sin acceso a la configuración de puntos.
"""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.exc import IntegrityError

from app.api.deps import (
    DbSession,
    SupervisorOrAdminUser,
    ensure_company_access,
    require_roles,
    user_company_ids,
)
from app.crud import checkpoint as crud_checkpoint
from app.crud import company as crud_company
from app.models import Checkpoint, PointType, User, UserRole
from app.schemas.checkpoint import (
    CheckpointCreate,
    CheckpointRead,
    CheckpointUpdate,
)
from app.schemas.common import Message, Paginated

router = APIRouter(prefix="/checkpoints", tags=["Puntos de Control"])

#: ADMIN, SUPERVISOR y COMPANY_USER pueden consultar según su alcance.
CheckpointViewer = Annotated[
    User,
    Depends(
        require_roles(UserRole.ADMIN, UserRole.SUPERVISOR, UserRole.COMPANY_USER)
    ),
]


def _get_checkpoint_or_404(db: DbSession, checkpoint_id: int) -> Checkpoint:
    """Recupera un punto de control o lanza 404."""
    checkpoint = crud_checkpoint.get_checkpoint(db, checkpoint_id)
    if checkpoint is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Punto de control no encontrado",
        )
    return checkpoint


def _ensure_company_filter_access(current_user: User, company_id: int) -> None:
    """Valida que un filtro de empresa esté dentro del alcance del usuario."""
    if current_user.role is UserRole.ADMIN:
        return
    if company_id not in user_company_ids(current_user):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="No tiene acceso a la empresa indicada",
        )


@router.get(
    "",
    response_model=Paginated[CheckpointRead],
    summary="Listar puntos de control",
)
def list_checkpoints(
    db: DbSession,
    current_user: CheckpointViewer,
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    search: str | None = Query(
        None, description="Busca por nombre, código o descripción de ubicación"
    ),
    company_id: int | None = Query(None, description="Filtra por empresa"),
    is_active: bool | None = Query(None, description="Filtra por estado"),
) -> Paginated[CheckpointRead]:
    """ADMIN ve todo; SUPERVISOR y COMPANY_USER solo sus empresas."""
    if company_id is not None:
        _ensure_company_filter_access(current_user, company_id)

    allowed_company_ids = (
        None if current_user.role is UserRole.ADMIN else user_company_ids(current_user)
    )
    items, total = crud_checkpoint.list_checkpoints(
        db,
        page=page,
        page_size=page_size,
        search=search,
        company_id=company_id,
        is_active=is_active,
        allowed_company_ids=allowed_company_ids,
    )
    return Paginated[CheckpointRead](
        items=[CheckpointRead.model_validate(item) for item in items],
        total=total,
        page=page,
        page_size=page_size,
    )


@router.get(
    "/{checkpoint_id}",
    response_model=CheckpointRead,
    summary="Obtener un punto de control",
)
def get_checkpoint(
    checkpoint_id: int,
    db: DbSession,
    current_user: CheckpointViewer,
) -> CheckpointRead:
    """Devuelve un punto si está dentro del alcance del usuario."""
    checkpoint = _get_checkpoint_or_404(db, checkpoint_id)
    ensure_company_access(current_user, checkpoint.company_id)
    return CheckpointRead.model_validate(checkpoint)


@router.post(
    "",
    response_model=CheckpointRead,
    status_code=status.HTTP_201_CREATED,
    summary="Crear punto de control (ADMIN o SUPERVISOR asignado)",
)
def create_checkpoint(
    payload: CheckpointCreate,
    db: DbSession,
    current_user: SupervisorOrAdminUser,
) -> CheckpointRead:
    """Crea un punto validando empresa, tipo y unicidad.

    * En empresas ``NFC`` el ``uid_nfc`` es obligatorio y el código se genera
      automáticamente si no se envía.
    * En empresas ``QR`` cualquier ``uid_nfc`` recibido se ignora.
    """
    company = crud_company.get_company(db, payload.company_id)
    if company is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Empresa no encontrada",
        )
    ensure_company_access(current_user, company.id)

    if company.point_type is PointType.NFC and payload.uid_nfc is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                "Esta empresa usa etiquetas NFC: indique el UID de la etiqueta "
                "del punto de control."
            ),
        )

    uid_nfc = payload.uid_nfc if company.point_type is PointType.NFC else None
    code = payload.code or crud_checkpoint.generate_checkpoint_code(
        db, company.id, company.point_type
    )

    if crud_checkpoint.get_checkpoint_by_code(db, code) is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Ya existe un punto de control con ese código",
        )
    if uid_nfc is not None and crud_checkpoint.get_checkpoint_by_uid(db, uid_nfc):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Ya existe un punto de control con ese UID NFC",
        )

    payload = payload.model_copy(update={"code": code, "uid_nfc": uid_nfc})

    try:
        checkpoint = crud_checkpoint.create_checkpoint(db, payload)
    except IntegrityError:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Conflicto de unicidad al crear el punto de control",
        ) from None

    return CheckpointRead.model_validate(checkpoint)


@router.put(
    "/{checkpoint_id}",
    response_model=CheckpointRead,
    summary="Actualizar punto de control (ADMIN o SUPERVISOR asignado)",
)
def update_checkpoint(
    checkpoint_id: int,
    payload: CheckpointUpdate,
    db: DbSession,
    current_user: SupervisorOrAdminUser,
) -> CheckpointRead:
    """Actualiza un punto con las mismas validaciones de alcance que el alta."""
    checkpoint = _get_checkpoint_or_404(db, checkpoint_id)
    ensure_company_access(current_user, checkpoint.company_id)

    data = payload.model_dump(exclude_unset=True)

    # La empresa destino define la tecnología del punto. Al mover un punto de
    # empresa (o al cambiar el tipo de la empresa) se ajusta el UID NFC.
    target_company_id = data.get("company_id") or checkpoint.company_id
    target_company = crud_company.get_company(db, target_company_id)
    if target_company is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Empresa no encontrada",
        )
    ensure_company_access(current_user, target_company.id)

    updates: dict[str, object] = {}

    # El código no puede quedar vacío: si llega ``null`` se conserva el actual.
    if "code" in data and data["code"] is None:
        updates["code"] = checkpoint.code
        data.pop("code")

    if target_company.point_type is PointType.NFC:
        target_uid = data.get("uid_nfc", checkpoint.uid_nfc)
        if target_uid is None:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=(
                    "Esta empresa usa etiquetas NFC: indique el UID de la "
                    "etiqueta del punto de control."
                ),
            )
    else:
        target_uid = None

    updates["uid_nfc"] = target_uid

    if target_uid is not None and target_uid != checkpoint.uid_nfc:
        duplicate_uid = crud_checkpoint.get_checkpoint_by_uid(
            db, target_uid, exclude_id=checkpoint.id
        )
        if duplicate_uid is not None:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Ya existe un punto de control con ese UID NFC",
            )

    new_code = data.get("code")
    if new_code is not None and new_code != checkpoint.code:
        duplicate = crud_checkpoint.get_checkpoint_by_code(
            db, new_code, exclude_id=checkpoint.id
        )
        if duplicate is not None:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Ya existe un punto de control con ese código",
            )

    try:
        checkpoint = crud_checkpoint.update_checkpoint(
            db, checkpoint, payload.model_copy(update=updates)
        )
    except IntegrityError:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Conflicto de unicidad al actualizar el punto de control",
        ) from None

    return CheckpointRead.model_validate(checkpoint)


@router.delete(
    "/{checkpoint_id}",
    response_model=Message,
    summary="Dar de baja un punto de control (ADMIN o SUPERVISOR asignado)",
)
def deactivate_checkpoint(
    checkpoint_id: int,
    db: DbSession,
    current_user: SupervisorOrAdminUser,
) -> Message:
    """Aplica baja lógica (``is_active = False``) para conservar el histórico."""
    checkpoint = _get_checkpoint_or_404(db, checkpoint_id)
    ensure_company_access(current_user, checkpoint.company_id)
    crud_checkpoint.deactivate_checkpoint(db, checkpoint)
    return Message(detail="Punto de control desactivado correctamente")
