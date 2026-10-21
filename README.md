# Sistema de Rondas

Monorepo de un sistema de control de rondas de vigilancia con checkpoints NFC.

- **Backend**: FastAPI + SQLAlchemy 2 + MySQL (PyMySQL) / SQLite (fallback) + JWT (OAuth2 password flow).
- **Frontend**: React 18 + Vite + Tailwind CSS + Lucide React + React Router + Axios.
- **Móvil**: Expo / React Native + Expo Router (`mobile/`), con escaneo QR y validación GPS de checkpoints.
- **Base de datos**: MySQL local o SQLite para despliegues gratuitos (Render); scripts SQL en `database/` y migraciones Alembic en `backend/alembic/`.

```
sistema-rondas/
├── backend/
│   ├── app/
│   │   ├── api/v1/        # auth, companies, users, checkpoints, rounds
│   │   ├── core/          # configuración y seguridad (JWT/bcrypt)
│   │   ├── crud/          # acceso a datos
│   │   ├── models/        # modelos SQLAlchemy
│   │   ├── schemas/       # esquemas Pydantic
│   │   ├── db/            # sesión, init_db, seed del admin
│   │   └── main.py
│   ├── alembic/           # migraciones (0001_initial_schema, 0002_checkpoints, 0003_checkin_gps, 0004_round_lifecycle)
│   ├── init_db.py         # crea tablas + datos demo (contraseñas bcrypt)
│   ├── main.py            # entrypoint uvicorn
│   └── requirements.txt
├── database/
│   ├── schema.sql         # DDL MySQL equivalente a la migración
│   └── seed.sql           # datos de demostración
├── mobile/
│   ├── src/
│   │   ├── api/           # Axios + JWT + endpoints tipados
│   │   ├── app/           # Rutas de Expo Router ((app)/rondas, (app)/scan, (app)/historial)
│   │   ├── screens/       # Login, Home, Rondas, Historial y QRScanner
│   │   └── services/      # Sesión, GPS, caché de checkpoints y cola offline
│   └── app.json           # Plugins de cámara y ubicación
└── frontend/
    ├── src/
    │   ├── layouts/OdooLayout.jsx   # sidebar + topbar responsive
    │   ├── pages/                   # Login, Companies, Users, Checkpoints, SupervisorView, CompanyRounds
    │   ├── services/api.js          # Axios + JWT + APIs
    │   ├── auth/AuthContext.jsx
    │   ├── components/              # UI compartida y ProtectedRoute
    │   └── utils/format.js
    ├── tailwind.config.js
    └── vite.config.js               # proxy /api -> http://127.0.0.1:8000
```

## Requisitos

- Python 3.11+
- Node.js 18+
- MySQL 8 (o MariaDB 10.6+) **o** SQLite (incluido en Python, sin instalación)

## 1. Base de datos

El backend elige el motor automáticamente:

| Condición | Motor usado |
| --- | --- |
| `DATABASE_URL` definida | La URL indicada (máxima prioridad) |
| `USE_SQLITE=true` | SQLite (`backend/sistema_rondas.db`) |
| Alguna variable `DB_HOST`/`DB_PORT`/`DB_USER`/`DB_PASSWORD`/`DB_NAME` | MySQL con PyMySQL |
| Ninguna de las anteriores | SQLite como *fallback* (`backend/sistema_rondas.db`) |

Al arrancar, la API crea las tablas (`create_all`) y, si la base de datos está
vacía, siembra empresa, usuarios, puntos de control y rondas demo
(`AUTO_SEED_DEMO=true`). Por eso en Render solo hace falta desplegar: no hay
que ejecutar SQL ni migraciones manualmente.

### Opción A — scripts SQL (MySQL, crea esquema y datos demo):

```bash
mysql -u root -p < database/schema.sql
mysql -u root -p sistema_rondas_db < database/seed.sql
```

Opción B — Alembic (solo esquema; el backend crea el admin inicial al arrancar):

```bash
cd backend
venv\Scripts\activate
alembic upgrade head
```

Opción C — script Python (crea esquema y carga los datos demo):

```bash
cd backend
venv\Scripts\activate
python init_db.py
```

Es idempotente (puede ejecutarse varias veces), crea la base de datos y las
tablas vía SQLAlchemy y guarda las contraseñas con **bcrypt**. Use
`python init_db.py --skip-create-db` si la base ya existe o el usuario MySQL no
tiene permiso `CREATE DATABASE`. El mismo comando funciona con SQLite:
`$env:USE_SQLITE="true"; python init_db.py` (PowerShell).

## 2. Backend

```bash
cd backend
python -m venv venv
venv\Scripts\activate
pip install -r requirements.txt
copy .env.example .env   # ajustar credenciales MySQL y SECRET_KEY
python main.py           # http://127.0.0.1:8000
```

Documentación interactiva: `http://127.0.0.1:8000/docs`.

Variables relevantes de `.env`:

| Variable | Descripción |
| --- | --- |
| `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME` | Conexión MySQL (si se define alguna, se usa MySQL) |
| `USE_SQLITE` | `true` fuerza SQLite aunque haya variables MySQL |
| `SQLITE_DB_PATH` | Ruta del archivo SQLite (por defecto `backend/sistema_rondas.db`) |
| `DATABASE_URL` | Sobrescribe la conexión (p. ej. SQLite en pruebas) |
| `SECRET_KEY`, `ALGORITHM`, `ACCESS_TOKEN_EXPIRE_MINUTES` | Firma del JWT |
| `BACKEND_CORS_ORIGINS` | Orígenes permitidos (Vite en 5173) |
| `INIT_DB_ON_STARTUP`, `AUTO_SEED_ADMIN` | Bootstrap de tablas y admin |
| `AUTO_SEED_DEMO` | Siembra datos demo cuando la base de datos está vacía |
| `ROUND_INACTIVITY_TIMEOUT_MINUTES` | Minutos sin marcaciones antes de cancelar la ronda (20 por defecto) |
| `DEFAULT_GEOFENCE_RADIUS_M` | Radio por defecto de la geovalla de un checkpoint (50 m) |
| `ENFORCE_CHECKPOINT_GEOFENCE` | `true` exige estar dentro del radio del checkpoint para marcar; `false` (por defecto) acepta la marcación y solo registra la distancia |

### Despliegue en Render (SQLite, plan gratuito)

Puede crear el servicio manualmente o usar el blueprint `render.yaml` incluido
en la raíz del repositorio (**New → Blueprint**). Pasos manuales:

1. Cree un **Web Service** apuntando al repositorio.
2. **Root Directory**: `backend`.
3. **Build Command**: `pip install -r requirements.txt`.
4. **Start Command**: `uvicorn app.main:app --host 0.0.0.0 --port $PORT`.
5. Variables de entorno mínimas:
   - `SECRET_KEY` (obligatoria en producción).
   - `BACKEND_CORS_ORIGINS` con la URL del frontend (p. ej.
     `https://mi-frontend.onrender.com`).
   - **No** defina `DB_*`: al no detectarlas, el backend usa SQLite
     (`backend/sistema_rondas.db`), crea las tablas y siembra los datos demo.
6. Opcional: monte un **Persistent Disk** y defina `SQLITE_DB_PATH` hacia ese
   disco para conservar los datos entre despliegues (el disco efímero del plan
   gratuito se reinicia al redeploy).

`/health` devuelve `database_backend` (`mysql` o `sqlite`) para verificar qué
motor está activo. La API también escucha en `0.0.0.0:$PORT` si se arranca con
`python main.py` en Render.

> **Seguridad:** las cuentas demo (`admin@demo.com` / `admin123`, etc.) son
> públicas y existen solo para pruebas. En un entorno real defina
> `AUTO_SEED_DEMO=false` y configure `FIRST_ADMIN_EMAIL` /
> `FIRST_ADMIN_PASSWORD` con credenciales propias **antes** del primer arranque.

## 3. Frontend

```bash
cd frontend
npm install
npm run dev      # http://localhost:5173
npm run build    # bundle de producción en dist/
```

La URL base de Axios se toma de `VITE_API_BASE_URL`, que debe ser **absoluta** e
incluir `/api/v1` (por ejemplo `https://mi-api.onrender.com/api/v1`). Si no está
definida se usa `http://localhost:8000/api/v1`; el backend ya permite CORS desde
el frontend local (`http://localhost:5173`).

En **Vercel**, configure `VITE_API_BASE_URL` en *Project Settings → Environment
Variables* y vuelva a desplegar: Vite incrusta la variable en el bundle durante
el build. Las rutas relativas se ignoran para que Axios nunca envíe las
peticiones al dominio del frontend.

La interfaz sigue un esquema visual inspirado en Odoo ERP (paleta púrpura,
tablas densas, barra de filtros y badges de estado) y es responsive. Las rutas
se protegen por rol:

| Ruta | Roles | Contenido |
| --- | --- | --- |
| `/empresas` | `ADMIN` | Listado, filtros y CRUD de empresas |
| `/usuarios` | `ADMIN` | Usuarios, roles, empresas y asignación supervisor → guardias |
| `/guardias` | `SUPERVISOR` | Guardias asignados, agrupados por empresa |
| `/puntos-control` | `ADMIN`, `SUPERVISOR`, `COMPANY_USER` | Puntos QR/NFC: CRUD para ADMIN/SUPERVISOR y consulta/QR para COMPANY_USER |
| `/rondas` | Todos | Rondas con filtros, badges, checkpoints NFC y comentarios |

El botón **Agregar comentario** usa `POST /api/v1/rounds/{id}/comments`; el
comentario se anexa a las observaciones con autor y fecha/hora.

En **Puntos de Control**, el código es único en todo el sistema (se usa como
contenido del QR/NFC). El botón de QR permite verlo, descargarlo como PNG o
imprimirlo; la baja es lógica (`is_active = false`) para conservar el histórico.

## 4. Cuentas de demostración

### `backend/init_db.py`

| Rol | Email | Contraseña |
| --- | --- | --- |
| Administrador | `admin@demo.com` | `admin123` |
| Supervisor | `supervisor@demo.com` | `super123` |
| Guardia | `guardia1@demo.com` | `guardia123` |
| Guardia | `guardia2@demo.com` | `guardia123` |
| Cliente (empresa) | `cliente@demo.com` | `cliente123` |

### `database/seed.sql`

| Rol | Email | Contraseña |
| --- | --- | --- |
| Administrador | `admin@sistema-rondas.local` | `Admin123!` |
| Supervisor | `supervisor@rondas.local` | `Supervisor123!` |
| Guardia | `guardia@rondas.local` | `Guardia123!` |
| Guardia | `guardia2@rondas.local` | `Guardia123!` |
| Cliente (empresa) | `cliente@rondas.local` | `Cliente123!` |

## 5. Alcance por rol

| Rol | Acceso |
| --- | --- |
| `ADMIN` | Todo: empresas, usuarios, asignaciones, puntos de control y todas las rondas |
| `SUPERVISOR` | Sus guardias, puntos de control (lectura/escritura) y rondas de sus empresas asignadas |
| `GUARD` | Sus propias rondas, checkpoints de la ronda y marcación QR con validación GPS |
| `COMPANY_USER` | Rondas y puntos de control (solo lectura) de las empresas que tiene asignadas |

Las reglas se aplican en el backend (`app/api/v1/rounds.py`, `users.py`,
`companies.py`, `checkpoints.py`); la interfaz oculta las acciones no permitidas.

## 6. Endpoints principales

- `POST /api/v1/auth/login`, `GET /api/v1/auth/me`
- `GET|POST /api/v1/companies`, `GET|PUT|DELETE /api/v1/companies/{id}`
- `GET|POST /api/v1/users`, `GET|PUT|DELETE /api/v1/users/{id}`
- `GET|PUT /api/v1/users/{id}/companies`
- `GET|POST|DELETE /api/v1/users/{supervisor_id}/guards[/{guard_id}]`
- `GET|POST /api/v1/checkpoints`, `GET|PUT|DELETE /api/v1/checkpoints/{id}`
- `GET /api/v1/rounds`, `GET /api/v1/rounds/summary`, `GET /api/v1/rounds/history`
  (últimas 24 h por defecto; `last_hours` y `all_time` ajustan la ventana),
  `GET /api/v1/rounds/{id}`, `GET /api/v1/rounds/{id}/logs`,
  `POST /api/v1/rounds/{id}/comments`
- `GET /api/v1/rounds/active` (solo `GUARD`),
  `POST /api/v1/rounds/start-new` (solo `GUARD`: crea e inicia la ronda con los
  checkpoints activos de su empresa), `GET /api/v1/rounds/{id}/checkpoints`,
  `POST /api/v1/rounds/{id}/checkin` (acepta `timestamp` opcional para
  marcaciones offline), `POST /api/v1/rounds/{id}/start`
- `POST /api/v1/rounds/{id}/pause` (`{comment}` obligatorio),
  `POST /api/v1/rounds/{id}/resume`, `POST /api/v1/rounds/{id}/cancel`
  (`{reason}` obligatorio)
- `GET /health`

### Ciclo de vida de las rondas

- El guardia crea e inicia su ronda desde la app con
  `POST /rounds/start-new`: la API la asigna a él y a su empresa activa, toma
  los checkpoints activos de esa empresa y la deja en `IN_PROGRESS`. Si ya
  tiene una ronda en curso o pausada responde `409` para evitar duplicados.
- El cronómetro se calcula en el servidor: `elapsed_seconds` descuenta
  `paused_seconds` y se congela en pausas y cierres.
- `GET /rounds/history` devuelve por defecto las rondas de las últimas 24 horas
  (`date_from = now - 24 h`). Use `last_hours` para ampliar la ventana,
  `date_from` para fijar un inicio exacto o `all_time=true` para ver todo.
- Al marcar el último checkpoint, la ronda pasa automáticamente a `COMPLETED`.
- Si pasan `ROUND_INACTIVITY_TIMEOUT_MINUTES` (20 por defecto) sin marcaciones,
  la ronda en curso se cancela (`cancel_reason = "Cancelada por inactividad"`) y
  la API responde `409` con un mensaje explicativo. Las rondas pausadas no
  caducan y pueden retomarse desde el historial.
- `elapsed_seconds` de cada `RoundLog` y `segment_seconds` de cada checkpoint
  permiten mostrar tiempos acumulados y por tramo en la app.
- La app móvil mantiene una cola offline en AsyncStorage cuando no hay red. Al
  recuperar la conexión reenvía las marcaciones en orden con su `timestamp`
  original. La inactividad se evalúa contra ese instante, por lo que una
  sincronización tardía no cancela una ronda cuyas marcaciones fueron a tiempo.

## 7. Validación rápida

```bash
# Backend: migración sobre SQLite y arranque de la app
cd backend
$env:DATABASE_URL = "sqlite:///./_test.db"
venv\Scripts\python.exe -m alembic upgrade head
venv\Scripts\python.exe -c "from app.main import app; print(len(app.routes))"

# Frontend: compilación de producción
cd ..\frontend
npm run build
```
