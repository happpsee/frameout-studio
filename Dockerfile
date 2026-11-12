FROM node:22-bookworm-slim AS frontend-build
WORKDIR /build
RUN npm install -g pnpm@11.21.0 --no-audit --no-fund
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY frontend/package.json ./frontend/package.json
RUN ELECTRON_SKIP_BINARY_DOWNLOAD=1 pnpm install --frozen-lockfile
COPY frontend ./frontend
RUN pnpm build

# The server has no npm dependencies: it needs only Node, its own files and the built UI.
FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8000 \
    FRAMEOUT_FRONTEND_DIST=/app/frontend/dist
WORKDIR /app
COPY --chown=10001:10001 server ./server
COPY --from=frontend-build --chown=10001:10001 /build/frontend/dist ./frontend/dist
USER 10001:10001
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:8000/api/health').then(r => r.json()).then(j => process.exit(j.status === 'ok' ? 0 : 1), () => process.exit(1))"]
CMD ["node", "server/index.cjs"]
