"""Ciclo de vida de las rondas: pausas, inactividad e historial.

Revision ID: 0004_round_lifecycle
Revises: 0003_checkin_gps
Create Date: 2026-10-20
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0004_round_lifecycle"
down_revision: str | None = "0003_checkin_gps"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Añade el control de pausas, actividad y tiempos de marcación."""
    # ``batch_alter_table`` mantiene la migración compatible con SQLite.
    with op.batch_alter_table("rounds") as batch_op:
        batch_op.add_column(
            sa.Column("paused_at", sa.DateTime(timezone=True), nullable=True)
        )
        batch_op.add_column(
            sa.Column(
                "paused_seconds",
                sa.Integer(),
                nullable=False,
                server_default=sa.text("0"),
            )
        )
        batch_op.add_column(
            sa.Column(
                "last_activity_at", sa.DateTime(timezone=True), nullable=True
            )
        )
        batch_op.add_column(sa.Column("cancel_reason", sa.String(255), nullable=True))
        batch_op.create_index(
            "ix_rounds_last_activity_at", ["last_activity_at"], unique=False
        )

    with op.batch_alter_table("round_logs") as batch_op:
        batch_op.add_column(sa.Column("elapsed_seconds", sa.Integer(), nullable=True))

    # Rondas abiertas creadas antes de esta migración: se toma el inicio como
    # última actividad para que no se cancelen por inactividad de inmediato.
    op.execute(
        sa.text(
            "UPDATE rounds SET last_activity_at = COALESCE(start_time, created_at) "
            "WHERE last_activity_at IS NULL AND status IN ('IN_PROGRESS', 'PAUSED')"
        )
    )


def downgrade() -> None:
    """Revierte los campos de ciclo de vida de las rondas."""
    with op.batch_alter_table("round_logs") as batch_op:
        batch_op.drop_column("elapsed_seconds")

    with op.batch_alter_table("rounds") as batch_op:
        batch_op.drop_index("ix_rounds_last_activity_at")
        batch_op.drop_column("cancel_reason")
        batch_op.drop_column("last_activity_at")
        batch_op.drop_column("paused_seconds")
        batch_op.drop_column("paused_at")
