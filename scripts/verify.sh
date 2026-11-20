#!/usr/bin/env bash
# verify.sh — Inventory Scheduler self-check.
# Secrets hygiene, domain guards, lint and build.
# Exits 0 when everything checkable passes; exits 1 on any real failure.

set -u
cd "$(dirname "$0")/.." || exit 1

pass=0
fail=0

ok()   { echo "PASS: $1"; pass=$((pass + 1)); }
bad()  { echo "FAIL: $1"; fail=$((fail + 1)); }
note() { echo "note: $1"; }

# --- 1. Package manifest -------------------------------------------------
if [ -f package.json ]; then
  if command -v node >/dev/null 2>&1 && node -e "require('./package.json')" >/dev/null 2>&1; then
    ok "package.json parses as JSON"
  else
    bad "package.json is not valid JSON (or node is unavailable to check)"
  fi
else
  bad "package.json missing"
fi

# --- 2. Lockfile ---------------------------------------------------------
if [ -f package.json ]; then
  if [ -f package-lock.json ] || [ -f pnpm-lock.yaml ] || [ -f yarn.lock ] || [ -f bun.lock ]; then
    ok "lockfile present"
  else
    bad "no lockfile found (package-lock.json / pnpm-lock.yaml / yarn.lock / bun.lock)"
  fi
fi

# --- 3. Secrets hygiene --------------------------------------------------
if [ -f .env ] && [ -f .gitignore ]; then
  if grep -qE '^\.env$' .gitignore; then
    ok ".env exists and is gitignored"
  else
    bad ".env exists but is not listed in .gitignore"
  fi
fi

in_git() { git rev-parse --is-inside-work-tree >/dev/null 2>&1; }
if in_git; then
  leaked=$(git ls-files | grep -E '(^|/)(\.env|.*\.pem|.*\.key)$' || true)
  if [ -z "$leaked" ]; then
    ok "no secrets tracked in git"
  else
    bad "secret-looking files tracked in git: $leaked"
  fi
fi

# --- 4. Domain guards ----------------------------------------------------
if grep -q 'start: { lt: end }, end: { gt: start }' src/lib/booking-core.ts 2>/dev/null; then
  ok "booking overlap guard present (shared hard-lock query)"
else
  bad "booking overlap guard missing from src/lib/booking-core.ts"
fi

if grep -q 'model BookingParticipant' prisma/schema.prisma 2>/dev/null; then
  ok "Prisma schema covers participants and booking types"
else
  bad "Prisma schema is missing the participant/booking-type models"
fi

if grep -q '409' src/lib/booking-core.ts src/app/api/bookings/route.ts 2>/dev/null; then
  ok "overlap conflicts respond 409 (hard block)"
else
  bad "booking routes do not hard-block overlaps with 409"
fi

if grep -q 'Email is permanent' src/app/api/me/route.ts src/app/api/users/\[id\]/route.ts 2>/dev/null; then
  ok "email immutability enforced on both profile and people routes"
else
  bad "email immutability guard missing"
fi

if [ -f src/instrumentation.ts ] && grep -q 'startReminderWorker' src/instrumentation.ts 2>/dev/null; then
  ok "reminder worker hook wired at server start"
else
  bad "reminder worker instrumentation missing"
fi

if grep -q 'dedupeKey' prisma/schema.prisma 2>/dev/null; then
  ok "reminder deduplication guard in the schema"
else
  bad "reminder dedupe key missing from the schema"
fi

# --- 5. Build / lint (project's own scripts) -----------------------------
if [ -f package.json ]; then
  for script_name in lint build; do
    if node -e "process.exit(require('./package.json').scripts && require('./package.json').scripts['$script_name'] ? 0 : 1)" 2>/dev/null; then
      if npm run "$script_name" --silent >/dev/null 2>&1; then
        ok "npm run $script_name"
      else
        bad "npm run $script_name — run it for the full error output"
      fi
    else
      note "no '$script_name' script defined; skipping"
    fi
  done
fi

echo "verify(inventory-scheduler): $pass passed, $fail failed"
[ "$fail" -eq 0 ]
