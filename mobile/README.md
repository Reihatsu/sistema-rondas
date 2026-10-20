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
│   └── rounds.ts   # Rondas, ronda activa, checkpoints y check-in
├── app/            # Rutas de Expo Router (solo archivos de ruta)
│   ├── _layout.tsx # Providers: AuthProvider + ThemeProvider + AppNavigator
│   ├── login.tsx   # Ruta pública /login
│   └── (app)/      # Grupo protegido (requiere JWT)
│       ├── _layout.tsx
│       ├── index.tsx    # Inicio
│       ├── rondas.tsx   # Checkpoints de la ronda activa
│       └── scan.tsx     # Escáner QR (modal)
├── components/     # Componentes reutilizables (ThemedText, ThemedView, ...)
├── constants/      # Tema y espaciados
├── context/        # AuthContext (sesión JWT)
├── hooks/          # useTheme
├── navigation/     # AppNavigator (rutas protegidas)
├── screens/        # Login, Home, Rondas y QRScanner
└── services/       # storage.ts (sesión) y location.ts (GPS)
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

## Módulo operativo del guardia (QR + GPS)

El rol `GUARD` ve en el inicio el acceso **Mis checkpoints**, que abre `/rondas`:

1. `GET /rounds/active` devuelve la ronda en curso (o pausada) del guardia. Si
   no hay ninguna, la pantalla lista las rondas `PENDING` y permite iniciarlas
   con `POST /rounds/{id}/start`.
2. `GET /rounds/{id}/checkpoints` lista los puntos activos de la empresa con su
   estado (`Pendiente` / `Visitado`).
3. El botón **Escanear Checkpoint (QR)** abre `/scan`. La cámara lee el QR y la
   app obtiene la ubicación con `expo-location` (`getCurrentPositionAsync`).
4. `POST /rounds/{id}/checkin` recibe `{ qr_code, latitude, longitude }`. El
   backend valida que el código exista, pertenezca a la empresa, esté dentro de
   la geovalla del punto (`geofence_radius_m`, 50 m por defecto), no se haya
   marcado antes en la ronda y que la ronda esté operativa. La respuesta incluye
   la distancia calculada y el registro creado.
5. Al volver de `/scan`, `RondasScreen` se recarga (`useFocusEffect`) y el punto
   aparece como visitado.

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
