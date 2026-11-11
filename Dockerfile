FROM node:22-bookworm-slim AS frontend-build
WORKDIR /build
COPY package.json package-lock.json ./
COPY frontend/package.json ./frontend/package.json
RUN ELECTRON_SKIP_BINARY_DOWNLOAD=1 npm ci --no-audit --no-fund
COPY frontend ./frontend
RUN npm run build

FROM python:3.12-slim-bookworm AS runtime
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    FRAMEOUT_FRONTEND_DIST=/app/frontend/dist
WORKDIR /app
COPY backend/requirements.lock /tmp/requirements.lock
# Keep the tested dependency pins; omit packages used only by pytest.
RUN python -c "from pathlib import Path; excluded={'pytest','pluggy','iniconfig','pygments'}; lines=Path('/tmp/requirements.lock').read_text().splitlines(); Path('/tmp/runtime-requirements.txt').write_text('\n'.join(line for line in lines if line.split('==',1)[0].lower() not in excluded)+'\n')" \
    && python -m pip install -r /tmp/runtime-requirements.txt \
    && useradd --uid 10001 --user-group --no-create-home --shell /usr/sbin/nologin frameout
COPY --chown=10001:10001 backend/app ./backend/app
COPY --from=frontend-build --chown=10001:10001 /build/frontend/dist ./frontend/dist
USER 10001:10001
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD python -c "import json,urllib.request; r=urllib.request.urlopen('http://127.0.0.1:8000/api/health',timeout=3); assert json.load(r)['status']=='ok'"
CMD ["python", "-m", "uvicorn", "app.main:app", "--app-dir", "backend", "--host", "0.0.0.0", "--port", "8000", "--proxy-headers", "--forwarded-allow-ips=*"]
