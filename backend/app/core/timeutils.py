"""Utilidades de tiempo compartidas por modelos, esquemas y endpoints.

SQLite devuelve ``datetime`` *naive* aunque la columna se haya declarado con
zona horaria; MySQL/PyMySQL sí respeta el offset. Para que la lógica de pausas,
cronómetro y expiración por inactividad funcione igual en ambos motores, todas
las fechas que llegan de la base de datos se normalizan a UTC con
:func:`ensure_utc` antes de operar con ellas.
"""

from __future__ import annotations

from datetime import datetime, timezone


def utc_now() -> datetime:
    """Devuelve la fecha/hora actual en UTC (con zona horaria)."""
    return datetime.now(timezone.utc)


def ensure_utc(value: datetime | None) -> datetime | None:
    """Normaliza una fecha a UTC, asumiendo UTC si viene sin zona horaria."""
    if value is None:
        return None
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def elapsed_seconds(
    start_time: datetime | None,
    end_time: datetime | None,
    paused_seconds: int = 0,
) -> int:
    """Calcula los segundos transcurridos entre dos fechas, sin contar pausas.

    Args:
        start_time: Inicio de la ronda (``None`` mientras no se ha iniciado).
        end_time: Momento de corte (ahora, pausa o cierre de la ronda).
        paused_seconds: Tiempo acumulado en pausa que debe descontarse.

    Returns:
        Segundos efectivos de ronda, nunca negativos.
    """
    start = ensure_utc(start_time)
    end = ensure_utc(end_time)

    if start is None or end is None:
        return 0

    total = int((end - start).total_seconds())
    return max(0, total - max(0, int(paused_seconds or 0)))
