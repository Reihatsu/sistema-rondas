"""Bootstrap e inicialización de datos."""

from app.db.init_db import database_is_empty, init_db, seed_admin
from app.db.seed import seed_demo_data

__all__ = ["database_is_empty", "init_db", "seed_admin", "seed_demo_data"]
