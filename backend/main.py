"""Punto de entrada del backend.

Uso recomendado (desde ``backend/``):

    venv\\Scripts\\activate
    python main.py

También es válido con Uvicorn directamente:

    uvicorn app.main:app --reload --host 127.0.0.1 --port 8000

En Render el servicio escucha en ``0.0.0.0`` y en el puerto indicado por la
variable ``PORT`` (el reload se desactiva automáticamente):

    uvicorn app.main:app --host 0.0.0.0 --port $PORT
"""

from __future__ import annotations

import os

import uvicorn

# Reexportado para permitir ``uvicorn main:app`` desde la carpeta backend/.
from app.main import app  # noqa: F401

#: Render (y otros PaaS) definen ``RENDER``/``PORT`` y esperan escuchar en
#: 0.0.0.0. En local se mantiene 127.0.0.1 por seguridad.
_IS_DEPLOYED = bool(os.getenv("RENDER") or os.getenv("PORT"))
HOST = os.getenv("HOST") or ("0.0.0.0" if _IS_DEPLOYED else "127.0.0.1")
PORT = int(os.getenv("PORT", "8000"))
_RELOAD_DEFAULT = "false" if _IS_DEPLOYED else "true"
RELOAD = os.getenv("RELOAD", _RELOAD_DEFAULT).strip().lower() in {
    "1",
    "true",
    "yes",
    "on",
}


if __name__ == "__main__":
    uvicorn.run(
        "app.main:app",
        host=HOST,
        port=PORT,
        reload=RELOAD,
        log_level=os.getenv("LOG_LEVEL", "info"),
    )
