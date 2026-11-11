"""Server configuration. Provider credentials are deliberately absent."""

from dataclasses import dataclass, field
import os
from pathlib import Path
from urllib.parse import urlsplit


LOCAL_ORIGINS = frozenset({
    "http://localhost:5173", "http://127.0.0.1:5173",
    "http://localhost:8000", "http://127.0.0.1:8000",
})


@dataclass(frozen=True)
class Settings:
    allowed_origins: frozenset[str] = LOCAL_ORIGINS
    frontend_dist: Path = field(default_factory=lambda: Path(__file__).resolve().parents[2] / "frontend" / "dist")
    request_limit: int = 16 * 1024 * 1024
    response_limit: int = 32 * 1024 * 1024
    image_timeout: float = 300
    query_timeout: float = 90

    @classmethod
    def from_env(cls) -> "Settings":
        origins = set(LOCAL_ORIGINS)
        for value in os.environ.get("FRAMEOUT_ALLOWED_ORIGINS", "").split(","):
            origin = value.strip().rstrip("/")
            if not origin:
                continue
            parsed = urlsplit(origin)
            if parsed.scheme not in {"http", "https"} or not parsed.netloc or parsed.username or parsed.password or parsed.path or parsed.query or parsed.fragment or "*" in origin:
                raise ValueError("FRAMEOUT_ALLOWED_ORIGINS must contain exact http(s) origins")
            origins.add(origin)
        configured_dist = os.environ.get("FRAMEOUT_FRONTEND_DIST")
        return cls(allowed_origins=frozenset(origins), **({"frontend_dist": Path(configured_dist).resolve()} if configured_dist else {}))
