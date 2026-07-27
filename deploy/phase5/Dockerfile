# syntax=docker/dockerfile:1.7

ARG NODE_IMAGE=node:26.0.0-bookworm-slim

FROM ${NODE_IMAGE} AS manifests
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY apps/worker/package.json apps/worker/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/database/package.json packages/database/package.json
COPY packages/dify/package.json packages/dify/package.json
COPY packages/domain/package.json packages/domain/package.json
COPY packages/jobs/package.json packages/jobs/package.json
COPY packages/migration/package.json packages/migration/package.json

FROM manifests AS build-dependencies
RUN npm ci --ignore-scripts

FROM build-dependencies AS web-build
COPY apps/web apps/web
COPY packages/contracts packages/contracts
RUN npm run build -w @novel-analysis/web

FROM manifests AS production-dependencies
RUN npm ci --omit=dev --ignore-scripts

FROM ${NODE_IMAGE} AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=production-dependencies --chown=node:node /app/node_modules ./node_modules
COPY --chown=node:node package.json package-lock.json ./
COPY --chown=node:node apps/api/package.json apps/api/package.json
COPY --chown=node:node apps/worker/package.json apps/worker/package.json
COPY --chown=node:node packages packages
COPY --chown=node:node apps/api/src apps/api/src
COPY --chown=node:node apps/worker/src apps/worker/src
USER node

FROM runtime AS api
COPY --from=web-build --chown=node:node /app/apps/web/dist /app/apps/web/dist
ENV WEB_STATIC_DIR=/app/apps/web/dist
EXPOSE 3000
CMD ["npm", "run", "start", "-w", "@novel-analysis/api"]

FROM runtime AS worker
ENV WORKER_READY_FILE=/tmp/novel-worker.ready
CMD ["npm", "run", "start", "-w", "@novel-analysis/worker"]
