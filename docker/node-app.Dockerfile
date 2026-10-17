# syntax=docker/dockerfile:1.7
#
# Shared multi-stage image for the API and the worker.
#   docker build -f docker/node-app.Dockerfile --build-arg APP=api    -t smart-hr-api .
#   docker build -f docker/node-app.Dockerfile --build-arg APP=worker -t smart-hr-worker .

ARG NODE_IMAGE=node:22-bookworm-slim

FROM ${NODE_IMAGE} AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=1 NEXT_TELEMETRY_DISABLED=1
RUN corepack enable
WORKDIR /repo

FROM base AS build
ARG APP
COPY . .
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile
RUN pnpm turbo run build --filter "@smart-hr/${APP}..."
# Copy only the app, its built workspace dependencies and production node_modules.
RUN pnpm --filter "@smart-hr/${APP}" deploy --prod --legacy /out

# One-off job: applies database migrations as the migrator role. Uses the build stage, which has the Prisma
# CLI and its engines, so it also works on servers without internet access.
#   docker build -f docker/node-app.Dockerfile --target migrate -t smart-hr-migrate .
FROM build AS migrate
ENV NODE_ENV=production
WORKDIR /repo/packages/database
USER node
# Plain node, not pnpm: corepack would try to download pnpm for this user, which fails offline.
CMD ["node", "node_modules/prisma/build/index.js", "migrate", "deploy"]

FROM ${NODE_IMAGE} AS runtime
ARG APP
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /out ./
# Where the API keeps uploaded documents when STORAGE_DRIVER=local (mount a volume here).
RUN mkdir -p /var/lib/smart-hr/documents && chown node:node /var/lib/smart-hr/documents
USER node
# The API listens on API_PORT (default 4000); the worker has no port.
EXPOSE 4000
CMD ["node", "dist/main.js"]
