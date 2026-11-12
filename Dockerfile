FROM node:22-bookworm-slim AS build
WORKDIR /build
RUN npm install -g pnpm@11.21.0 --no-audit --no-fund
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json tsconfig.base.json ./
COPY apps/web/package.json apps/web/
COPY apps/server/package.json apps/server/
COPY packages/shared/package.json packages/shared/
# Only the web UI, the server and what they depend on; the desktop app (Electron) is skipped.
RUN pnpm install --frozen-lockfile --filter '@frameout/web...' --filter '@frameout/server...'
COPY packages/shared packages/shared
COPY apps/web apps/web
COPY apps/server apps/server
RUN pnpm --filter @frameout/web build && pnpm --filter @frameout/server build

# The server bundle includes Express, so the runtime needs only Node, one file and the built UI.
FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8000 \
    FRAMEOUT_FRONTEND_DIST=/app/frontend/dist
WORKDIR /app
COPY --from=build --chown=10001:10001 /build/apps/server/dist/index.cjs ./server/index.cjs
COPY --from=build --chown=10001:10001 /build/apps/web/dist ./frontend/dist
USER 10001:10001
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:8000/api/health').then(r => r.json()).then(j => process.exit(j.status === 'ok' ? 0 : 1), () => process.exit(1))"]
CMD ["node", "server/index.cjs"]
