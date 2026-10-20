"""Configuración central de la aplicación.

Las variables se leen desde ``backend/.env`` (python-dotenv) y, si existen,
las variables de entorno del sistema tienen prioridad. Esto permite
sobreescribir la configuración en despliegues o en pruebas automatizadas.
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

        # --- Base de datos MySQL ---
        self.DB_HOST: str = os.getenv("DB_HOST", "localhost")
        self.DB_PORT: int = _as_int(os.getenv("DB_PORT"), 3306)
        self.DB_USER: str = os.getenv("DB_USER", "root")
        self.DB_PASSWORD: str = os.getenv("DB_PASSWORD", "")
        self.DB_NAME: str = os.getenv("DB_NAME", "sistema_rondas_db")
        self.DB_ECHO: bool = _as_bool(os.getenv("DB_ECHO"), False)

        # ``DATABASE_URL`` permite sobrescribir todo (por ejemplo SQLite en tests).
        self.DATABASE_URL: str = os.getenv("DATABASE_URL") or self._build_mysql_url()

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
        self.FIRST_ADMIN_NAME: str = os.getenv("FIRST_ADMIN_NAME", "Administrador")
        self.FIRST_ADMIN_EMAIL: str = os.getenv(
            "FIRST_ADMIN_EMAIL", "admin@sistema-rondas.local"
        )
        self.FIRST_ADMIN_PASSWORD: str = os.getenv(
            "FIRST_ADMIN_PASSWORD", "Admin123!"
        )

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


@lru_cache
def get_settings() -> Settings:
    """Devuelve una única instancia (cacheada) de la configuración."""
    return Settings()


settings: Settings = get_settings()
