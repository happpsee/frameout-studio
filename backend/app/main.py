from contextlib import asynccontextmanager
from http.cookiejar import CookieJar, DefaultCookiePolicy
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from starlette.exceptions import HTTPException
from starlette.responses import FileResponse
import httpx

from .config import Settings
from .relay import failure, handle_ai


class NoCookies(DefaultCookiePolicy):
    """A shared connection pool must not share provider cookies between users."""

    def set_ok(self, cookie, request):
        return False

    def return_ok(self, cookie, request):
        return False


def create_app(settings: Settings | None = None, transport: httpx.AsyncBaseTransport | None = None) -> FastAPI:
    config = settings or Settings.from_env()

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        # httpx performs no automatic retries; never replay a paid generation POST.
        async with httpx.AsyncClient(transport=transport, cookies=CookieJar(policy=NoCookies()), follow_redirects=False, timeout=httpx.Timeout(connect=15, read=config.image_timeout, write=30, pool=15)) as client:
            app.state.upstream = client
            yield

    app = FastAPI(title="FRAMEOUT API", version="1.0.0", lifespan=lifespan)
    app.add_middleware(CORSMiddleware, allow_origins=sorted(config.allowed_origins), allow_methods=["GET", "POST"], allow_headers=["Content-Type"], allow_credentials=False)

    @app.exception_handler(HTTPException)
    async def http_error(_request: Request, error: HTTPException):
        if error.status_code == 405:
            return failure(405, "METHOD_NOT_ALLOWED", "不支持此请求方式")
        return failure(error.status_code, "NOT_FOUND" if error.status_code == 404 else "REQUEST_FAILED", "接口或文件不存在" if error.status_code == 404 else "请求失败")

    @app.get("/api/health")
    async def health():
        return {"status": "ok", "service": "frameout-api"}

    @app.post("/api/ai")
    async def ai(request: Request):
        return await handle_ai(request, app.state.upstream, config)

    @app.api_route("/api/ai", methods=["GET", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"], include_in_schema=False)
    async def unsupported_ai():
        return failure(405, "METHOD_NOT_ALLOWED", "请使用 POST 请求")

    @app.api_route("/api", methods=["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"], include_in_schema=False)
    @app.api_route("/api/{path:path}", methods=["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"], include_in_schema=False)
    async def unknown_api(path: str = ""):
        return failure(404, "NOT_FOUND", "接口不存在")

    @app.get("/{path:path}", include_in_schema=False)
    async def frontend(path: str):
        directory = config.frontend_dist.resolve()
        # Resolve before returning any file, and never expose hidden build files.
        target = (directory / path).resolve()
        if not target.is_relative_to(directory) or any(part.startswith(".") for part in Path(path).parts):
            return failure(404, "NOT_FOUND", "文件不存在")
        if path and target.is_file():
            return FileResponse(target)
        index = directory / "index.html"
        if index.is_file() and (not path or not Path(path).suffix):
            return FileResponse(index, headers={"cache-control": "no-cache"})
        return failure(404, "FRONTEND_NOT_BUILT" if not index.is_file() else "NOT_FOUND", "前端尚未构建，请先运行 npm run build" if not index.is_file() else "文件不存在")

    return app


app = create_app()
