# syntax=docker/dockerfile:1.7
#
# Self-hosted web app (in-house and dedicated deployments). SaaS serves the web app from Vercel instead.
#   docker build -f docker/web.Dockerfile --build-arg NEXT_PUBLIC_API_URL=https://hr-api.example.internal -t smart-hr-web .
#
# NEXT_PUBLIC_* values are compiled into the browser bundle, so they are build arguments. Never pass a
# secret here: everything in a NEXT_PUBLIC_ value is visible to every visitor.

ARG NODE_IMAGE=node:22-bookworm-slim

FROM ${NODE_IMAGE} AS build
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=1 NEXT_TELEMETRY_DISABLED=1 NEXT_OUTPUT=standalone
RUN corepack enable
WORKDIR /repo
ARG NEXT_PUBLIC_API_URL=http://localhost:4000
ARG NEXT_PUBLIC_SIGNUP_ENABLED=false
ENV NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL} NEXT_PUBLIC_SIGNUP_ENABLED=${NEXT_PUBLIC_SIGNUP_ENABLED}
COPY . .
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile
RUN pnpm turbo run build --filter "@smart-hr/web..."

FROM ${NODE_IMAGE} AS runtime
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
WORKDIR /app
COPY --from=build --chown=node:node /repo/apps/web/.next/standalone ./
COPY --from=build --chown=node:node /repo/apps/web/.next/static ./apps/web/.next/static
USER node
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
