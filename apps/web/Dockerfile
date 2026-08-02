# syntax=docker/dockerfile:1
#
# Build context is the repo root — the web app transpiles @da3wa/shared from source.

FROM node:22-alpine AS base
WORKDIR /app
RUN apk add --no-cache tini
ENTRYPOINT ["/sbin/tini", "--"]

# ── Dependencies ─────────────────────────────────────────────────────────────
FROM base AS deps
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/web/package.json apps/web/
COPY apps/api/package.json apps/api/
RUN npm ci --workspace @da3wa/web --workspace @da3wa/shared --include-workspace-root

# ── Development (used by docker-compose) ─────────────────────────────────────
FROM deps AS development
ENV NODE_ENV=development
COPY . .
EXPOSE 3000
CMD ["npm", "-w", "@da3wa/web", "run", "dev"]

# ── Build ────────────────────────────────────────────────────────────────────
FROM deps AS build
ENV NEXT_TELEMETRY_DISABLED=1

# Next inlines every NEXT_PUBLIC_* value into the client bundle at BUILD time,
# so this cannot be supplied as a runtime environment variable — setting it in
# .env after the image exists has no effect whatsoever. Left at the default in
# production, guests' browsers would request http://localhost:4000 for the QR
# image and the RSVP POST, and both would fail.
ARG NEXT_PUBLIC_API_URL=http://localhost:4000
ENV NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL}

COPY . .
RUN npm -w @da3wa/web run build

# ── Production ───────────────────────────────────────────────────────────────
FROM base AS production
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0

# `output: 'standalone'` emits a server plus exactly the node_modules it needs,
# so nothing is installed in this stage.
COPY --from=build /app/apps/web/.next/standalone ./
COPY --from=build /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=build /app/apps/web/public ./apps/web/public

USER node
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:3000/ar').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "apps/web/server.js"]
