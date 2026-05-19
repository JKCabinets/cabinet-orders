# syntax=docker/dockerfile:1.7
#
# Production Docker image for cabinet-orders (Next.js 16, App Router).
#
# Multi-stage build:
#   1. deps     — install npm packages (cached separately for fast rebuilds)
#   2. builder  — compile Next.js with Turbopack, produce standalone output
#   3. runner   — minimal runtime image, ~150MB
#
# Built and pushed by Kamal. Pulled and run on the Hetzner server.

# ─── Stage 1: dependencies ────────────────────────────────────────────
FROM node:22-alpine AS deps

# libc6-compat is needed by some npm packages with native bindings.
RUN apk add --no-cache libc6-compat

WORKDIR /app

# Copy only package manifests first so this layer caches as long as
# dependencies don't change. Editing source files won't reinstall npm.
COPY package.json package-lock.json* ./

# `npm ci` is faster and stricter than `npm install` for CI/production:
# requires package-lock.json, fails if it's out of sync.
RUN npm ci --frozen-lockfile

# ─── Stage 2: build ───────────────────────────────────────────────────
FROM node:22-alpine AS builder

WORKDIR /app

# Pull in node_modules from the deps stage
COPY --from=deps /app/node_modules ./node_modules

# Now copy the rest of the source
COPY . .

# Disable Next.js telemetry during build for slightly faster builds and
# to avoid noisy network calls.
ENV NEXT_TELEMETRY_DISABLED=1

# Build. With `output: "standalone"` in next.config.mjs, this produces:
#   .next/standalone/  — minimal Node app with embedded dependencies
#   .next/static/      — static assets to be served separately
# Mount build secrets, export them as env vars, then run the build.
# Next.js's "collecting page data" phase imports route modules, some of
# which construct Supabase/auth clients at module-load time, so they
# need real env values at build time, not just runtime.
RUN --mount=type=secret,id=SUPABASE_URL \
    --mount=type=secret,id=SUPABASE_SERVICE_ROLE_KEY \
    --mount=type=secret,id=NEXTAUTH_SECRET \
    --mount=type=secret,id=CRON_SECRET \
    --mount=type=secret,id=ADMIN_BACKWARD_PIN \
    --mount=type=secret,id=SHOPIFY_WEBHOOK_SECRET \
    --mount=type=secret,id=SHOPIFY_CLIENT_ID \
    --mount=type=secret,id=SHOPIFY_CLIENT_SECRET \
    --mount=type=secret,id=SHOPIFY_STORE_DOMAIN \
    --mount=type=secret,id=QUOTE_WEBHOOK_SECRET \
    --mount=type=secret,id=UPSTASH_REDIS_REST_URL \
    --mount=type=secret,id=UPSTASH_REDIS_REST_TOKEN \
    SUPABASE_URL=$(cat /run/secrets/SUPABASE_URL) \
    SUPABASE_SERVICE_ROLE_KEY=$(cat /run/secrets/SUPABASE_SERVICE_ROLE_KEY) \
    NEXTAUTH_SECRET=$(cat /run/secrets/NEXTAUTH_SECRET) \
    CRON_SECRET=$(cat /run/secrets/CRON_SECRET) \
    ADMIN_BACKWARD_PIN=$(cat /run/secrets/ADMIN_BACKWARD_PIN) \
    SHOPIFY_WEBHOOK_SECRET=$(cat /run/secrets/SHOPIFY_WEBHOOK_SECRET) \
    SHOPIFY_CLIENT_ID=$(cat /run/secrets/SHOPIFY_CLIENT_ID) \
    SHOPIFY_CLIENT_SECRET=$(cat /run/secrets/SHOPIFY_CLIENT_SECRET) \
    SHOPIFY_STORE_DOMAIN=$(cat /run/secrets/SHOPIFY_STORE_DOMAIN) \
    QUOTE_WEBHOOK_SECRET=$(cat /run/secrets/QUOTE_WEBHOOK_SECRET) \
    UPSTASH_REDIS_REST_URL=$(cat /run/secrets/UPSTASH_REDIS_REST_URL) \
    UPSTASH_REDIS_REST_TOKEN=$(cat /run/secrets/UPSTASH_REDIS_REST_TOKEN) \
    npm run build

# ─── Stage 3: runtime ─────────────────────────────────────────────────
FROM node:22-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
# Bind to all interfaces inside the container so Kamal's proxy can reach it.
ENV HOSTNAME=0.0.0.0
ENV PORT=3000

# Create a non-root user for the app to run as. Running Node as root
# inside containers is a security anti-pattern — if anyone escapes
# the Node process they shouldn't immediately have root in the container.
RUN addgroup --system --gid 1001 nodejs \
 && adduser --system --uid 1001 nextjs

# Copy public assets. These are served by Next.js's bundled server.
COPY --from=builder /app/public ./public

# Copy the standalone output. This is a minimal Node app with all
# required dependencies inlined.
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

# Drop privileges
USER nextjs

EXPOSE 3000

# The standalone build creates a server.js entry point that knows how
# to handle all Next.js routing, API routes, RSC streaming, etc.
CMD ["node", "server.js"]
