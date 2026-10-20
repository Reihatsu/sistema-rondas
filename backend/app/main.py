"""Fábrica de la aplicación FastAPI del Sistema de Rondas."""

from __future__ import annotations

import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.v1 import api_router
from app.core.config import settings
from app.core.database import check_connection, engine
from app.db.init_db import init_db

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)-8s | %(name)s | %(message)s",
)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    """Crea el esquema y siembra los datos iniciales al arrancar.

    En Render (sin variables MySQL) se usa SQLite y, si la base de datos está
    vacía, se cargan los datos demo automáticamente. Si la base de datos no
    está disponible, la API arranca igualmente y el error se reporta en
    ``/health`` y en las peticiones que usen la base de datos.
    """
    logger.info(
        "Base de datos configurada: %s (%s)%s",
        settings.database_backend,
        engine.url.render_as_string(hide_password=True),
        " [fallback SQLite: no se detectaron variables MySQL]"
        if settings.IS_SQLITE_FALLBACK
        else "",
    )

    if settings.INIT_DB_ON_STARTUP:
        try:
            init_db()
        except Exception:  # noqa: BLE001 - el arranque no debe caerse
            logger.exception(
                "No se pudo inicializar la base de datos. En local revise el "
                "archivo .env y que el servidor MySQL esté en ejecución; en "
                "Render revise los logs y el archivo SQLite."
            )
    yield


def create_application() -> FastAPI:
    """Construye y configura la instancia de FastAPI."""
    application = FastAPI(
        title=settings.PROJECT_NAME,
        version=settings.VERSION,
        description=(
            "API del Sistema de Rondas: autenticación JWT, gestión de empresas, "
            "usuarios y puntos de control, y consulta de rondas/checkpoints NFC."
        ),
        openapi_url=f"{settings.API_V1_PREFIX}/openapi.json",
        docs_url="/docs",
        redoc_url="/redoc",
        lifespan=lifespan,
    )

    # CORS: permite el frontend Vite (localhost:5173) y orígenes configurados.
    application.add_middleware(
        CORSMiddleware,
        allow_origins=settings.BACKEND_CORS_ORIGINS,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    application.include_router(api_router, prefix=settings.API_V1_PREFIX)

    @application.get("/", tags=["Sistema"], summary="Información de la API")
    def root() -> dict[str, str]:
        return {
            "name": settings.PROJECT_NAME,
            "version": settings.VERSION,
            "environment": settings.ENVIRONMENT,
            "docs": "/docs",
            "api": settings.API_V1_PREFIX,
        }

    @application.get("/health", tags=["Sistema"], summary="Estado del servicio")
    def health() -> dict[str, object]:
        database_ok = check_connection()
        return {
            "status": "ok" if database_ok else "degraded",
            "database": "up" if database_ok else "down",
            "database_backend": settings.database_backend,
            "environment": settings.ENVIRONMENT,
            "version": settings.VERSION,
        }

    return application


app = create_application()
