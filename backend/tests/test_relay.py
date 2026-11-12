import asyncio
import json
from pathlib import Path

import httpx
import pytest
from fastapi.testclient import TestClient
from starlette.requests import Request

from app.config import Settings
from app.main import create_app
from app.relay import RelayError, handle_ai, redact_message, validate_target


KEY = "test-only-key/+?="
BASE = {
    "provider": "openai", "baseUrl": "https://api.openai.com/v1", "apiKey": KEY,
    "path": "/images/generations", "method": "POST", "body": {"model": "test-image", "prompt": "fixture"},
}
ARK = {**BASE, "provider": "ark", "baseUrl": "https://ark.cn-beijing.volces.com/api/v3", "path": "/contents/generations/tasks"}


def no_upstream(_request):
    pytest.fail("Rejected requests must not contact a provider")


def test_health_and_api_404_never_return_the_spa(tmp_path):
    (tmp_path / "index.html").write_text("<html>FRAMEOUT</html>")
    (tmp_path / "assets").mkdir()
    (tmp_path / "assets" / "app.js").write_text("export const ok = true;")
    app = create_app(Settings(frontend_dist=tmp_path), httpx.MockTransport(no_upstream))
    with TestClient(app) as client:
        assert client.get("/api/health").json() == {"status": "ok", "service": "frameout-api"}
        assert client.get("/").text == "<html>FRAMEOUT</html>"
        assert client.get("/studio/project").text == "<html>FRAMEOUT</html>"
        assert client.get("/assets/app.js").status_code == 200
        assert client.get("/assets/missing.js").status_code == 404
        for path in ["/api", "/api/unknown", "/.env", "/assets/%2e%2e/%2e%2e/secret"]:
            response = client.get(path)
            assert response.status_code == 404
            assert response.headers["content-type"].startswith("application/json")
        assert client.get("/api/ai").status_code == 405


def test_missing_build_is_clear(tmp_path):
    with TestClient(create_app(Settings(frontend_dist=tmp_path))) as client:
        assert client.get("/").json()["error"]["code"] == "FRONTEND_NOT_BUILT"


@pytest.mark.parametrize("base_url", [
    "http://api.openai.com/v1", "https://evil.example/v1", "https://api.openai.com.evil.example/v1",
    "https://api.openai.com/v1?key=123", "https://api.openai.com/v1#fragment",
    "https://user:pass@api.openai.com/v1", "https://127.0.0.1/v1", "https://api.openai.com:8443/v1",
    "https://api.openai.com/v1%2f", "https://api.openai.com/v1/../admin", [], None,
])
def test_base_url_allowlist(base_url):
    with pytest.raises(RelayError) as error:
        validate_target({**BASE, "baseUrl": base_url})
    assert error.value.code == "INVALID_BASE_URL"


def test_trailing_slash_and_provider_allowlist():
    assert validate_target({**BASE, "baseUrl": BASE["baseUrl"] + "/"}).url == BASE["baseUrl"] + BASE["path"]
    for provider in ["compatible", "__proto__", [], None]:
        with pytest.raises(RelayError):
            validate_target({**BASE, "provider": provider})
    assert KEY not in repr(validate_target(BASE))


@pytest.mark.parametrize("path", [
    "/videos", "/images/generations?x=1", "//api.openai.com/v1/models", "/images/../models",
    "/images%2fgenerations", "/contents/generations/tasks/x?url=http://127.0.0.1",
    "/contents/generations/tasks/../models", "/contents/generations/tasks/%2e%2e",
    "/contents/generations/tasks?page_size=1&x=y", "/images/edits",
])
def test_path_allowlist(path):
    with pytest.raises(RelayError):
        validate_target({**ARK, "path": path})


def test_permitted_paths_and_body_validation():
    models = {k: v for k, v in {**BASE, "path": "/models", "method": "GET"}.items() if k != "body"}
    assert validate_target(models).method == "GET"
    assert validate_target({**ARK, "path": "/images/generations"}).image
    edit = validate_target({**BASE, "path": "/images/edits"})
    assert edit.image and edit.url == "https://api.openai.com/v1/images/edits"
    for method in ["GET", "PUT"]:
        with pytest.raises(RelayError):
            validate_target({k: v for k, v in {**BASE, "path": "/images/edits", "method": method}.items() if k != "body"})
    for path in ["/contents/generations/tasks?page_size=1", "/contents/generations/tasks/cgt-123_test"]:
        query = {k: v for k, v in {**ARK, "path": path, "method": "GET"}.items() if k != "body"}
        assert validate_target(query).method == "GET"
    for envelope in [{**BASE, "method": "DELETE"}, {**models, "body": None}, {**BASE, "body": []}, [], None]:
        with pytest.raises(RelayError):
            validate_target(envelope)


@pytest.mark.parametrize("key,status", [("", 401), (None, 401), ("abc\r\nX-Test: bad", 400), ("abc def", 400), (" abc", 400), ("密钥", 400), ("a" * 4097, 400)])
def test_key_validation_never_reaches_upstream(key, status):
    with TestClient(create_app(transport=httpx.MockTransport(no_upstream))) as client:
        assert client.post("/api/ai", json={**BASE, "apiKey": key}).status_code == status


def test_origins_are_exact_and_cors_is_not_wildcard():
    with TestClient(create_app(transport=httpx.MockTransport(no_upstream))) as client:
        for headers in [{"origin": "https://evil.example"}, {"origin": "null"}, {"sec-fetch-site": "cross-site"}]:
            response = client.post("/api/ai", json=BASE, headers=headers)
            assert response.status_code == 403
            assert "access-control-allow-origin" not in response.headers
        preflight = client.options("/api/ai", headers={"origin": "http://127.0.0.1:5173", "access-control-request-method": "POST", "access-control-request-headers": "content-type"})
        assert preflight.headers["access-control-allow-origin"] == "http://127.0.0.1:5173"
        assert "access-control-allow-credentials" not in preflight.headers


def test_success_is_unchanged_single_call_and_cookies_are_never_reused():
    calls = []
    raw = b'{ "data": [{"url":"https://media.example/result.png"}], "usage":{"tokens":1} }'

    def handler(request):
        calls.append(request)
        assert str(request.url) == "https://api.openai.com/v1/images/generations"
        assert request.headers["authorization"] == "Bearer " + KEY
        assert "cookie" not in request.headers
        assert "oai-authenticated-user-id" not in request.headers
        assert json.loads(request.content) == BASE["body"]
        return httpx.Response(200, content=raw, headers={"content-type": "application/json", "set-cookie": "private=do-not-reuse; Path=/", "cache-control": "public,max-age=3600"})

    app = create_app(transport=httpx.MockTransport(handler))
    with TestClient(app) as client:
        for _ in range(2):
            response = client.post("/api/ai", json=BASE, headers={"origin": "http://127.0.0.1:5173", "cookie": "browser=secret", "authorization": "Bearer site-token", "oai-authenticated-user-id": "private-user"})
            assert response.status_code == 200
            assert response.content == raw
            assert "set-cookie" not in response.headers
            assert "no-store" in response.headers["cache-control"]
            assert response.headers["x-content-type-options"] == "nosniff"
        assert len(app.state.upstream.cookies) == 0
    assert len(calls) == 2


def test_video_query_has_no_body():
    def handler(request):
        assert request.method == "GET"
        assert request.content == b""
        assert str(request.url).endswith("/contents/generations/tasks/cgt-123")
        return httpx.Response(200, json={"id": "cgt-123", "status": "succeeded", "content": {"video_url": "https://media.example/video.mp4"}})

    query = {k: v for k, v in {**ARK, "path": "/contents/generations/tasks/cgt-123", "method": "GET"}.items() if k != "body"}
    with TestClient(create_app(transport=httpx.MockTransport(handler))) as client:
        assert client.post("/api/ai", json=query).json()["status"] == "succeeded"


@pytest.mark.parametrize("status", [301, 302, 303, 307, 308])
def test_redirect_never_follows_or_exposes_location(status):
    calls = []

    def handler(request):
        calls.append(request)
        return httpx.Response(status, headers={"location": "https://evil.example/steal"})

    with TestClient(create_app(transport=httpx.MockTransport(handler))) as client:
        response = client.post("/api/ai", json=BASE)
    assert len(calls) == 1
    assert response.status_code == 502
    assert response.json()["error"]["code"] == "UPSTREAM_REDIRECT"
    assert "location" not in response.headers


@pytest.mark.parametrize("status", [401, 403, 429, 503])
def test_provider_errors_redact_plain_and_url_encoded_keys(status):
    from urllib.parse import quote
    calls = []

    def handler(request):
        calls.append(request)
        return httpx.Response(status, json={"error": {"message": f"bad key {KEY}\nretry {quote(KEY, safe='')}"}})

    with TestClient(create_app(transport=httpx.MockTransport(handler))) as client:
        response = client.post("/api/ai", json=BASE)
    assert len(calls) == 1
    assert response.status_code == status
    assert KEY not in response.text
    assert quote(KEY, safe="") not in response.text
    assert "已隐藏" in response.text
    assert redact_message(f" {KEY}\n{KEY} ", KEY) == "[已隐藏] [已隐藏]"


@pytest.mark.parametrize("kind", ["network", "unexpected", "html", "fake-json"])
def test_bad_responses_do_not_echo_secrets(kind):
    def handler(request):
        if kind == "network":
            raise httpx.ConnectError(f"private infrastructure {KEY}", request=request)
        if kind == "unexpected":
            raise RuntimeError(f"private infrastructure {KEY}")
        return httpx.Response(200, content=f"<html>{KEY}</html>", headers={"content-type": "text/html" if kind == "html" else "application/json"})

    with TestClient(create_app(transport=httpx.MockTransport(handler))) as client:
        response = client.post("/api/ai", json=BASE)
    assert response.status_code == 502
    assert KEY not in response.text
    assert "private infrastructure" not in response.text


def test_body_limits_check_declared_and_actual_size():
    with TestClient(create_app(Settings(request_limit=1000), httpx.MockTransport(no_upstream))) as client:
        assert client.post("/api/ai", content="{}", headers={"content-type": "text/plain"}).status_code == 415
        assert client.post("/api/ai", content="{", headers={"content-type": "application/json"}).json()["error"]["code"] == "INVALID_JSON"
        for invalid in ["{\"body\":NaN}", "{\"body\":Infinity}", "{\"body\":{\"x\":1e10000}}"]:
            assert client.post("/api/ai", content=invalid, headers={"content-type": "application/json"}).status_code == 400
        assert client.post("/api/ai", json=BASE, headers={"content-length": "1001"}).status_code == 413
        assert client.post("/api/ai", json=BASE, headers={"content-length": "-1"}).status_code == 400
        assert client.post("/api/ai", json={**BASE, "body": {"prompt": "a" * 1001}}, headers={"content-length": "1"}).status_code == 413


@pytest.mark.parametrize("declared", [False, True])
def test_response_limits_check_declared_and_actual_size(declared):
    def handler(_request):
        return httpx.Response(200, content=b"{}" if declared else b"a" * 1001, headers={"content-type": "application/json", **({"content-length": "1001"} if declared else {})})

    with TestClient(create_app(Settings(response_limit=1000), httpx.MockTransport(handler))) as client:
        response = client.post("/api/ai", json=BASE)
    assert response.status_code == 502
    assert response.json()["error"]["code"] == "UPSTREAM_RESPONSE_TOO_LARGE"


def test_timeout_cancels_upstream_without_repeating_paid_post():
    calls = []
    cancelled = []

    async def handler(request):
        calls.append(request)
        try:
            await asyncio.sleep(100)
        except asyncio.CancelledError:
            cancelled.append(True)
            raise

    with TestClient(create_app(Settings(image_timeout=0.02), httpx.MockTransport(handler))) as client:
        response = client.post("/api/ai", json=BASE)
    assert response.status_code == 504
    assert len(calls) == 1
    assert cancelled == [True]
    assert "未自动重试" in response.json()["error"]["message"]


def test_client_disconnect_cancels_inflight_request():
    async def run():
        start = asyncio.Event()
        cancelled = []
        calls = []
        body_read = False

        async def receive():
            nonlocal body_read
            if not body_read:
                body_read = True
                return {"type": "http.request", "body": json.dumps(BASE).encode(), "more_body": False}
            await start.wait()
            return {"type": "http.disconnect"}

        async def handler(request):
            calls.append(request)
            start.set()
            try:
                await asyncio.sleep(100)
            except asyncio.CancelledError:
                cancelled.append(True)
                raise

        request = Request({"type": "http", "method": "POST", "path": "/api/ai", "headers": [(b"content-type", b"application/json")]}, receive)
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            response = await handle_ai(request, client, Settings())
        assert response.status_code == 499
        assert len(calls) == 1
        assert cancelled == [True]

    asyncio.run(run())


def test_environment_only_adds_exact_origins(monkeypatch):
    monkeypatch.setenv("FRAMEOUT_ALLOWED_ORIGINS", "https://frameout.example,http://localhost:5199")
    assert "https://frameout.example" in Settings.from_env().allowed_origins
    monkeypatch.setenv("FRAMEOUT_ALLOWED_ORIGINS", "https://*.example")
    with pytest.raises(ValueError):
        Settings.from_env()
