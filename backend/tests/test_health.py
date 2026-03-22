"""Tests for the /health endpoint and basic route registration."""


def test_health_returns_200(client):
    """GET /health should return 200 with {"status": "ok"}."""
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_all_expected_routes_exist(client):
    """All core routes (/health, /task, /events) must be registered.
    Note: /transcribe was removed — STT is now frontend-direct via ElevenLabs/Groq."""
    from backend.main import app

    route_paths = {route.path for route in app.routes}
    expected = {"/health", "/task", "/events"}
    for path in expected:
        assert path in route_paths, f"Expected route {path} not found in app routes"


def test_health_returns_json_content_type(client):
    """GET /health should return application/json content type."""
    response = client.get("/health")
    assert "application/json" in response.headers["content-type"]
