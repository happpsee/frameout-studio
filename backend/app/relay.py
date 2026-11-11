"""A bounded, request-scoped relay for the two supported official providers.

Do not log envelopes or upstream exceptions: they may contain the caller's key.
No redirects, retries, cookies, incoming authorization headers, or response cache.
"""

import asyncio
from dataclasses import dataclass
import json
import math
import re
from typing import Any
from urllib.parse import quote

import httpx
from fastapi import Request
from starlette.requests import ClientDisconnect
from starlette.responses import JSONResponse, Response

from .config import Settings


BASES = {
    "openai": "https://api.openai.com/v1",
    "ark": "https://ark.cn-beijing.volces.com/api/v3",
}
SAFE_HEADERS = {
    "cache-control": "no-store, max-age=0",
    "pragma": "no-cache",
    "x-content-type-options": "nosniff",
}
JSON_CONTENT = re.compile(r"^application/(?:json|[A-Za-z0-9!#$&^_.+\-]+\+json)(?:\s*;|$)", re.I)


class RelayError(Exception):
    def __init__(self, status: int, code: str, message: str):
        super().__init__(message)
        self.status, self.code, self.message = status, code, message


def failure(status: int, code: str, message: str) -> JSONResponse:
    return JSONResponse({"error": {"code": code, "message": message}}, status_code=status, headers=SAFE_HEADERS)


def redact_message(value: Any, api_key: str = "") -> str:
    message = value if isinstance(value, str) else ""
    if api_key:
        for secret in {api_key, quote(api_key, safe="~()*!.'-")}:
            message = message.replace(secret, "[已隐藏]")
    return re.sub(r"[\x00-\x1f\x7f]", " ", message).strip()[:400]


@dataclass(frozen=True, repr=False)
class Target:
    url: str
    api_key: str
    method: str = "POST"
    body: dict[str, Any] | None = None
    image: bool = False


def validate_target(envelope: Any) -> Target:
    if not isinstance(envelope, dict):
        raise RelayError(400, "INVALID_REQUEST", "请求格式不正确")
    provider = envelope.get("provider")
    if not isinstance(provider, str) or provider not in BASES:
        raise RelayError(400, "UNSUPPORTED_PROVIDER", "此转发仅支持 OpenAI 和火山方舟官方接口")
    base_url = envelope.get("baseUrl")
    if not isinstance(base_url, str) or base_url not in {BASES[provider], BASES[provider] + "/"}:
        raise RelayError(400, "INVALID_BASE_URL", "转发地址必须是所选供应商的官方 Base URL；自定义接口请使用浏览器直连")
    key = envelope.get("apiKey")
    if not isinstance(key, str) or not key:
        raise RelayError(401, "MISSING_API_KEY", "请先填写 API Key")
    if len(key) > 4096 or re.search(r"[^\x21-\x7e]", key):
        raise RelayError(400, "INVALID_API_KEY", "API Key 不能包含空白或控制字符")
    path, method = envelope.get("path"), envelope.get("method")
    if not isinstance(path, str) or method not in ("GET", "POST"):
        raise RelayError(400, "INVALID_OPERATION", "不支持此接口或请求方式")
    allowed = method == "POST" and path == "/images/generations"
    if provider == "openai":
        allowed |= method == "GET" and path == "/models"
    else:
        allowed |= method == "POST" and path == "/contents/generations/tasks"
        allowed |= method == "GET" and (path == "/contents/generations/tasks?page_size=1" or bool(re.fullmatch(r"/contents/generations/tasks/[A-Za-z0-9_-]{1,160}", path)))
    if not allowed:
        raise RelayError(400, "INVALID_OPERATION", "不支持此接口或请求方式")
    if method == "GET" and "body" in envelope:
        raise RelayError(400, "INVALID_BODY", "查询请求不能包含请求正文")
    body = envelope.get("body")
    if method == "POST" and not isinstance(body, dict):
        raise RelayError(400, "INVALID_BODY", "生成请求正文必须是 JSON 对象")
    return Target(BASES[provider] + path, key, method, body, path == "/images/generations")


def check_length(value: str | None, limit: int, upstream: bool = False) -> None:
    if value is None:
        return
    if not re.fullmatch(r"[0-9]+", value):
        raise RelayError(502 if upstream else 400, "UPSTREAM_INVALID_RESPONSE" if upstream else "INVALID_LENGTH", "数据长度格式不正确")
    # Compare digit length before conversion to avoid pathological integer strings.
    normalized = value.lstrip("0") or "0"
    if len(normalized) > len(str(limit)) or int(normalized) > limit:
        raise RelayError(502 if upstream else 413, "UPSTREAM_RESPONSE_TOO_LARGE" if upstream else "BODY_TOO_LARGE", "供应商响应过大，本站无法接收" if upstream else "数据过大，请减小图片或请求大小后重试")


async def read_envelope(request: Request, settings: Settings) -> Any:
    if not JSON_CONTENT.match(request.headers.get("content-type", "")):
        raise RelayError(415, "INVALID_CONTENT_TYPE", "请使用 application/json 请求")
    check_length(request.headers.get("content-length"), settings.request_limit)
    data = bytearray()
    async for chunk in request.stream():
        if len(data) + len(chunk) > settings.request_limit:
            raise RelayError(413, "BODY_TOO_LARGE", "数据过大，请减小图片或请求大小后重试")
        data.extend(chunk)
    try:
        def invalid_constant(_value: str):
            raise ValueError("Non-finite JSON number")
        def finite_float(value: str):
            result = float(value)
            if not math.isfinite(result):
                raise ValueError("Non-finite JSON number")
            return result
        return json.loads(data.decode("utf-8"), parse_constant=invalid_constant, parse_float=finite_float)
    except (UnicodeDecodeError, ValueError, RecursionError):
        raise RelayError(400, "INVALID_JSON", "请求正文不是有效的 JSON") from None


async def forward(target: Target, client: httpx.AsyncClient, settings: Settings) -> Response:
    # Only these headers are created; browser cookies and site authorization stay local.
    # Escaped Unicode also handles a JSON string containing an isolated surrogate;
    # don't let a serialization error expose request details in a traceback.
    kwargs = {"content": json.dumps(target.body, ensure_ascii=True, allow_nan=False, separators=(",", ":")).encode("ascii")} if target.method == "POST" else {}
    async with client.stream(target.method, target.url, headers={"authorization": f"Bearer {target.api_key}", "content-type": "application/json"}, follow_redirects=False, **kwargs) as upstream:
        if upstream.is_redirect:
            return failure(502, "UPSTREAM_REDIRECT", "供应商返回了重定向，本站未继续转发")
        if not JSON_CONTENT.match(upstream.headers.get("content-type", "")):
            return failure(502, "UPSTREAM_INVALID_RESPONSE", "供应商未返回有效的 JSON 数据")
        check_length(upstream.headers.get("content-length"), settings.response_limit, upstream=True)
        data = bytearray()
        async for chunk in upstream.aiter_bytes():
            if len(data) + len(chunk) > settings.response_limit:
                raise RelayError(502, "UPSTREAM_RESPONSE_TOO_LARGE", "供应商响应过大，本站无法接收")
            data.extend(chunk)
        try:
            payload = json.loads(data)
        except (ValueError, RecursionError):
            return failure(502, "UPSTREAM_INVALID_RESPONSE", "供应商未返回有效的 JSON 数据")
        if not upstream.is_success:
            message = ""
            if isinstance(payload, dict):
                error = payload.get("error")
                message = redact_message(error.get("message") if isinstance(error, dict) else payload.get("message"), target.api_key)
            status = upstream.status_code if 400 <= upstream.status_code <= 599 else 502
            return failure(status, f"UPSTREAM_{upstream.status_code}", f"供应商请求失败：{message}" if message else f"供应商请求失败（HTTP {upstream.status_code}）")
        return Response(bytes(data), status_code=upstream.status_code, headers=SAFE_HEADERS, media_type="application/json")


async def wait_for_disconnect(request: Request) -> None:
    # read_envelope has consumed the body. Wait on the next ASGI disconnect event
    # rather than polling or buffering a second copy of the body.
    while True:
        if (await request.receive())["type"] == "http.disconnect":
            return


async def handle_ai(request: Request, client: httpx.AsyncClient, settings: Settings) -> Response:
    origin = request.headers.get("origin")
    if (origin is not None and origin not in settings.allowed_origins) or (origin is None and request.headers.get("sec-fetch-site", "").lower() == "cross-site"):
        return failure(403, "CROSS_ORIGIN_BLOCKED", "只允许从已配置的前端地址发起请求")
    try:
        target = validate_target(await read_envelope(request, settings))
    except ClientDisconnect:
        return failure(499, "REQUEST_ABORTED", "请求已停止")
    except RelayError as error:
        return failure(error.status, error.code, error.message)
    upstream_task = asyncio.create_task(forward(target, client, settings))
    disconnect_task = asyncio.create_task(wait_for_disconnect(request))
    try:
        done, _ = await asyncio.wait({upstream_task, disconnect_task}, timeout=settings.image_timeout if target.image else settings.query_timeout, return_when=asyncio.FIRST_COMPLETED)
        if disconnect_task in done:
            return failure(499, "REQUEST_ABORTED", "请求已停止")
        if upstream_task not in done:
            return failure(504, "UPSTREAM_TIMEOUT", "供应商响应超时，未自动重试；已提交的生成请求可能仍在处理中")
        return await upstream_task
    except RelayError as error:
        return failure(error.status, error.code, error.message)
    except httpx.TimeoutException:
        return failure(504, "UPSTREAM_TIMEOUT", "供应商响应超时，未自动重试；已提交的生成请求可能仍在处理中")
    except httpx.HTTPError:
        return failure(502, "UPSTREAM_UNAVAILABLE", "无法连接供应商，请检查接口状态后重试")
    except Exception:
        # Upstream libraries can attach request objects (and keys) to exceptions.
        # Keep unexpected upstream failures opaque instead of logging or echoing.
        return failure(502, "UPSTREAM_UNAVAILABLE", "无法连接供应商，请检查接口状态后重试")
    finally:
        for task in (upstream_task, disconnect_task):
            if not task.done():
                task.cancel()
        await asyncio.gather(upstream_task, disconnect_task, return_exceptions=True)
