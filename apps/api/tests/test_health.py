from fastapi.testclient import TestClient

from frameout_api.main import create_app


def test_health() -> None:
    client = TestClient(create_app())
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_openapi_describes_health() -> None:
    schema = create_app().openapi()
    assert "/health" in schema["paths"]
