"""Coordenadas de checkpoints y trazabilidad GPS de las marcaciones.

Revision ID: 0003_checkin_gps
Revises: 0002_checkpoints
Create Date: 2026-10-20
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0003_checkin_gps"
down_revision: str | None = "0002_checkpoints"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Añade la geovalla del punto y los datos GPS de cada marcación."""
    op.add_column("checkpoints", sa.Column("latitude", sa.Float(), nullable=True))
    op.add_column("checkpoints", sa.Column("longitude", sa.Float(), nullable=True))
    op.add_column(
        "checkpoints",
        sa.Column(
            "geofence_radius_m",
            sa.Integer(),
            nullable=False,
            server_default=sa.text("50"),
        ),
    )

    # ``batch_alter_table`` mantiene la migración compatible con SQLite, que no
    # admite añadir claves foráneas con ALTER TABLE.
    with op.batch_alter_table("round_logs") as batch_op:
        batch_op.add_column(sa.Column("checkpoint_id", sa.Integer(), nullable=True))
        batch_op.add_column(sa.Column("latitude", sa.Float(), nullable=True))
        batch_op.add_column(sa.Column("longitude", sa.Float(), nullable=True))
        batch_op.add_column(sa.Column("distance_m", sa.Float(), nullable=True))
        batch_op.create_foreign_key(
            "fk_round_logs_checkpoint_id_checkpoints",
            "checkpoints",
            ["checkpoint_id"],
            ["id"],
            ondelete="SET NULL",
        )
        batch_op.create_index(
            "ix_round_logs_checkpoint_id", ["checkpoint_id"], unique=False
        )


def downgrade() -> None:
    """Revierte los campos de geolocalización."""
    with op.batch_alter_table("round_logs") as batch_op:
        batch_op.drop_index("ix_round_logs_checkpoint_id")
        batch_op.drop_constraint(
            "fk_round_logs_checkpoint_id_checkpoints", type_="foreignkey"
        )
        batch_op.drop_column("distance_m")
        batch_op.drop_column("longitude")
        batch_op.drop_column("latitude")
        batch_op.drop_column("checkpoint_id")

    op.drop_column("checkpoints", "geofence_radius_m")
    op.drop_column("checkpoints", "longitude")
    op.drop_column("checkpoints", "latitude")
