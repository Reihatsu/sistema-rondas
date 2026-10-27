"""Tipo de punto por empresa y UID de las etiquetas NFC.

Cada empresa define si sus puntos de control se identifican con un código QR
impreso o con una etiqueta NFC. Los checkpoints NFC guardan además el UID
físico de la etiqueta (``uid_nfc``), que es lo que lee el dispositivo.

Revision ID: 0005_point_types
Revises: 0004_round_lifecycle
Create Date: 2026-10-27
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0005_point_types"
down_revision: str | None = "0004_round_lifecycle"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

POINT_TYPE = sa.Enum("QR", "NFC", name="point_type")


def upgrade() -> None:
    """Añade ``companies.point_type`` y ``checkpoints.uid_nfc``."""
    # ``batch_alter_table`` mantiene la migración compatible con SQLite.
    with op.batch_alter_table("companies") as batch_op:
        batch_op.add_column(
            sa.Column("point_type", POINT_TYPE, server_default="QR", nullable=False)
        )

    with op.batch_alter_table("checkpoints") as batch_op:
        batch_op.add_column(sa.Column("uid_nfc", sa.String(length=100), nullable=True))
        batch_op.create_index("ix_checkpoints_uid_nfc", ["uid_nfc"], unique=False)
        batch_op.create_unique_constraint("uq_checkpoints_uid_nfc", ["uid_nfc"])


def downgrade() -> None:
    """Revierte el tipo de punto y los UID NFC."""
    with op.batch_alter_table("checkpoints") as batch_op:
        batch_op.drop_constraint("uq_checkpoints_uid_nfc", type_="unique")
        batch_op.drop_index("ix_checkpoints_uid_nfc")
        batch_op.drop_column("uid_nfc")

    with op.batch_alter_table("companies") as batch_op:
        batch_op.drop_column("point_type")
