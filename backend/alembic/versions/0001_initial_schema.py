"""Esquema inicial: empresas, usuarios, asignaciones y rondas.

Revision ID: 0001_initial
Revises:
Create Date: 2026-10-20

"""
from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# Identificadores usados por Alembic.
revision: str = "0001_initial"
down_revision: str | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

USER_ROLE = sa.Enum(
    "ADMIN",
    "SUPERVISOR",
    "COMPANY_USER",
    "GUARD",
    name="user_role",
)
ROUND_STATUS = sa.Enum(
    "PENDING",
    "IN_PROGRESS",
    "COMPLETED",
    "CANCELLED",
    "PAUSED",
    name="round_status",
)
ROUND_LOG_STATUS = sa.Enum("OK", "INCIDENT", "SKIPPED", name="round_log_status")


def upgrade() -> None:
    # --- Empresas ---------------------------------------------------------
    op.create_table(
        "companies",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("name", sa.String(length=150), nullable=False),
        sa.Column("tax_id", sa.String(length=30), nullable=False),
        sa.Column("address", sa.String(length=255), nullable=True),
        sa.Column("phone", sa.String(length=30), nullable=True),
        sa.Column(
            "is_active", sa.Boolean(), server_default=sa.text("1"), nullable=False
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("CURRENT_TIMESTAMP"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id", name="pk_companies"),
        sa.UniqueConstraint("name", name="uq_companies_name"),
        sa.UniqueConstraint("tax_id", name="uq_companies_tax_id"),
    )
    op.create_index("ix_companies_is_active", "companies", ["is_active"])

    # --- Usuarios ---------------------------------------------------------
    op.create_table(
        "users",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("name", sa.String(length=150), nullable=False),
        sa.Column("email", sa.String(length=150), nullable=False),
        sa.Column("password_hash", sa.String(length=255), nullable=False),
        sa.Column("role", USER_ROLE, server_default="GUARD", nullable=False),
        sa.Column(
            "is_active", sa.Boolean(), server_default=sa.text("1"), nullable=False
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("CURRENT_TIMESTAMP"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id", name="pk_users"),
        sa.UniqueConstraint("email", name="uq_users_email"),
    )
    op.create_index("ix_users_role", "users", ["role"])
    op.create_index("ix_users_is_active", "users", ["is_active"])

    # --- Empresas por usuario --------------------------------------------
    op.create_table(
        "user_companies",
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("company_id", sa.Integer(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("CURRENT_TIMESTAMP"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ["company_id"],
            ["companies.id"],
            name="fk_user_companies_company_id_companies",
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            name="fk_user_companies_user_id_users",
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("user_id", "company_id", name="pk_user_companies"),
    )
    op.create_index(
        "ix_user_companies_company_id", "user_companies", ["company_id"]
    )

    # --- Guardias por supervisor -----------------------------------------
    op.create_table(
        "supervisor_guards",
        sa.Column("supervisor_id", sa.Integer(), nullable=False),
        sa.Column("guard_id", sa.Integer(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("CURRENT_TIMESTAMP"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ["guard_id"],
            ["users.id"],
            name="fk_supervisor_guards_guard_id_users",
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["supervisor_id"],
            ["users.id"],
            name="fk_supervisor_guards_supervisor_id_users",
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint(
            "supervisor_id", "guard_id", name="pk_supervisor_guards"
        ),
    )
    op.create_index(
        "ix_supervisor_guards_guard_id", "supervisor_guards", ["guard_id"]
    )

    # --- Rondas -----------------------------------------------------------
    op.create_table(
        "rounds",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("company_id", sa.Integer(), nullable=False),
        sa.Column("guard_id", sa.Integer(), nullable=False),
        sa.Column("status", ROUND_STATUS, server_default="PENDING", nullable=False),
        sa.Column("start_time", sa.DateTime(timezone=True), nullable=True),
        sa.Column("end_time", sa.DateTime(timezone=True), nullable=True),
        sa.Column("observations", sa.Text(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("CURRENT_TIMESTAMP"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ["company_id"],
            ["companies.id"],
            name="fk_rounds_company_id_companies",
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["guard_id"],
            ["users.id"],
            name="fk_rounds_guard_id_users",
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id", name="pk_rounds"),
    )
    op.create_index("ix_rounds_company_id", "rounds", ["company_id"])
    op.create_index("ix_rounds_guard_id", "rounds", ["guard_id"])
    op.create_index("ix_rounds_status", "rounds", ["status"])
    op.create_index("ix_rounds_created_at", "rounds", ["created_at"])

    # --- Checkpoints NFC --------------------------------------------------
    op.create_table(
        "round_logs",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("round_id", sa.Integer(), nullable=False),
        sa.Column("nfc_tag_id", sa.String(length=100), nullable=False),
        sa.Column("checkpoint_name", sa.String(length=150), nullable=False),
        sa.Column(
            "timestamp",
            sa.DateTime(timezone=True),
            server_default=sa.text("CURRENT_TIMESTAMP"),
            nullable=False,
        ),
        sa.Column("status", ROUND_LOG_STATUS, server_default="OK", nullable=False),
        sa.ForeignKeyConstraint(
            ["round_id"],
            ["rounds.id"],
            name="fk_round_logs_round_id_rounds",
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name="pk_round_logs"),
    )
    op.create_index("ix_round_logs_round_id", "round_logs", ["round_id"])
    op.create_index("ix_round_logs_nfc_tag_id", "round_logs", ["nfc_tag_id"])
    op.create_index("ix_round_logs_timestamp", "round_logs", ["timestamp"])


def downgrade() -> None:
    # El orden inverso respeta las claves foráneas.
    op.drop_table("round_logs")
    op.drop_table("rounds")
    op.drop_table("supervisor_guards")
    op.drop_table("user_companies")
    op.drop_table("users")
    op.drop_table("companies")
