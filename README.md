# Sistema de Rondas

Monorepo de un sistema de control de rondas de vigilancia con checkpoints NFC.

- **Backend**: FastAPI + SQLAlchemy 2 + MySQL (PyMySQL) + JWT (OAuth2 password flow).
- **Frontend**: React 18 + Vite + Tailwind CSS + Lucide React + React Router + Axios.
- **Base de datos**: scripts SQL en `database/` y migraciones Alembic en `backend/alembic/`.

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
│   ├── alembic/           # migraciones (0001_initial_schema, 0002_checkpoints)
│   ├── init_db.py         # crea tablas + datos demo (contraseñas bcrypt)
│   ├── main.py            # entrypoint uvicorn
│   └── requirements.txt
├── database/
│   ├── schema.sql         # DDL MySQL equivalente a la migración
│   └── seed.sql           # datos de demostración
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
- MySQL 8 (o MariaDB 10.6+)

## 1. Base de datos

Opción A — scripts SQL (crea esquema y datos demo):

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
tiene permiso `CREATE DATABASE`.

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
| `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME` | Conexión MySQL |
| `DATABASE_URL` | Sobrescribe la conexión (p. ej. SQLite en pruebas) |
| `SECRET_KEY`, `ALGORITHM`, `ACCESS_TOKEN_EXPIRE_MINUTES` | Firma del JWT |
| `BACKEND_CORS_ORIGINS` | Orígenes permitidos (Vite en 5173) |
| `INIT_DB_ON_STARTUP`, `AUTO_SEED_ADMIN` | Bootstrap de tablas y admin |

## 3. Frontend

```bash
cd frontend
npm install
npm run dev      # http://localhost:5173
npm run build    # bundle de producción en dist/
```

El proxy de Vite redirige `/api` al backend, por lo que no hace falta configurar
CORS en desarrollo. Para apuntar a otra API: `VITE_API_URL=http://host:8000/api/v1`.

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
| `GUARD` | Sus propias rondas |
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
- `GET /api/v1/rounds`, `GET /api/v1/rounds/summary`, `GET /api/v1/rounds/{id}`,
  `GET /api/v1/rounds/{id}/logs`, `POST /api/v1/rounds/{id}/comments`
- `GET /health`

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
