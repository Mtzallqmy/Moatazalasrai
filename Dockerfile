# Multi-stage image: development tooling stays out of the production runtime.
ARG NODE_VERSION=22.18.0

FROM node:${NODE_VERSION}-alpine AS base
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
RUN apk add --no-cache libc6-compat

FROM base AS dependencies
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

# Production-only dependencies are copied because migration and worker scripts run outside Next standalone tracing.
FROM base AS production-dependencies
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund \
  && npm cache clean --force

# Docker Compose depends on this named target for both the web and worker development services.
# Keep it explicit in every merge result; CI verifies the compose targets against this Dockerfile.
FROM base AS development
ENV NODE_ENV=development
COPY --from=dependencies /app/node_modules ./node_modules
COPY . .
EXPOSE 3000
CMD ["npm", "run", "dev", "--", "--hostname", "0.0.0.0"]

FROM base AS builder
ENV NODE_ENV=production
COPY --from=dependencies /app/node_modules ./node_modules
COPY . .
RUN mkdir -p public && npm run build

FROM node:${NODE_VERSION}-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

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

# Fail the image build if Railway startup or migration assets are incomplete.
RUN test -f /app/scripts/start-production.mjs \
  && test -f /app/scripts/check-telegram-schema.mjs \
  && test -f /app/scripts/check-whatsapp-schema.mjs \
  && test -f /app/scripts/setup-telegram-webhook.mjs \
  && test -f /app/scripts/validate-runtime-env.mjs \
  && test -f /app/drizzle/0039_central_telegram_bot.sql \
  && test -f /app/drizzle/0040_telegram_admin_default_permissions.sql \
  && test -f /app/drizzle/0041_telegram_user_sessions.sql \
  && test -f /app/drizzle/0042_whatsapp_user_sessions.sql \
  && test -f /app/drizzle/0050_member_access_expiry.sql \
  && node --input-type=module -e "await import('graphile-worker'); await import('pg')"

USER nextjs
EXPOSE 3000
CMD ["node", "scripts/start-production.mjs"]
