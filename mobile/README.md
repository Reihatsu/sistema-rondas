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
│       └── scan.tsx     # Escáner QR/NFC (modal)
├── components/     # ThemedText, ThemedView, RoundTimer, OfflineQueueBanner, CompanyPicker, ...
├── constants/      # Tema y espaciados
├── context/        # AuthContext (sesión JWT)
├── hooks/          # useTheme y useOfflineQueue
├── navigation/     # AppNavigator (rutas protegidas)
├── screens/        # Login, Home, Rondas, Historial y QRScanner (QR/NFC)
├── services/       # storage, location, nfc, nfcUid, offlineQueue y checkpointCache
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

## Módulo operativo del guardia (ciclo de vida + QR/NFC + GPS)

El rol `GUARD` ve en el inicio el botón destacado **Iniciar Nueva Ronda**, además
de **Mi ronda activa** (`/rondas`) y **Historial de rondas** (`/historial`).

Si el guardia tiene varias empresas activas asignadas, tanto **Inicio** como
**Mis Rondas** muestran el selector `CompanyPicker`: se elige la empresa y se ve
qué tecnología tiene configurada (`QR` o `NFC`). Mientras hay una ronda en
curso no se muestra el selector: la empresa queda fijada por la ronda abierta.

1. **Iniciar Nueva Ronda** llama a `POST /rounds/start-new?company_id=<id>`. El
   backend crea la ronda asignada al guardia y a la empresa elegida (o a la
   primera empresa activa con puntos si no se envía `company_id`), con los
   checkpoints activos de esa empresa, y la deja en `IN_PROGRESS`. La app abre
   directamente `/scan` con el modo del escáner (`pointType`) según
   `companies.point_type`. Si el guardia ya tiene una ronda en curso o pausada,
   se le ofrece continuarla en lugar de crear otra.
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
5. El botón **Escanear Checkpoint (QR)** o **Leer Etiqueta NFC** (según
   `point_type` de la empresa) abre `/scan` con el parámetro `pointType`. En modo
   QR la cámara lee el código y la app obtiene la ubicación con
   `expo-location` (`getCurrentPositionAsync`); en modo NFC la pantalla enciende
   el lector (`react-native-nfc-manager`) y espera la etiqueta. Si el escáner se
   abre sin `pointType` (enlace directo o vuelta desde otra pantalla), deduce el
   modo de la caché de checkpoints: solo usa NFC cuando ningún punto de la ronda
   es QR. No hay interruptor manual, porque cada empresa trabaja con una sola
   tecnología. El escáner muestra el cronómetro de la ronda en tiempo real,
   alimentado por `GET /rounds/active`.
6. `POST /rounds/{id}/checkin` recibe `{ qr_code | nfc_uid, latitude?,
   longitude?, timestamp? }`. El backend valida que el punto exista (por código
   o por UID), pertenezca a la empresa, no se haya marcado antes en la ronda y
   que la ronda esté operativa. Las marcaciones QR requieren coordenadas; las
   NFC pueden enviarse sin GPS y se guardan con distancia 0. La validación de
   proximidad (geovalla del punto, `geofence_radius_m`, 50 m por defecto) solo
   se aplica si `ENFORCE_CHECKPOINT_GEOFENCE=true` en el backend; está
   desactivada por defecto y la distancia se guarda igualmente en el log.
   `timestamp` es opcional y permite conservar la hora real de una marcación que
   se sincroniza más tarde. La respuesta incluye la distancia, el tiempo del
   tramo y si la ronda quedó completa.
7. Al marcar el último punto, el backend cierra la ronda como `COMPLETED`; el
   escáner y la pantalla activa felicitan al guardia y muestran el tiempo total.
8. El historial (`GET /rounds/history`) lista por defecto las rondas de las
   **últimas 24 horas** (pausadas, completadas y canceladas); el filtro **Todo**
   consulta el historial completo. Las pausadas incluyen **Continuar ronda**,
   que llama a `resume` y vuelve a `/rondas` con el cronómetro y el progreso
   restaurados.

### Marcaciones sin conexión (cola offline)

- `@react-native-community/netinfo` detecta la conectividad real. Si el guardia
  escanea sin red, o la petición falla por timeout/red, la marcación se guarda
  en una cola persistente de AsyncStorage (`src/services/offlineQueue.ts`) con
  ronda, checkpoint, QR **o** UID NFC, coordenadas (opcionales en NFC) y la hora
  real del escaneo.
- El guardia ve una tarjeta de estado en **Inicio**, **Mis Rondas** e
  **Historial**: “Faltan X puntos por sincronizar. Se sincronizarán
  automáticamente al conectarse a internet”. El contador se actualiza tras cada
  envío.
- Al recuperar la conexión (o al volver la app a primer plano) la cola se envía
  **secuencialmente**, en orden cronológico. Cada elemento se elimina solo tras
  una respuesta correcta del servidor. El JWT se adjunta igual que en cualquier
  otra petición.
- La cola está separada por `user_id`: una marcación guardada por un guardia no
  se envía con la sesión de otro usuario del mismo dispositivo.
- Los errores de red, `401`, `429` y `5xx` conservan el elemento como pendiente.
  Un rechazo de negocio (por ejemplo, fuera de la geovalla) se marca como
  fallido con su mensaje; el guardia puede **Reintentar ahora** o descartarlo.
  Un `409` de “Ya registró el punto” se considera sincronizado para evitar
  duplicados.
- `src/services/checkpointCache.ts` conserva el código, el `uid_nfc` y el
  `point_type` de los checkpoints de la ronda para asociar la lectura (QR o NFC)
  a su `checkpoint_id` aunque el escáner se abra sin señal, y para deducir el
  modo del lector cuando la ronda se restaura desde el historial.
- `POST /rounds/{id}/checkin` acepta `timestamp` opcional. El backend usa esa
  hora para el log, el cronómetro y la ventana de inactividad, de modo que un
  corte de red no cancela una ronda cuyas marcaciones ocurrieron a tiempo.

### Inactividad (20 minutos)

- Si una ronda en curso supera `ROUND_INACTIVITY_TIMEOUT_MINUTES` (20 por
  defecto) sin marcaciones, el backend la cancela automáticamente y responde
  `409` con el motivo.
- En las marcaciones que llegan desde la cola offline, la inactividad se evalúa
  contra el `timestamp` real del escaneo, no contra la hora de sincronización.
  Los elementos restantes del lote se envían con la actividad actualizada.
- La app muestra una alerta **Ronda cancelada por inactividad**, el banner en la
  pantalla activa y desactiva el escaneo. En el historial queda como `CANCELLED`
  con `cancel_reason`.
- Las rondas pausadas no caducan: pueden retomarse más tarde desde el historial.


### Permisos

- `expo-camera`, `expo-location` y `react-native-nfc-manager` se declaran en
  `app.json` mediante sus config plugins, con mensajes en español para iOS/Android
  (`nfcPermission` para la etiqueta NFC). Si cambia esos textos hay que regenerar
  el build nativo (`npx expo run:android` / `eas build`); Expo Go ya incluye
  cámara y ubicación, pero **no** `react-native-nfc-manager`: para probar NFC
  hace falta un development build o un APK.
- Si el guardia deniega la cámara o la ubicación, la pantalla explica el motivo
  y ofrece **Abrir ajustes**. Si el dispositivo no tiene NFC, el lector está
  desactivado o la etiqueta no se apoya a tiempo, el escáner muestra el motivo y
  permite reintentar (**Volver a escanear**) o salir con **Volver a la ronda**;
  cuando no hay lector NFC, el botón de lectura queda desactivado y el aviso
  sugiere solicitar un punto con QR. Los rechazos del backend también aparecen
  en esa tarjeta de error.
- En web el servicio `nfc.web.ts` informa que no hay lector NFC y sugiere usar el
  QR; el modo NFC no está disponible en el navegador.

### Build de Android en release (R8 y ML Kit)

`android.enableMinifyInReleaseBuilds=true` activa R8 con
`proguard-android-optimize.txt`. `expo-camera` decide si el escáner de códigos
está disponible con
`Class.forName("com.google.mlkit.vision.barcode.BarcodeScanning")`
(`CameraUtils.isMLKitBarcodeScannerAvailable()`), un uso por reflexión que R8 no
puede detectar: sin reglas `-keep` elimina la clase, la cámara abre pero
`onBarcodeScanned` nunca se dispara y no aparece ningún error en pantalla.

El plugin local `plugins/withMlKitKeepRules.js` (registrado en `app.json`)
añade las reglas necesarias a `android/app/proguard-rules.pro` en cada
`npx expo prebuild`, así que no hay que editar `android/` a mano. Si el
problema reaparece en un APK release, comprobar que
`android/app/build/outputs/mapping/release/mapping.txt` no contenga
`com.google.mlkit.vision.barcode.BarcodeScanning -> R8$$REMOVED$$CLASS$$`.

### Probar el flujo

- Cuenta demo: `guardia1@demo.com` / `guardia123` (el seed incluye una ronda
  `IN_PROGRESS`).
- El QR debe contener el **código** del punto (por ejemplo `QR-EMP1-PT01`), el
  mismo valor que muestra la pantalla de checkpoints.
- Para NFC, configure la empresa con `point_type = "NFC"` y registre en cada
  punto el UID de la etiqueta (`uid_nfc`, hexadecimal en mayúsculas sin
  separadores; el backend acepta el UID con o sin `:`). Acercar la etiqueta al
  dispositivo equivale a escanear el QR, sin necesidad de GPS.
- Si el guardia tiene varias empresas, el selector de **Inicio** decide la
  empresa y, con ella, el modo del escáner. Sin empresas activas asignadas, el
  botón **Iniciar Nueva Ronda** queda deshabilitado con un aviso para contactar
  al administrador.
- Los puntos demo están geolocalizados en Madrid (`40.415462, -3.709687`, etc.).
  La marcación **no** exige cercanía al punto: `ENFORCE_CHECKPOINT_GEOFENCE`
  está desactivado por defecto. Para volver a exigir la geovalla, arranque el
  backend con `ENFORCE_CHECKPOINT_GEOFENCE=true` (y ajuste
  `geofence_radius_m`, máx. 1000 m, si desea otro radio).
- La validación GPS requiere un dispositivo o un emulador con ubicación
  simulada. La vista web puede abrir la cámara, pero el permiso y la posición
  dependen del navegador (y de HTTPS o `localhost`); el NFC no funciona en web.

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
