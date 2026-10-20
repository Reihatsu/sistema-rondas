"""Puntos de control por empresa.

Revision ID: 0002_checkpoints
Revises: 0001_initial
Create Date: 2026-10-20
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0002_checkpoints"
down_revision: str | None = "0001_initial"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Crea la tabla ``checkpoints`` con código global único."""
    op.create_table(
        "checkpoints",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("company_id", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(length=150), nullable=False),
        sa.Column("code", sa.String(length=100), nullable=False),
        sa.Column("location_description", sa.Text(), nullable=True),
        sa.Column(
            "is_active", sa.Boolean(), nullable=False, server_default=sa.text("1")
        ),
        sa.Column(
            "created_at",
            sa.DateTime(),
            nullable=False,
            server_default=sa.text("CURRENT_TIMESTAMP"),
        ),
        sa.ForeignKeyConstraint(
            ["company_id"],
            ["companies.id"],
            name="fk_checkpoints_company_id_companies",
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("code", name="uq_checkpoints_code"),
    )
    op.create_index(
        "ix_checkpoints_company_id", "checkpoints", ["company_id"], unique=False
    )
    op.create_index(
        "ix_checkpoints_is_active", "checkpoints", ["is_active"], unique=False
    )


def downgrade() -> None:
    """Elimina la tabla de puntos de control."""
    op.drop_index("ix_checkpoints_is_active", table_name="checkpoints")
    op.drop_index("ix_checkpoints_company_id", table_name="checkpoints")
    op.drop_table("checkpoints")
