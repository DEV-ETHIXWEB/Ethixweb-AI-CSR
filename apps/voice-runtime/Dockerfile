# Multi-stage production image for @ethixweb/voice-runtime.
#
# Build from the MONOREPO ROOT:
#   docker build -f apps/voice-runtime/Dockerfile -t ethixweb/voice-runtime .
#
# See apps/core-api/Dockerfile's header comment for the shared reasoning
# (turbo prune pattern, node:22-slim choice, "written but not
# docker-build-verified in this environment"). No Prisma dependency, same
# as voice-orchestrator.

FROM node:22-slim AS base
RUN corepack enable

FROM base AS pruner
WORKDIR /repo
COPY . .
RUN npx turbo prune @ethixweb/voice-runtime --docker

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
RUN npx turbo run build --filter=@ethixweb/voice-runtime

FROM base AS runner
WORKDIR /repo
RUN groupadd --system --gid 1001 ethixweb \
    && useradd --system --uid 1001 --gid ethixweb runtime
COPY --from=installer /repo .
USER runtime
ENV NODE_ENV=production
EXPOSE 3200
# Fails closed at startup (env.schema.ts) if a required var is missing —
# see this app's own .env.example for the full required-variable list
# (TWILIO_*, DEEPGRAM_API_KEY, ELEVENLABS_*, VOICE_ORCHESTRATOR_BASE_URL,
# ORCHESTRATOR_SERVICE_TOKEN, TENANT_ROUTING_* are all required). Must be
# reachable on a public HTTPS URL for Twilio's webhook + wss:// media
# stream — see docs/41-first-local-real-call.md's PUBLIC_BASE_URL note,
# which applies identically in a real deployment (ALB/CloudFront in front
# of this container, not a bare HTTP listener on the public internet).
CMD ["node", "apps/voice-runtime/dist/main.js"]
