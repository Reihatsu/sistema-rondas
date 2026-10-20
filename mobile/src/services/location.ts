/**
 * Ubicación del dispositivo para validar la geovalla de un checkpoint.
 *
 * Centraliza los permisos y traduce los fallos técnicos a mensajes en español
 * que la pantalla de escaneo puede mostrar directamente al guardia.
 */

import * as Location from 'expo-location';

export type LocationErrorCode = 'permission' | 'services' | 'unavailable';

/** Error de geolocalización con una causa identificable por la UI. */
export class LocationError extends Error {
  readonly code: LocationErrorCode;

  constructor(code: LocationErrorCode, message: string) {
    super(message);
    this.name = 'LocationError';
    this.code = code;
  }
}

export interface CurrentCoordinates {
  latitude: number;
  longitude: number;
  /** Precisión estimada en metros (`null` si el dispositivo no la informa). */
  accuracy: number | null;
}

/**
 * Pide permiso (si hace falta) y devuelve la posición actual con alta precisión.
 *
 * @throws {LocationError} Si el permiso se deniega, los servicios están
 * desactivados o el dispositivo no logra fijar la posición.
 */
export async function getCurrentCoordinates(): Promise<CurrentCoordinates> {
  const permission = await Location.requestForegroundPermissionsAsync();

  if (!permission.granted) {
    throw new LocationError(
      'permission',
      'Para validar el checkpoint necesitamos acceder a su ubicación. ' +
        'Puede habilitarlo en los ajustes del dispositivo.',
    );
  }

  const servicesEnabled = await Location.hasServicesEnabledAsync();

  if (!servicesEnabled) {
    throw new LocationError(
      'services',
      'La ubicación del dispositivo está desactivada. Actívela e inténtelo de nuevo.',
    );
  }

  try {
    const position = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.High,
    });

    return {
      latitude: position.coords.latitude,
      longitude: position.coords.longitude,
      accuracy: position.coords.accuracy ?? null,
    };
  } catch {
    throw new LocationError(
      'unavailable',
      'No se pudo obtener su ubicación. Salga a un espacio abierto y vuelva a intentarlo.',
    );
  }
}
