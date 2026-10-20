"""Tablas de asociación (relaciones muchos-a-muchos)."""

from __future__ import annotations

from sqlalchemy import Column, DateTime, ForeignKey, Table, func

from app.models.base import Base

#: Empresas asignadas a un usuario.
#: Un Supervisors/Guard puede estar asignado a una o varias empresas.
user_companies = Table(
    "user_companies",
    Base.metadata,
    Column(
        "user_id",
        ForeignKey("users.id", ondelete="CASCADE"),
        primary_key=True,
    ),
    Column(
        "company_id",
        ForeignKey("companies.id", ondelete="CASCADE"),
        primary_key=True,
        index=True,
    ),
    Column(
        "created_at",
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    ),
)

#: Asociación Guardia -> Supervisor.
#: ``supervisor_id`` supervisa a ``guard_id`` (ambos son usuarios).
supervisor_guards = Table(
    "supervisor_guards",
    Base.metadata,
    Column(
        "supervisor_id",
        ForeignKey("users.id", ondelete="CASCADE"),
        primary_key=True,
    ),
    Column(
        "guard_id",
        ForeignKey("users.id", ondelete="CASCADE"),
        primary_key=True,
        index=True,
    ),
    Column(
        "created_at",
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    ),
)
