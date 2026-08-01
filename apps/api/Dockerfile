# syntax=docker/dockerfile:1
#
# Build context is the repo root, not apps/api — the API imports @da3wa/shared
# as TypeScript source, so the workspace has to be present.

FROM node:22-alpine AS base
WORKDIR /app
# openssl: required by Prisma's query engine.
# tini:    reaps zombies and forwards signals to PID 1, so SIGTERM reaches the
#          graceful-shutdown handler in src/index.ts.
RUN apk add --no-cache openssl tini
ENTRYPOINT ["/sbin/tini", "--"]

# ── Dependencies ─────────────────────────────────────────────────────────────
# Only manifests are copied here, so a source-only change reuses this layer.
FROM base AS deps
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN npm ci --workspace @da3wa/api --workspace @da3wa/shared --include-workspace-root

# ── Development (used by docker-compose) ─────────────────────────────────────
FROM deps AS development
ENV NODE_ENV=development
COPY . .
RUN npx prisma generate --schema=apps/api/prisma/schema.prisma
EXPOSE 4000
CMD ["npm", "-w", "@da3wa/api", "run", "dev"]

# ── Build ────────────────────────────────────────────────────────────────────
FROM deps AS build
COPY . .
RUN npx prisma generate --schema=apps/api/prisma/schema.prisma
RUN npm -w @da3wa/api run build

# ── Production ───────────────────────────────────────────────────────────────
FROM base AS production
ENV NODE_ENV=production

COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
RUN npm ci --omit=dev --workspace @da3wa/api --workspace @da3wa/shared --include-workspace-root \
    && npm cache clean --force

# The generated client is produced at build time and cannot be reinstalled by
# npm — it is emitted into node_modules by `prisma generate`.
COPY --from=build /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=build /app/apps/api/dist ./apps/api/dist
# Migrations ship with the image so a deploy can apply them itself.
COPY --from=build /app/apps/api/prisma ./apps/api/prisma

USER node
EXPOSE 4000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:4000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# Migrations run before the server accepts traffic. `migrate deploy` only applies
# committed migrations and never prompts, unlike `migrate dev`.
CMD ["sh", "-c", "npx prisma migrate deploy --schema=apps/api/prisma/schema.prisma && node apps/api/dist/index.js"]
