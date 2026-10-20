"""Bootstrap e inicialización de datos."""

from app.db.init_db import init_db, seed_admin

__all__ = ["init_db", "seed_admin"]
