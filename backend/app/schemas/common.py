"""Esquemas Pydantic reutilizables."""

from __future__ import annotations

from typing import Generic, TypeVar

from pydantic import BaseModel, Field

T = TypeVar("T")


class Message(BaseModel):
    """Respuesta simple para operaciones sin cuerpo de retorno."""

    detail: str = Field(examples=["Operación realizada correctamente"])


class Paginated(BaseModel, Generic[T]):
    """Contenedor genérico de resultados paginados."""

    items: list[T]
    total: int = Field(description="Total de registros que cumplen los filtros")
    page: int = Field(ge=1)
    page_size: int = Field(ge=1)
