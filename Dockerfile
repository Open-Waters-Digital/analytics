# syntax=docker/dockerfile:1.7

# =============================================================================
# Open Waters Analytics: multi-stage production image.
#
# deps -> build -> runtime. Source-only changes reuse the cached dependency
# layer. The runtime stage carries Next's standalone server (only the traced
# files it needs), the static assets, the bundled migration script and the
# migration SQL. No source, no dev tooling, no package manager.
#
# No `RUN --mount=type=cache`: Railway rejects cache mounts whose id is not
# `s/<service id>-<path>`, and forbids variables in that id. See the same note
# in radara/Dockerfile.
# =============================================================================

ARG NODE_VERSION=22.22.3
ARG PNPM_VERSION=11.5.2

FROM node:${NODE_VERSION}-slim AS base
ARG PNPM_VERSION
ENV PNPM_HOME="/pnpm" \
    PATH="/pnpm:$PATH" \
    CI=true \
    NEXT_TELEMETRY_DISABLED=1
RUN corepack enable && corepack prepare pnpm@${PNPM_VERSION} --activate
WORKDIR /app

# -----------------------------------------------------------------------------
# Dependencies: manifests only, so this layer is cached until they change.
# -----------------------------------------------------------------------------
FROM base AS deps
# Reads @open-waters-digital/analytics from GitHub Packages (see .npmrc).
# Declared in this stage only. Railway has no BuildKit secret mounts and passes
# service variables as build arguments, which a stage's history records, so the
# token stays in the stage that installs and the runtime stage never sees it.
ARG NODE_AUTH_TOKEN
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
RUN pnpm install --frozen-lockfile

# -----------------------------------------------------------------------------
# Build. There are no NEXT_PUBLIC_* values yet; when one is added it must be a
# build ARG here too, because Next inlines it into the client bundle at build
# time. Server secrets are never passed to the build.
# -----------------------------------------------------------------------------
FROM base AS build
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN pnpm run build

# -----------------------------------------------------------------------------
# Runtime. The standalone output already contains the production node_modules
# it traced, so there is no separate prod-deps install stage.
# -----------------------------------------------------------------------------
FROM node:${NODE_VERSION}-slim AS runtime
WORKDIR /app

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0 \
    PORT=3000

COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
COPY --from=build --chown=node:node /app/public ./public
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/drizzle ./drizzle

# `node` (uid 1000) ships with the base image.
USER node

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# Exec form: node is PID 1 and receives SIGTERM directly.
CMD ["node", "server.js"]
