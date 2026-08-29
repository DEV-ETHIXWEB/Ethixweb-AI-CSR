# Multi-stage production image for @ethixweb/core-api.
#
# Build from the MONOREPO ROOT (not this directory) — this Dockerfile needs
# the full pnpm workspace to resolve `workspace:*` deps on
# @ethixweb/database and @ethixweb/shared-kernel:
#
#   docker build -f apps/core-api/Dockerfile -t ethixweb/core-api .
#
# Uses `turbo prune` (docs/10-deployment-cicd.md's documented build step) to
# produce a minimal, correctly-scoped subset of the monorepo for this one
# app before installing/building — the standard pattern for a
# pnpm+Turborepo monorepo, not a repo-specific invention.
#
# node:22-slim (Debian), not -alpine: Prisma's query-engine binary has
# well-documented OpenSSL/musl compatibility gotchas on Alpine; slim avoids
# that class of problem entirely for a modest size cost. Written but NOT
# `docker build`-verified in this environment (no Docker daemon available
# here — see docs/34-staging-environment-checklist.md) — review before
# first real build, and see docs/25-service-credential-provisioning.md /
# docs/08-security-observability-reliability.md §1.2 for how the runtime
# environment variables this image expects (DATABASE_URL, REDIS_URL,
# JWT_*_SECRET, INTEGRATION_CREDENTIALS_MASTER_KEY, ...) must be injected —
# never baked into the image.

FROM node:22-slim AS base
RUN corepack enable

FROM base AS pruner
WORKDIR /repo
COPY . .
RUN npx turbo prune @ethixweb/core-api --docker

FROM base AS installer
WORKDIR /repo
# Prisma's downloaded query-engine binary needs libssl at generate time too,
# not just at runtime.
RUN apt-get update && apt-get install -y --no-install-recommends openssl \
    && rm -rf /var/lib/apt/lists/*
COPY --from=pruner /repo/out/json/ .
COPY --from=pruner /repo/out/pnpm-lock.yaml ./pnpm-lock.yaml
COPY --from=pruner /repo/pnpm-workspace.yaml ./pnpm-workspace.yaml
# `turbo prune --docker` does NOT copy root-level files a pruned package's
# tsconfig.json `extends` — confirmed by actually running the install+build
# sequence locally against a real `turbo prune` output before trusting this
# Dockerfile; every package's tsconfig.json extends this one relatively.
COPY --from=pruner /repo/tsconfig.base.json ./tsconfig.base.json
RUN pnpm install --frozen-lockfile
COPY --from=pruner /repo/out/full/ .
# The generated Prisma client is what apps/core-api/src/shared/prisma/prisma.service.ts
# imports via @ethixweb/database — must exist before the build (typecheck
# needs its generated types) and must be present in node_modules when copied
# into the runner stage below (it lands inside node_modules, not dist).
RUN pnpm --filter @ethixweb/database run generate
RUN npx turbo run build --filter=@ethixweb/core-api

FROM base AS runner
WORKDIR /repo
RUN apt-get update && apt-get install -y --no-install-recommends openssl \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --system --gid 1001 ethixweb \
    && useradd --system --uid 1001 --gid ethixweb runtime
COPY --from=installer /repo .
USER runtime
ENV NODE_ENV=production
EXPOSE 3000
# Fails closed at startup (env.schema.ts) if a required var is missing —
# see this app's own .env.example for the full required-variable list.
CMD ["node", "apps/core-api/dist/main.js"]
