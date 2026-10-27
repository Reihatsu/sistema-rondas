"""Esquemas de Rondas y checkpoints."""

from __future__ import annotations

from datetime import datetime

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    field_serializer,
    field_validator,
    model_validator,
)

from app.core.timeutils import ensure_utc
from app.models.enums import (
    PointType,
    RoundCheckpointStatus,
    RoundLogStatus,
    RoundStatus,
)
from app.schemas.checkpoint import normalize_uid
from app.schemas.company import CompanySummary
from app.schemas.user import UserSummary


class RoundLogRead(BaseModel):
    """Lectura de un checkpoint NFC/QR."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    round_id: int
    checkpoint_id: int | None = None
    nfc_tag_id: str
    checkpoint_name: str
    latitude: float | None = None
    longitude: float | None = None
    distance_m: float | None = None
    elapsed_seconds: int | None = None
    timestamp: datetime
    status: RoundLogStatus

    @field_serializer("timestamp")
    def serialize_timestamp(self, value: datetime) -> datetime:
        """Envía la marca de tiempo con offset UTC explícito al cliente."""
        return ensure_utc(value) or value


class RoundRead(BaseModel):
    """Datos de una ronda para el panel de informes."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    company_id: int
    guard_id: int
    status: RoundStatus
    start_time: datetime | None
    end_time: datetime | None
    paused_at: datetime | None = None
    paused_seconds: int = 0
    last_activity_at: datetime | None = None
    cancel_reason: str | None = None
    observations: str | None
    created_at: datetime
    #: Cronómetro efectivo (sin pausas) calculado por el backend.
    elapsed_seconds: int = 0
    #: Límite de inactividad; ``None`` si la ronda no está en curso.
    inactivity_deadline: datetime | None = None
    company: CompanySummary | None = None
    guard: UserSummary | None = None

    @field_serializer(
        "start_time",
        "end_time",
        "paused_at",
        "last_activity_at",
        "inactivity_deadline",
        "created_at",
    )
    def serialize_datetimes(self, value: datetime | None) -> datetime | None:
        """Normaliza a UTC las fechas (SQLite las devuelve sin zona horaria)."""
        return ensure_utc(value)


class RoundDetail(RoundRead):
    """Ronda con el detalle de sus checkpoints."""

    logs: list[RoundLogRead] = Field(default_factory=list)


class RoundCommentCreate(BaseModel):
    """Payload para añadir una nota operativa a una ronda."""

    model_config = ConfigDict(str_strip_whitespace=True)

    comment: str = Field(min_length=2, max_length=1000)


class RoundPauseCreate(BaseModel):
    """Payload para pausar una ronda (el motivo es obligatorio)."""

    model_config = ConfigDict(str_strip_whitespace=True)

    comment: str = Field(
        min_length=2,
        max_length=1000,
        examples=["Pausado por emergencia en el sector B"],
        description="Motivo obligatorio de la pausa; se guarda en el historial.",
    )


class RoundCancelCreate(BaseModel):
    """Payload para cancelar una ronda (el motivo es obligatorio)."""

    model_config = ConfigDict(str_strip_whitespace=True)

    reason: str = Field(
        min_length=2,
        max_length=1000,
        examples=["Se aborta la ronda por una evacuación del edificio"],
        description="Motivo obligatorio de la cancelación.",
    )


class RoundCheckpointRead(BaseModel):
    """Punto de control de la ronda con su estado de visita."""

    id: int
    name: str
    code: str
    #: UID de la etiqueta NFC del punto (``None`` en puntos QR). Permite a la
    #: app móvil validar la etiqueta leída y marcar el punto sin conexión.
    uid_nfc: str | None = None
    #: Tecnología del punto; la app móvil decide entre el lector QR y el NFC.
    point_type: PointType | None = None
    location_description: str | None = None
    latitude: float | None = None
    longitude: float | None = None
    geofence_radius_m: int = 50
    status: RoundCheckpointStatus = RoundCheckpointStatus.PENDING
    is_visited: bool = False
    visited_at: datetime | None = None
    #: Segundos acumulados de ronda al visitar el punto (sin pausas).
    elapsed_seconds: int | None = None
    #: Segundos transcurridos desde la marcación anterior de la ronda.
    segment_seconds: int | None = None

    @field_serializer("visited_at")
    def serialize_visited_at(self, value: datetime | None) -> datetime | None:
        """Envía la fecha de visita con offset UTC explícito."""
        return ensure_utc(value)


class RoundCheckInCreate(BaseModel):
    """Payload de la marcación de un checkpoint por QR o NFC.

    Debe enviarse al menos uno de ``qr_code``, ``nfc_code`` o ``nfc_uid``:

    * ``qr_code``: contenido leído del código impreso. Exige coordenadas GPS
      porque la geovalla del punto se valida con ellas.
    * ``nfc_code``: texto NDEF grabado en la etiqueta. Es el código único del
      punto (``NFC-EMP2-PT03``) y el identificador principal de la marcación
      NFC. Las coordenadas son opcionales: si no se envían, la marcación se
      registra con distancia 0.
    * ``nfc_uid``: UID físico leído de la etiqueta. Junto a ``nfc_code`` actúa
      como validación secundaria: si el punto tiene un UID registrado, ambos
      deben coincidir. Se mantiene también como identificador único para
      clientes antiguos que aún no envían el texto NDEF.
    """

    model_config = ConfigDict(str_strip_whitespace=True)

    qr_code: str | None = Field(
        default=None,
        min_length=2,
        max_length=100,
        examples=["QR-EMP1-PT01"],
        description="Contenido leído del código QR (código único del punto).",
    )
    nfc_code: str | None = Field(
        default=None,
        min_length=2,
        max_length=100,
        examples=["NFC-EMP2-PT03"],
        description=(
            "Texto NDEF leído de la etiqueta NFC (código único del punto). "
            "Conserva los guiones del código."
        ),
    )
    nfc_uid: str | None = Field(
        default=None,
        min_length=4,
        max_length=100,
        examples=["0491D8A2064F80"],
        description="UID físico de la etiqueta NFC leída por el dispositivo.",
    )
    latitude: float | None = Field(
        default=None,
        ge=-90,
        le=90,
        description="Latitud capturada por el dispositivo (obligatoria por QR).",
    )
    longitude: float | None = Field(
        default=None,
        ge=-180,
        le=180,
        description="Longitud capturada por el dispositivo (obligatoria por QR).",
    )
    timestamp: datetime | None = Field(
        default=None,
        description=(
            "Instante real del escaneo en el dispositivo (ISO 8601). Se usa "
            "para marcaciones guardadas sin conexión; si se omite, se toma la "
            "hora del servidor."
        ),
    )

    @field_validator("qr_code")
    @classmethod
    def normalize_qr_code(cls, value: str | None) -> str | None:
        """Normaliza el código para que el escaneo no dependa de mayúsculas."""
        if value is None:
            return None
        return value.strip().upper() or None

    @field_validator("nfc_code")
    @classmethod
    def normalize_nfc_code(cls, value: str | None) -> str | None:
        """Canoniza el texto NDEF sin perder los guiones del código.

        No se usa ``normalize_uid``: ese helper elimina todo lo que no sea
        alfanumérico y convertiría ``NFC-EMP2-PT03`` en ``NFCEMP2PT03``.
        """
        if value is None:
            return None
        return value.strip().upper() or None

    @field_validator("nfc_uid")
    @classmethod
    def normalize_nfc_uid(cls, value: str | None) -> str | None:
        """Canoniza el UID NFC para aceptar formatos con o sin separadores."""
        return normalize_uid(value)

    @field_validator("timestamp")
    @classmethod
    def normalize_timestamp(cls, value: datetime | None) -> datetime | None:
        """Normaliza la hora enviada por el cliente a UTC."""
        return ensure_utc(value)

    @model_validator(mode="after")
    def validate_marking(self) -> "RoundCheckInCreate":
        """Valida el identificador y las coordenadas según la tecnología."""
        if self.qr_code is None and self.nfc_code is None and self.nfc_uid is None:
            raise ValueError("Debe indicar qr_code, nfc_code o nfc_uid")
        if (self.latitude is None) != (self.longitude is None):
            raise ValueError("Debe indicar latitud y longitud juntas")
        if self.qr_code is not None and self.latitude is None:
            raise ValueError("Las marcaciones por QR requieren latitud y longitud")
        return self


class RoundCheckInRead(BaseModel):
    """Resultado de una marcación validada por el servidor."""

    message: str
    distance_m: float
    checkpoint: RoundCheckpointRead
    log: RoundLogRead
    #: Estado de la ronda tras la marcación (puede pasar a COMPLETED).
    round_status: RoundStatus = RoundStatus.IN_PROGRESS
    #: ``True`` cuando esta marcación completó todos los puntos de la ronda.
    round_completed: bool = False
    #: Puntos de control de la empresa que aún quedan pendientes.
    remaining_checkpoints: int = 0
    #: Tiempo total efectivo de la ronda al cerrar la marcación.
    round_elapsed_seconds: int = 0


class RoundStatusCount(BaseModel):
    """Conteo de rondas por estado."""

    status: RoundStatus
    count: int


class RoundSummary(BaseModel):
    """Resumen agregado para el panel de informes."""

    total: int
    by_status: list[RoundStatusCount]
