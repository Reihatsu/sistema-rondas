"""Configuración central de la aplicación.

Las variables se leen desde ``backend/.env`` (python-dotenv) y, si existen,
las variables de entorno del sistema tienen prioridad. Esto permite
sobreescribir la configuración en despliegues o en pruebas automatizadas.

La conexión a base de datos es **híbrida**:

* Si hay variables de MySQL (``DB_HOST``, ``DB_USER``, ...) se usa MySQL con
  PyMySQL (comportamiento local habitual).
* Si ``USE_SQLITE`` es verdadero, o no hay ninguna variable de MySQL, se usa
  SQLite sobre ``backend/sistema_rondas.db`` (pensado para Render y pruebas).
* ``DATABASE_URL`` sigue teniendo la máxima prioridad y sobrescribe todo.
"""

from __future__ import annotations

import os
from functools import lru_cache
from pathlib import Path
from urllib.parse import quote_plus

from dotenv import load_dotenv

# backend/  (config.py -> core -> app -> backend)
BASE_DIR: Path = Path(__file__).resolve().parents[2]

# ``override=False``: lo definido en el sistema operativo gana sobre el .env.
load_dotenv(BASE_DIR / ".env", override=False)

#: Nombre del archivo SQLite usado como fallback.
SQLITE_DB_FILENAME: str = "sistema_rondas.db"

#: Ruta por defecto del archivo SQLite (``backend/sistema_rondas.db``).
DEFAULT_SQLITE_PATH: Path = BASE_DIR / SQLITE_DB_FILENAME

#: Variables que indican la intención de conectarse a MySQL.
MYSQL_ENV_VARS: tuple[str, ...] = (
    "DB_HOST",
    "DB_PORT",
    "DB_USER",
    "DB_PASSWORD",
    "DB_NAME",
)


def _mysql_env_configured() -> bool:
    """Indica si el entorno define alguna variable de conexión MySQL.

    Se evalúa antes de aplicar los valores por defecto de :class:`Settings`,
    porque ``DB_HOST=localhost`` por defecto no debe considerarse una señal de
    que existe un MySQL disponible (en Render no lo hay).
    """
    return any(os.getenv(name) for name in MYSQL_ENV_VARS)


def _as_bool(value: str | None, default: bool = False) -> bool:
    """Convierte una variable de entorno textual en booleano."""
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "y", "on"}


def _as_int(value: str | None, default: int) -> int:
    """Convierte una variable de entorno textual en entero."""
    try:
        return int(value) if value is not None else default
    except ValueError:
        return default


class Settings:
    """Configuración tipada de la aplicación."""

    def __init__(self) -> None:
        # --- Aplicación ---
        self.PROJECT_NAME: str = os.getenv("PROJECT_NAME", "Sistema de Rondas API")
        self.VERSION: str = os.getenv("APP_VERSION", "0.1.0")
        self.API_V1_PREFIX: str = os.getenv("API_V1_PREFIX", "/api/v1")
        self.ENVIRONMENT: str = os.getenv("ENVIRONMENT", "development")

        # --- Base de datos (MySQL local / SQLite en Render) ---
        self.DB_HOST: str = os.getenv("DB_HOST", "localhost")
        self.DB_PORT: int = _as_int(os.getenv("DB_PORT"), 3306)
        self.DB_USER: str = os.getenv("DB_USER", "root")
        self.DB_PASSWORD: str = os.getenv("DB_PASSWORD", "")
        self.DB_NAME: str = os.getenv("DB_NAME", "sistema_rondas_db")
        self.DB_ECHO: bool = _as_bool(os.getenv("DB_ECHO"), False)

        #: Fuerza SQLite aunque existan variables MySQL.
        self.USE_SQLITE: bool = _as_bool(os.getenv("USE_SQLITE"), False)

        #: Ruta del archivo SQLite (por defecto ``backend/sistema_rondas.db``).
        self.SQLITE_DB_PATH: Path = self._resolve_sqlite_path(
            os.getenv("SQLITE_DB_PATH")
        )

        # ``DATABASE_URL`` permite sobrescribir todo (por ejemplo SQLite en tests).
        explicit_url = (os.getenv("DATABASE_URL") or "").strip()
        #: Verdadero cuando se usa SQLite porque no hay configuración de MySQL.
        self.IS_SQLITE_FALLBACK: bool = (
            not explicit_url and not self.USE_SQLITE and not _mysql_env_configured()
        )
        self.DATABASE_URL: str = self._resolve_database_url(explicit_url)

        # --- Seguridad / JWT ---
        self.SECRET_KEY: str = os.getenv("SECRET_KEY", "supersecretkey")
        self.ALGORITHM: str = os.getenv("ALGORITHM", "HS256")
        self.ACCESS_TOKEN_EXPIRE_MINUTES: int = _as_int(
            os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES"), 480
        )

        # --- CORS ---
        raw_origins = os.getenv(
            "BACKEND_CORS_ORIGINS",
            "http://localhost:5173,http://127.0.0.1:5173",
        )
        self.BACKEND_CORS_ORIGINS: list[str] = [
            origin.strip() for origin in raw_origins.split(",") if origin.strip()
        ]

        # --- Arranque / bootstrap ---
        self.INIT_DB_ON_STARTUP: bool = _as_bool(
            os.getenv("INIT_DB_ON_STARTUP"), True
        )
        self.AUTO_SEED_ADMIN: bool = _as_bool(os.getenv("AUTO_SEED_ADMIN"), True)
        #: Siembra empresa/usuarios/puntos demo cuando la base de datos está vacía.
        self.AUTO_SEED_DEMO: bool = _as_bool(os.getenv("AUTO_SEED_DEMO"), True)
        self.FIRST_ADMIN_NAME: str = os.getenv("FIRST_ADMIN_NAME", "Administrador")
        self.FIRST_ADMIN_EMAIL: str = os.getenv(
            "FIRST_ADMIN_EMAIL", "admin@sistema-rondas.local"
        )
        self.FIRST_ADMIN_PASSWORD: str = os.getenv(
            "FIRST_ADMIN_PASSWORD", "Admin123!"
        )

    @staticmethod
    def _resolve_sqlite_path(raw_path: str | None) -> Path:
        """Devuelve la ruta absoluta del archivo SQLite.

        Las rutas relativas se resuelven contra ``backend/`` (no contra el
        directorio de trabajo) para que el archivo siempre viva en el mismo
        sitio tanto en local como en Render.
        """
        path = Path(raw_path).expanduser() if raw_path else DEFAULT_SQLITE_PATH
        if str(path) == ":memory:":
            return path
        if not path.is_absolute():
            path = BASE_DIR / path
        return path.resolve()

    def _resolve_database_url(self, explicit_url: str) -> str:
        """Elige la URL de conexión según el entorno (MySQL, SQLite u override)."""
        if explicit_url:
            return explicit_url
        if self.USE_SQLITE or self.IS_SQLITE_FALLBACK:
            return self._build_sqlite_url()
        return self._build_mysql_url()

    def _build_sqlite_url(self) -> str:
        """Construye la URL de SQLite para el archivo configurado."""
        if str(self.SQLITE_DB_PATH) == ":memory:":
            return "sqlite:///:memory:"
        # ``as_posix()`` mantiene la URL válida también en Windows (C:/...).
        return f"sqlite:///{self.SQLITE_DB_PATH.as_posix()}"

    def _build_mysql_url(self) -> str:
        """Construye la URL de conexión MySQL (SQLAlchemy + PyMySQL)."""
        password = quote_plus(self.DB_PASSWORD)
        user = quote_plus(self.DB_USER)
        return (
            f"mysql+pymysql://{user}:{password}@{self.DB_HOST}:{self.DB_PORT}"
            f"/{self.DB_NAME}?charset=utf8mb4"
        )

    @property
    def server_url(self) -> str:
        """URL de conexión al servidor MySQL sin base de datos seleccionada."""
        password = quote_plus(self.DB_PASSWORD)
        user = quote_plus(self.DB_USER)
        return (
            f"mysql+pymysql://{user}:{password}@{self.DB_HOST}:{self.DB_PORT}"
            "/?charset=utf8mb4"
        )

    @property
    def is_mysql(self) -> bool:
        """Indica si la URL configurada apunta a MySQL."""
        return self.DATABASE_URL.startswith("mysql")

    @property
    def is_sqlite(self) -> bool:
        """Indica si la URL configurada apunta a SQLite."""
        return self.DATABASE_URL.startswith("sqlite")

    @property
    def database_backend(self) -> str:
        """Nombre corto del motor en uso (para logs y ``/health``)."""
        if self.is_mysql:
            return "mysql"
        if self.is_sqlite:
            return "sqlite"
        return "unknown"


@lru_cache
def get_settings() -> Settings:
    """Devuelve una única instancia (cacheada) de la configuración."""
    return Settings()


settings: Settings = get_settings()
