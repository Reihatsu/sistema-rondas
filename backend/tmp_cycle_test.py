"""Prueba E2E temporal del ciclo de vida de rondas (se elimina al terminar)."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

from fastapi.testclient import TestClient

from app.core.database import SessionLocal
from app.main import app
from app.models import Checkpoint, Round, RoundLog, RoundStatus, User


def login(client: TestClient, email: str, password: str) -> str:
    response = client.post(
        "/api/v1/auth/login",
        json={"email": email, "password": password},
    )
    assert response.status_code == 200, response.text
    return response.json()["access_token"]


def auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def make_round(
    email: str,
    *,
    status: RoundStatus,
    minutes_ago: int,
    inactive_minutes: int | None = None,
) -> int:
    now = datetime.now(timezone.utc)
    with SessionLocal() as db:
        user = db.query(User).filter(User.email == email).one()
        company_id = user.companies[0].id
        round_obj = Round(
            company_id=company_id,
            guard_id=user.id,
            status=status,
            start_time=now - timedelta(minutes=minutes_ago),
            last_activity_at=(
                now - timedelta(minutes=inactive_minutes)
                if inactive_minutes is not None
                else now
            ),
        )
        db.add(round_obj)
        db.commit()
        db.refresh(round_obj)
        return round_obj.id


with TestClient(app) as client:
    guard1 = login(client, "guardia1@demo.com", "guardia123")
    guard2 = login(client, "guardia2@demo.com", "guardia123")

    # --- 1. Ronda activa con cronómetro y deadline de inactividad ---
    active = client.get("/api/v1/rounds/active", headers=auth(guard1))
    assert active.status_code == 200, active.text
    round_data = active.json()
    assert round_data["status"] == "IN_PROGRESS", round_data["status"]
    assert round_data["elapsed_seconds"] > 0, round_data
    assert round_data["inactivity_deadline"] is not None
    assert round_data["inactivity_deadline"].endswith(("Z", "+00:00")), round_data[
        "inactivity_deadline"
    ]
    round_id = round_data["id"]
    print("1. activa OK:", round_id, round_data["elapsed_seconds"], "s")

    checkpoints = client.get(
        f"/api/v1/rounds/{round_id}/checkpoints", headers=auth(guard1)
    ).json()
    assert len(checkpoints) == 3, checkpoints
    first = next(item for item in checkpoints if item["code"] == "QR-EMP1-PT01")
    assert first["status"] == "COMPLETED" and first["is_visited"]
    assert first["elapsed_seconds"] == 120 and first["segment_seconds"] == 120
    pending = [item for item in checkpoints if item["status"] == "PENDING"]
    assert len(pending) == 2, pending
    print("2. checkpoints OK:", [(c["code"], c["status"]) for c in checkpoints])

    # --- 2. Pausa con motivo obligatorio y congelación del cronómetro ---
    paused = client.post(
        f"/api/v1/rounds/{round_id}/pause",
        headers=auth(guard1),
        json={"comment": "Pausado por emergencia en el sector B"},
    )
    assert paused.status_code == 200, paused.text
    paused_data = paused.json()
    assert paused_data["status"] == "PAUSED"
    assert paused_data["paused_at"] is not None
    frozen_elapsed = paused_data["elapsed_seconds"]
    assert "Pausado por emergencia" in paused_data["observations"]

    second_pause = client.post(
        f"/api/v1/rounds/{round_id}/pause",
        headers=auth(guard1),
        json={"comment": "Otra pausa"},
    )
    assert second_pause.status_code == 409, second_pause.text

    checkin_paused = client.post(
        f"/api/v1/rounds/{round_id}/checkin",
        headers=auth(guard1),
        json={
            "qr_code": "QR-EMP1-PT02",
            "latitude": 40.415100,
            "longitude": -3.710150,
        },
    )
    assert checkin_paused.status_code == 409, checkin_paused.text
    assert "pausada" in checkin_paused.json()["detail"].lower()
    print("3. pausa OK, cronómetro congelado en", frozen_elapsed, "s")

    # --- 3. Reanudar descuenta la pausa y conserva checkpoints ---
    resumed = client.post(
        f"/api/v1/rounds/{round_id}/resume", headers=auth(guard1)
    )
    assert resumed.status_code == 200, resumed.text
    resumed_data = resumed.json()
    assert resumed_data["status"] == "IN_PROGRESS"
    assert resumed_data["paused_at"] is None
    assert resumed_data["paused_seconds"] >= 0
    assert "Ronda reanudada." in resumed_data["observations"]

    checkpoints_after = client.get(
        f"/api/v1/rounds/{round_id}/checkpoints", headers=auth(guard1)
    ).json()
    assert sum(1 for c in checkpoints_after if c["is_visited"]) == 1
    print("4. reanudada OK, pausa acumulada:", resumed_data["paused_seconds"])

    # --- 4. Marcación con tiempos de tramo y cierre automático ---
    second = client.post(
        f"/api/v1/rounds/{round_id}/checkin",
        headers=auth(guard1),
        json={
            "qr_code": "qr-emp1-pt02",
            "latitude": 40.415100,
            "longitude": -3.710150,
        },
    )
    assert second.status_code == 201, second.text
    second_data = second.json()
    assert second_data["round_completed"] is False
    assert second_data["remaining_checkpoints"] == 1
    assert second_data["checkpoint"]["segment_seconds"] >= 0
    assert second_data["log"]["elapsed_seconds"] >= 0
    print(
        "5. marcación 2 OK:",
        second_data["checkpoint"]["elapsed_seconds"],
        "s acumulados,",
        second_data["checkpoint"]["segment_seconds"],
        "s de tramo",
    )

    final = client.post(
        f"/api/v1/rounds/{round_id}/checkin",
        headers=auth(guard1),
        json={
            "qr_code": "QR-EMP1-PT03",
            "latitude": 40.414700,
            "longitude": -3.709500,
        },
    )
    assert final.status_code == 201, final.text
    final_data = final.json()
    assert final_data["round_completed"] is True, final_data
    assert final_data["round_status"] == "COMPLETED"
    assert final_data["remaining_checkpoints"] == 0
    assert "Ronda completada" in final_data["message"]

    assert client.get("/api/v1/rounds/active", headers=auth(guard1)).json() is None
    print("6. cierre automático OK:", final_data["message"])

    # --- 5. Historial del guardia ---
    history = client.get(
        "/api/v1/rounds/history?page_size=50", headers=auth(guard1)
    )
    assert history.status_code == 200, history.text
    history_data = history.json()
    statuses = {item["status"] for item in history_data["items"]}
    assert "COMPLETED" in statuses and "CANCELLED" in statuses, statuses
    assert "IN_PROGRESS" not in statuses
    completed_item = next(
        item for item in history_data["items"] if item["id"] == round_id
    )
    assert len(completed_item["logs"]) == 3
    print("7. historial OK:", history_data["total"], "rondas")

    # --- 6. Ronda pausada de guardia2: continuar y cancelar ---
    active2 = client.get("/api/v1/rounds/active", headers=auth(guard2)).json()
    assert active2["status"] == "PAUSED", active2
    paused_round_id = active2["id"]
    resumed2 = client.post(
        f"/api/v1/rounds/{paused_round_id}/resume", headers=auth(guard2)
    )
    assert resumed2.status_code == 200, resumed2.text
    assert resumed2.json()["status"] == "IN_PROGRESS"

    cancelled = client.post(
        f"/api/v1/rounds/{paused_round_id}/cancel",
        headers=auth(guard2),
        json={"reason": "Evacuación preventiva del edificio"},
    )
    assert cancelled.status_code == 200, cancelled.text
    cancelled_data = cancelled.json()
    assert cancelled_data["status"] == "CANCELLED"
    assert cancelled_data["cancel_reason"] == "Evacuación preventiva del edificio"
    assert cancelled_data["end_time"] is not None
    assert "Ronda cancelada" in cancelled_data["observations"]
    print("8. reanudar + cancelar OK:", cancelled_data["elapsed_seconds"], "s")


    # --- 7. Inicio de una ronda PENDING ---
    pending_id = make_round(
        "guardia2@demo.com", status=RoundStatus.PENDING, minutes_ago=0
    )
    started = client.post(
        f"/api/v1/rounds/{pending_id}/start", headers=auth(guard2)
    )
    assert started.status_code == 200, started.text
    assert started.json()["status"] == "IN_PROGRESS"
    assert started.json()["last_activity_at"] is not None
    resumed_start = client.post(
        f"/api/v1/rounds/{pending_id}/start", headers=auth(guard2)
    )
    assert resumed_start.status_code == 200
    print("9. inicio OK, ronda:", pending_id)

    # --- 8. Expiración por inactividad (20 min) en /active ---
    expired_id = make_round(
        "guardia2@demo.com",
        status=RoundStatus.IN_PROGRESS,
        minutes_ago=40,
        inactive_minutes=25,
    )
    # Cerrar la ronda iniciada para que `/active` devuelva la expirada.
    client.post(
        f"/api/v1/rounds/{pending_id}/cancel",
        headers=auth(guard2),
        json={"reason": "Cierre de prueba antes de validar inactividad"},
    )
    expired = client.get("/api/v1/rounds/active", headers=auth(guard2))
    assert expired.status_code == 200, expired.text
    expired_data = expired.json()
    assert expired_data["id"] == expired_id, expired_data
    assert expired_data["status"] == "CANCELLED"
    assert expired_data["cancel_reason"] == "Cancelada por inactividad"
    assert "inactividad" in expired_data["observations"].lower()
    assert client.get("/api/v1/rounds/active", headers=auth(guard2)).json() is None
    print("10. expiración en /active OK:", expired_data["cancel_reason"])

    # --- 9. Expiración detectada al marcar un checkpoint ---
    expired_checkin_id = make_round(
        "guardia2@demo.com",
        status=RoundStatus.IN_PROGRESS,
        minutes_ago=35,
        inactive_minutes=30,
    )
    rejected = client.post(
        f"/api/v1/rounds/{expired_checkin_id}/checkin",
        headers=auth(guard2),
        json={
            "qr_code": "QR-EMP1-PT01",
            "latitude": 40.415462,
            "longitude": -3.709687,
        },
    )
    assert rejected.status_code == 409, rejected.text
    assert "inactividad" in rejected.json()["detail"].lower()
    assert "20 minutos" in rejected.json()["detail"]

    with SessionLocal() as db:
        stored = db.get(Round, expired_checkin_id)
        assert stored is not None and stored.status is RoundStatus.CANCELLED
        assert stored.cancel_reason == "Cancelada por inactividad"
        logs_count = db.query(RoundLog).filter_by(round_id=expired_checkin_id).count()
        assert logs_count == 0
    print("11. marcación rechazada por inactividad OK:", rejected.json()["detail"])

    # --- 10. Aislamiento entre guardias ---
    forbidden = client.get(
        f"/api/v1/rounds/{expired_checkin_id}/checkpoints", headers=auth(guard1)
    )
    assert forbidden.status_code == 403, forbidden.text
    print("12. aislamiento por guardia OK")

print("E2E del ciclo de vida de rondas: OK")

