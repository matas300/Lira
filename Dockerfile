# ────────────────────────────────────────────────────────────────────────────
# Lira — Dockerfile multi-stage per Fly.io (shared-1x-cpu @ 512MB)
# ────────────────────────────────────────────────────────────────────────────

# Stage 1: build
FROM node:22-alpine AS builder
WORKDIR /app

# Argon2 needs build tools
RUN apk add --no-cache python3 make g++

COPY package.json package-lock.json* ./
RUN npm ci --no-audit --no-fund

COPY tsconfig.json tsconfig.server.json vite.config.ts drizzle.config.ts ./
COPY src ./src
COPY public ./public
COPY drizzle ./drizzle

RUN npm run build

# Prune dev deps
RUN npm prune --omit=dev

# Stage 2: runtime
FROM node:22-alpine AS runner
WORKDIR /app

# argon2 native bindings — keep libc deps
RUN apk add --no-cache libstdc++ tini

ENV NODE_ENV=production
ENV PORT=8080

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/drizzle ./drizzle

EXPOSE 8080

ENTRYPOINT ["/sbin/tini", "--"]
# Migrazioni Drizzle (legge ./drizzle) prima di avviare il server.
CMD ["sh", "-c", "node dist/server/migrate.js && node dist/server/index.js"]
