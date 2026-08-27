# Multi-stage production image for @ethixweb/voice-orchestrator.
#
# Build from the MONOREPO ROOT:
#   docker build -f apps/voice-orchestrator/Dockerfile -t ethixweb/voice-orchestrator .
#
# See apps/core-api/Dockerfile's header comment for the shared reasoning
# (turbo prune pattern, node:22-slim choice, "written but not
# docker-build-verified in this environment"). This service has no Prisma
# dependency (it never touches Postgres directly — see docs/01 §9), so no
# `prisma generate` step and no openssl install are needed here.

FROM node:22-slim AS base
RUN corepack enable

FROM base AS pruner
WORKDIR /repo
COPY . .
RUN npx turbo prune @ethixweb/voice-orchestrator --docker

FROM base AS installer
WORKDIR /repo
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
RUN npx turbo run build --filter=@ethixweb/voice-orchestrator

FROM base AS runner
WORKDIR /repo
RUN groupadd --system --gid 1001 ethixweb \
    && useradd --system --uid 1001 --gid ethixweb runtime
COPY --from=installer /repo .
USER runtime
ENV NODE_ENV=production
EXPOSE 3100
# Fails closed at startup (env.schema.ts) if a required var is missing —
# see this app's own .env.example for the full required-variable list
# (REDIS_URL, CORE_API_BASE_URL, CORE_API_SERVICE_API_KEY,
# ORCHESTRATOR_SERVICE_TOKEN are all required; at least one of
# OPENAI_API_KEY/ANTHROPIC_API_KEY/GEMINI_API_KEY is recommended).
CMD ["node", "apps/voice-orchestrator/dist/main.js"]
