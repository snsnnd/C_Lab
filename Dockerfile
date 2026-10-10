# syntax=docker/dockerfile:1

FROM node:22-bookworm-slim AS build
WORKDIR /app

# tree-sitter-c may need a native build when no prebuilt binary is available.
# The compiler and all npm dependencies stay out of the runtime image.
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8000 \
    STATIC_ROOT=/app/dist \
    DISCOVER_LAN=0

# The server uses only Node built-ins; no runtime node_modules are needed.
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/server/serve.mjs ./server/serve.mjs
USER node
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:' + process.env.PORT + '/api/health', {signal: AbortSignal.timeout(3000)}).then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"
CMD ["node", "server/serve.mjs"]
