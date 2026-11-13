"""帧外后端的 FastAPI 应用。

只供 BFF（apps/server）在内网调用，不直接对浏览器开放。
账号、项目、Key 保险箱、任务和用量接口从第 3 期起逐步加入。
"""

from typing import Literal

from fastapi import FastAPI
from pydantic import BaseModel


class Health(BaseModel):
    status: Literal["ok"]


def create_app() -> FastAPI:
    app = FastAPI(title="FRAMEOUT API", version="2.0.0")

    @app.get("/health")
    def health() -> Health:
        return Health(status="ok")

    return app


app = create_app()
