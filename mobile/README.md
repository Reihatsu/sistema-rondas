# Sistema de Rondas — Cliente móvil

Aplicación móvil (Expo / React Native + Expo Router) para el registro de rondas
de vigilancia NFC, conectada al backend FastAPI del proyecto.

## Requisitos

- Node.js 20+
- Backend FastAPI en ejecución (`../backend`)
- App Expo Go o un development build para probar en el dispositivo

## Configuración

1. Instalar dependencias

   ```bash
   npm install
   ```

2. Configurar la URL de la API

   Copie `.env.example` a `.env` y ajuste `EXPO_PUBLIC_API_URL`. El valor debe
   incluir el prefijo `/api/v1`:

   ```bash
   # Emulador Android
   EXPO_PUBLIC_API_URL=http://10.0.2.2:8000/api/v1

   # Dispositivo físico (misma red Wi-Fi)
   EXPO_PUBLIC_API_URL=http://192.168.1.100:8000/api/v1

   # Producción
   EXPO_PUBLIC_API_URL=https://sistema-rondas.onrender.com/api/v1
   ```

   Sin esta variable se usa `http://localhost:8000/api/v1`.

3. Iniciar la app

   ```bash
   npx expo start
   ```

## Estructura del proyecto

```
src/
├── api/            # Capa HTTP tipada (Axios)
│   ├── client.ts   # Instancia compartida, interceptor JWT y manejo de errores
│   ├── types.ts    # Tipos alineados con los esquemas Pydantic del backend
│   ├── auth.ts     # POST /auth/login, GET /auth/me
│   ├── checkpoints.ts
│   └── rounds.ts   # Rondas, ciclo de vida, historial y check-in
├── app/            # Rutas de Expo Router (solo archivos de ruta)
│   ├── _layout.tsx # Providers: AuthProvider + ThemeProvider + AppNavigator
│   ├── login.tsx   # Ruta pública /login
│   └── (app)/      # Grupo protegido (requiere JWT)
│       ├── _layout.tsx
│       ├── index.tsx    # Inicio
│       ├── rondas.tsx   # Ronda activa: cronómetro, acciones y checkpoints
│       ├── historial.tsx # Rondas pasadas y pausadas
│       └── scan.tsx     # Escáner QR (modal)
├── components/     # ThemedText, ThemedView, RoundTimer, CommentPromptModal, ...
├── constants/      # Tema y espaciados
├── context/        # AuthContext (sesión JWT)
├── hooks/          # useTheme
├── navigation/     # AppNavigator (rutas protegidas)
├── screens/        # Login, Home, Rondas, Historial y QRScanner
├── services/       # storage.ts (sesión) y location.ts (GPS)
└── utils/          # datetime.ts (cronómetro y fechas)
```

## Autenticación

- `POST /api/v1/auth/login` recibe **JSON** (`{ email, password }`) y devuelve
  `access_token` + `user`.
- El token y el usuario se guardan en AsyncStorage (`src/services/storage.ts`)
  y se restauran al arrancar la app.
- `client.ts` adjunta `Authorization: Bearer <token>` a cada petición y, ante un
  `401` (fuera del propio login), cierra la sesión local.
- `AppNavigator` usa `Stack.Protected` de Expo Router: con token se muestra el
  grupo `(app)`, sin token se muestra `/login`. Al iniciar o cerrar sesión la
  redirección es automática, sin navegación imperativa.

> La sesión se guarda en AsyncStorage, que no está cifrado. Si se requiere
> almacenamiento seguro, migrar `src/services/storage.ts` a `expo-secure-store`
> es el único cambio necesario.

## Módulo operativo del guardia (ciclo de vida + QR + GPS)

El rol `GUARD` ve en el inicio el botón destacado **Iniciar Nueva Ronda**, además
de **Mi ronda activa** (`/rondas`) y **Historial de rondas** (`/historial`).

1. **Iniciar Nueva Ronda** llama a `POST /rounds/start-new`. El backend crea la
   ronda asignada al guardia y a su empresa activa, con los checkpoints activos
   de esa empresa, y la deja en `IN_PROGRESS`. La app abre directamente `/scan`
   para comenzar el recorrido. Si el guardia ya tiene una ronda en curso o
   pausada, se le ofrece continuarla en lugar de crear otra.
   `GET /rounds/active` sigue disponible para restaurar la ronda abierta al
   entrar en `/rondas`.
2. La pantalla activa muestra un cronómetro en tiempo real: parte del
   `elapsed_seconds` del backend y avanza cada segundo en local. Se detiene al
   pausar y se restaura desde el segundo guardado al reanudar.
3. `GET /rounds/{id}/checkpoints` lista los puntos con estado
   `PENDING`/`COMPLETED`, el tiempo acumulado (`elapsed_seconds`) y el tiempo del
   tramo (`segment_seconds`).
4. **Pausar** (`POST /rounds/{id}/pause`) exige un motivo obligatorio y lo guarda
   firmado en las observaciones. **Reanudar** (`POST /rounds/{id}/resume`)
   descuenta el tiempo en pausa y recarga los puntos ya leídos. **Cancelar**
   (`POST /rounds/{id}/cancel`) exige un motivo. **Comentario** usa
   `POST /rounds/{id}/comments`.
5. El botón **Escanear Checkpoint (QR)** abre `/scan`. La cámara lee el QR y la
   app obtiene la ubicación con `expo-location` (`getCurrentPositionAsync`). El
   escáner muestra el cronómetro de la ronda en tiempo real, alimentado por
   `GET /rounds/active`.
6. `POST /rounds/{id}/checkin` recibe `{ qr_code, latitude, longitude }`. El
   backend valida que el código exista, pertenezca a la empresa, esté dentro de
   la geovalla del punto (`geofence_radius_m`, 50 m por defecto), no se haya
   marcado antes en la ronda y que la ronda esté operativa. La respuesta incluye
   la distancia, el tiempo del tramo y si la ronda quedó completa.
7. Al marcar el último punto, el backend cierra la ronda como `COMPLETED`; el
   escáner y la pantalla activa felicitan al guardia y muestran el tiempo total.
8. El historial (`GET /rounds/history`) lista por defecto las rondas de las
   **últimas 24 horas** (pausadas, completadas y canceladas); el filtro **Todo**
   consulta el historial completo. Las pausadas incluyen **Continuar ronda**,
   que llama a `resume` y vuelve a `/rondas` con el cronómetro y el progreso
   restaurados.

### Inactividad (20 minutos)

- Si una ronda en curso supera `ROUND_INACTIVITY_TIMEOUT_MINUTES` (20 por
  defecto) sin marcaciones, el backend la cancela automáticamente y responde
  `409` con el motivo.
- La app muestra una alerta **Ronda cancelada por inactividad**, el banner en la
  pantalla activa y desactiva el escaneo. En el historial queda como `CANCELLED`
  con `cancel_reason`.
- Las rondas pausadas no caducan: pueden retomarse más tarde desde el historial.


### Permisos

- `expo-camera` y `expo-location` se declaran en `app.json` mediante sus config
  plugins, con mensajes en español para iOS/Android. Si cambia esos textos hay
  que regenerar el build nativo (`npx expo run:android` / `eas build`); Expo Go
  ya incluye ambos módulos.
- Si el guardia deniega la cámara o la ubicación, la pantalla explica el motivo
  y ofrece **Abrir ajustes**. Los errores de red o del backend se muestran en
  una tarjeta con **Reintentar** y **Volver a la ronda**.

### Probar el flujo

- Cuenta demo: `guardia1@demo.com` / `guardia123` (el seed incluye una ronda
  `IN_PROGRESS`).
- El QR debe contener el **código** del punto (por ejemplo `QR-EMP1-PT01`), el
  mismo valor que muestra la pantalla de checkpoints.
- Los puntos demo están geolocalizados en Madrid (`40.415462, -3.709687`, etc.).
  Para probar desde otro lugar, actualice `latitude`/`longitude` del checkpoint
  (`PUT /checkpoints/{id}`) o aumente `geofence_radius_m` (máx. 1000 m).
- La validación GPS requiere un dispositivo o un emulador con ubicación
  simulada. La vista web puede abrir la cámara, pero el permiso y la posición
  dependen del navegador (y de HTTPS o `localhost`).

## Scripts

```bash
npx expo start        # Servidor de desarrollo
npx tsc --noEmit      # Verificación de tipos
npx expo export --platform web  # Compilación del bundle web
npx expo lint         # Lint (requiere configurar ESLint la primera vez)
npx expo-doctor       # Diagnóstico de dependencias y configuración
```

## Recursos

- [Documentación de Expo](https://docs.expo.dev/)
- [Expo Router](https://docs.expo.dev/router/introduction)
- [Variables de entorno en Expo](https://docs.expo.dev/guides/environment-variables/)
