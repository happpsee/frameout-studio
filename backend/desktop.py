"""Run the desktop relay and bundled UI on a private loopback port."""

from dataclasses import replace
import os
from pathlib import Path
import socket
import sys
from threading import Thread
from time import sleep

from starlette.middleware.trustedhost import TrustedHostMiddleware
import uvicorn

from app.config import Settings
from app.main import create_app


class DesktopServer(uvicorn.Server):
    async def startup(self, sockets=None):
        await super().startup(sockets=sockets)
        if self.started:
            print(f"FRAMEOUT_READY http://127.0.0.1:{self.config.port}", flush=True)


def watch_parent(server: DesktopServer, pid: int):
    while not server.should_exit:
        sleep(1)
        try:
            os.kill(pid, 0)
        except ProcessLookupError:
            server.should_exit = True


def main():
    if getattr(sys, "frozen", False) and not (os.environ.get("SSL_CERT_FILE") or os.environ.get("SSL_CERT_DIR")):
        os.environ["SSL_CERT_FILE"] = str(Path(sys._MEIPASS) / "certifi" / "cacert.pem")
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as listener:
        listener.bind(("127.0.0.1", 0))
        host, port = listener.getsockname()
        settings = replace(Settings.from_env(), allowed_origins=frozenset({f"http://{host}:{port}"}))
        app = create_app(settings)
        app.add_middleware(TrustedHostMiddleware, allowed_hosts=[host])
        server = DesktopServer(uvicorn.Config(
            app, host=host, port=port, loop="asyncio", http="h11", ws="none",
            lifespan="on", proxy_headers=False, log_level="warning", timeout_graceful_shutdown=2,
        ))
        parent = os.environ.get("FRAMEOUT_PARENT_PID", "")
        if os.name == "posix" and parent.isdecimal() and int(parent) > 1:
            Thread(target=watch_parent, args=(server, int(parent)), daemon=True).start()
        server.run(sockets=[listener])


if __name__ == "__main__":
    main()
