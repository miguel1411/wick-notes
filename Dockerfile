# syntax=docker/dockerfile:1
# Una sola imagen para web, colaboración y migraciones; compose elige el comando.

FROM node:24-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=true NUXT_TELEMETRY_DISABLED=1
RUN npm install -g pnpm@12.11.2 && apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app

FROM base AS build
COPY . .
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile
# prisma.config.ts exige DATABASE_URL incluso para generar; aquí no se conecta a nada.
RUN DATABASE_URL=postgresql://build:build@localhost:5432/build pnpm --filter @wick/db generate \
  && pnpm --filter @wick/web build

FROM base AS runtime
ENV NODE_ENV=production
COPY --from=build --chown=node:node /app /app
USER node
EXPOSE 3000 1234
# Por defecto arranca la web; compose sobrescribe el comando para collab y migrate.
CMD ["node", "apps/web/.output/server/index.mjs"]
