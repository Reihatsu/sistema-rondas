"""Punto de entrada del backend.

Uso recomendado (desde ``backend/``):

    venv\\Scripts\\activate
    python main.py

También es válido con Uvicorn directamente:

    uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
"""

from __future__ import annotations

import os

import uvicorn

# Reexportado para permitir ``uvicorn main:app`` desde la carpeta backend/.
from app.main import app  # noqa: F401

HOST = os.getenv("HOST", "127.0.0.1")
PORT = int(os.getenv("PORT", "8000"))
RELOAD = os.getenv("RELOAD", "true").strip().lower() in {"1", "true", "yes", "on"}


if __name__ == "__main__":
    uvicorn.run(
        "app.main:app",
        host=HOST,
        port=PORT,
        reload=RELOAD,
        log_level=os.getenv("LOG_LEVEL", "info"),
    )
