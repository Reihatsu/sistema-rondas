"""Router agregador de la API v1."""

from fastapi import APIRouter

from app.api.v1 import auth, checkpoints, companies, rounds, users

api_router = APIRouter()
api_router.include_router(auth.router)
api_router.include_router(companies.router)
api_router.include_router(users.router)
api_router.include_router(checkpoints.router)
api_router.include_router(rounds.router)

__all__ = ["api_router"]
