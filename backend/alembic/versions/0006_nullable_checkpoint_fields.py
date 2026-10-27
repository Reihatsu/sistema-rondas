"""Identificadores y coordenadas opcionales de los puntos de control.

Los puntos de control pueden crearse antes de instalar su etiqueta NFC o de
capturar su ubicación GPS. Por eso ``uid_nfc``, ``latitude`` y ``longitude``
deben ser siempre nullable, tanto en instalaciones nuevas como en bases de
datos que se hayan creado con una versión anterior del esquema.

Revision ID: 0006_nullable_checkpoint_fields
Revises: 0005_point_types
Create Date: 2026-10-27
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0006_nullable_checkpoint_fields"
down_revision: str | None = "0005_point_types"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Garantiza que UID NFC y coordenadas acepten ``NULL``."""
    # ``batch_alter_table`` mantiene la migración compatible con SQLite.
    with op.batch_alter_table("checkpoints") as batch_op:
        batch_op.alter_column(
            "uid_nfc",
            existing_type=sa.String(length=100),
            nullable=True,
        )
        batch_op.alter_column(
            "latitude",
            existing_type=sa.Float(),
            nullable=True,
        )
        batch_op.alter_column(
            "longitude",
            existing_type=sa.Float(),
            nullable=True,
        )


def downgrade() -> None:
    """Restaura la obligatoriedad original de los campos.

    Nota: el downgrade falla si existen puntos sin UID o sin coordenadas. Es
    intencionalmente conservador para no perder información silenciosamente.
    """
    with op.batch_alter_table("checkpoints") as batch_op:
        batch_op.alter_column(
            "longitude",
            existing_type=sa.Float(),
            nullable=False,
        )
        batch_op.alter_column(
            "latitude",
            existing_type=sa.Float(),
            nullable=False,
        )
        batch_op.alter_column(
            "uid_nfc",
            existing_type=sa.String(length=100),
            nullable=False,
        )
