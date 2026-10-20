"""Utilidades geográficas para validar las marcaciones por QR.

La distancia se calcula con la fórmula de Haversine sobre una esfera de radio
medio terrestre. Para distancias de pocos metros (el alcance típico de una
geovalla de checkpoint) el error frente a una fórmula geodésica es
despreciable.
"""

from __future__ import annotations

from math import asin, cos, radians, sin, sqrt

#: Radio medio de la Tierra en metros.
EARTH_RADIUS_M = 6_371_000.0


def haversine_distance_m(
    lat1: float,
    lon1: float,
    lat2: float,
    lon2: float,
) -> float:
    """Devuelve la distancia en metros entre dos coordenadas.

    Args:
        lat1, lon1: Coordenadas del primer punto (grados decimales).
        lat2, lon2: Coordenadas del segundo punto (grados decimales).

    Returns:
        Distancia en metros (siempre no negativa).
    """
    phi1, phi2 = radians(lat1), radians(lat2)
    delta_phi = radians(lat2 - lat1)
    delta_lambda = radians(lon2 - lon1)

    a = sin(delta_phi / 2) ** 2 + cos(phi1) * cos(phi2) * sin(delta_lambda / 2) ** 2
    return 2 * EARTH_RADIUS_M * asin(sqrt(min(1.0, a)))
