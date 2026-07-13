# syntax=docker/dockerfile:1.7

ARG NODE_IMAGE=node:22-bookworm-slim

FROM ${NODE_IMAGE} AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
ENV NEXT_TELEMETRY_DISABLED=1
RUN corepack enable
WORKDIR /app

FROM base AS dependencies
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

FROM dependencies AS web-build
COPY . .
RUN pnpm build

FROM node:22-bookworm-slim AS web
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV HOSTNAME=0.0.0.0
ENV PORT=3000
WORKDIR /app
COPY --from=web-build --chown=node:node /app/.next/standalone ./
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>{if(r.status!==200&&r.status!==503)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["sh", "-c", "node scripts/production-check.mjs --profile=web && exec node server.js"]

FROM base AS worker-dependencies
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --prod --frozen-lockfile

FROM worker-dependencies AS worker
ENV NODE_ENV=production
WORKDIR /app
COPY --chown=node:node lib ./lib
COPY --chown=node:node migrations ./migrations
COPY --chown=node:node scripts ./scripts
COPY --chown=node:node tsconfig.json ./tsconfig.json
USER node
CMD ["sh", "-c", "node scripts/production-check.mjs --profile=worker && exec pnpm worker:radar"]
