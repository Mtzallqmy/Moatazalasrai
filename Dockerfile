# Multi-stage production image with one Node version shared by CI, local development and Railway.
ARG NODE_VERSION=22.18.0

FROM node:${NODE_VERSION}-bookworm-slim AS base
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

FROM base AS dependencies
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

# Runtime scripts and Graphile Worker execute outside Next.js standalone tracing.
FROM base AS production-dependencies
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund \
  && npm cache clean --force

FROM base AS builder
ENV NODE_ENV=production
COPY --from=dependencies /app/node_modules ./node_modules
COPY . .
RUN mkdir -p public && npm run build

FROM node:${NODE_VERSION}-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0 \
    PORT=3000

RUN addgroup --system --gid 1001 nodejs \
  && adduser --system --uid 1001 --ingroup nodejs nextjs \
  && mkdir -p /app/.data/attachments \
  && chown -R nextjs:nodejs /app/.data

COPY --from=builder --chown=nextjs:nodejs /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=production-dependencies --chown=nextjs:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=nextjs:nodejs /app/package.json ./package.json
COPY --from=builder --chown=nextjs:nodejs /app/drizzle ./drizzle
COPY --from=builder --chown=nextjs:nodejs \
  /app/scripts/migrate.mjs \
  /app/scripts/migrate-worker.mjs \
  /app/scripts/sql-utils.mjs \
  /app/scripts/start-production.mjs \
  /app/scripts/check-telegram-schema.mjs \
  /app/scripts/check-whatsapp-schema.mjs \
  /app/scripts/setup-telegram-webhook.mjs \
  /app/scripts/validate-runtime-env.mjs \
  ./scripts/

# Fail image creation when a Railway startup or migration asset is absent.
RUN test -f /app/scripts/start-production.mjs \
  && test -f /app/scripts/check-telegram-schema.mjs \
  && test -f /app/scripts/check-whatsapp-schema.mjs \
  && test -f /app/scripts/setup-telegram-webhook.mjs \
  && test -f /app/scripts/validate-runtime-env.mjs \
  && test -f /app/drizzle/0039_central_telegram_bot.sql \
  && test -f /app/drizzle/0040_telegram_admin_default_permissions.sql \
  && test -f /app/drizzle/0041_telegram_user_sessions.sql \
  && test -f /app/drizzle/0042_whatsapp_user_sessions.sql \
  && node --input-type=module -e "await import('graphile-worker'); await import('pg')"

USER nextjs
EXPOSE 3000
CMD ["node", "scripts/start-production.mjs"]
