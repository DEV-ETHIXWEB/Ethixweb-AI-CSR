# Multi-stage production image for @ethixweb/dashboard (Next.js).
#
# Build from the MONOREPO ROOT:
#   docker build -f apps/dashboard/Dockerfile -t ethixweb/dashboard .
#
# See apps/core-api/Dockerfile's header comment for the shared reasoning
# (turbo prune pattern, node:22-slim choice, "written but not
# docker-build-verified in this environment"). Differs from the three
# NestJS services in the runner stage: `output: "standalone"`
# (apps/dashboard/next.config.mjs) produces a self-contained server.js
# with only the node_modules files Next actually traced as used, so the
# runner copies THAT instead of the full installer node_modules — smaller
# and the officially documented Next.js Docker pattern. Static assets
# (.next/static) are deliberately excluded from standalone output and must
# be copied in separately, per Next's own docs.

FROM node:22-slim AS base
RUN corepack enable

FROM base AS pruner
WORKDIR /repo
COPY . .
# Pinned to the repo's own turbo version. `npx turbo` with no version installs
# whatever npm has as latest at build time, and on 2026-09-14 that release
# (2.10.13) shipped without a working linux-64 binary, which failed every
# uncached build at this step. The lockfile's turbo is used for `turbo run build`
# below, after pnpm install; this prune step runs before install and had no pin.
RUN npx turbo@2.10.7 prune @ethixweb/dashboard --docker

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
RUN npx turbo run build --filter=@ethixweb/dashboard

FROM base AS runner
WORKDIR /repo
RUN groupadd --system --gid 1001 ethixweb \
    && useradd --system --uid 1001 --gid ethixweb runtime
COPY --from=installer /repo/apps/dashboard/.next/standalone ./
COPY --from=installer /repo/apps/dashboard/.next/static ./apps/dashboard/.next/static
# Uncomment if/when apps/dashboard/public/ is added:
# COPY --from=installer /repo/apps/dashboard/public ./apps/dashboard/public
USER runtime
ENV NODE_ENV=production
ENV HOSTNAME=0.0.0.0
ENV PORT=3001
EXPOSE 3001
# Server-side-only var (never NEXT_PUBLIC_) — see this app's own
# .env.example: proxies every core-api call itself, browser never talks to
# core-api directly.
CMD ["node", "apps/dashboard/server.js"]
