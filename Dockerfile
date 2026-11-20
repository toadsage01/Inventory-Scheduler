# Gear & studio booking, containerised. It talks to Postgres — the
# docker-compose.yml ships one with a named volume, so bookings survive
# restarts and image updates.
# Alpine needs openssl for the Prisma engines; libc6-compat for the
# standalone Next.js server on musl.
FROM node:22-alpine AS builder
RUN apk add --no-cache openssl libc6-compat
WORKDIR /app
# prisma/ must exist before npm install: package.json's postinstall hook
# runs `prisma generate`, which reads prisma/schema.prisma.
COPY prisma ./prisma
COPY package.json bun.lock* package-lock.json* ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npx prisma generate
RUN npm run build

# Production dependency tree only. The runner ships this whole node_modules
# so the prisma CLI (db push at boot) has every hoisted dependency it needs —
# cherry-picking prisma's packages breaks on its transitive deps.
FROM node:22-alpine AS deps
RUN apk add --no-cache openssl libc6-compat
WORKDIR /app
COPY prisma ./prisma
COPY package.json bun.lock* package-lock.json* ./
RUN npm ci --omit=dev --no-audit --no-fund

FROM node:22-alpine AS runner
RUN apk add --no-cache openssl libc6-compat
WORKDIR /app
ENV NODE_ENV=production
ENV HOSTNAME=0.0.0.0
ENV PORT=3000
RUN addgroup -S app && adduser -S app -G app
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public
COPY --from=deps /app/node_modules ./node_modules
COPY --from=builder /app/prisma ./prisma
# The crew roster seed (six studio members wearing their face photos)
# and the demo seed (teams, booking types, the real gear sheet, sample
# bookings). Baked in so the boot command can top everything up on every
# start: the scripts upsert, and a failed seed never blocks boot.
COPY --from=builder /app/scripts/seed-crew.mjs ./seed-crew.mjs
COPY --from=builder /app/scripts/seed-demo.mjs ./seed-demo.mjs
COPY --from=builder /app/scripts/sheet-assets.json ./sheet-assets.json
RUN mkdir -p /data && chown -R app:app /data /app
USER app
EXPOSE 3000
# Apply the schema, then boot the standalone server. The prisma CLI is
# invoked by its real path (node_modules/prisma/build/index.js): its wasm
# assets live next to that file, and a copied .bin symlink would break that
# relative lookup. db push is additive and idempotent: first boot creates
# the tables, later boots are no-ops. It is deliberately called WITHOUT
# --accept-data-loss — if a future schema change would destroy data, the
# container refuses to start with a clear error instead of silently
# deleting bookings.
CMD ["sh", "-c", "node node_modules/prisma/build/index.js db push --skip-generate && (node seed-demo.mjs || echo 'WARN: demo seed failed, continuing') && node server.js"]
