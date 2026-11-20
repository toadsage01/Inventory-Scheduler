# Inventory Scheduler

One shared booking calendar for a studio's gear, rooms, and crew. Teams work
off the same shelf of cameras, lenses, lights and the same studio floors.
This is the single place where a slot gets claimed once and stays claimed:
taken windows are hard-locked for everyone, with no overwrite path.

## How it runs

Two containers, managed with docker compose:

- **scheduler** — the app (Next.js), built from the Dockerfile in this repo.
- **db** — PostgreSQL 16. Its data lives in `./data/pg` on the host, so
  bookings survive restarts and image updates. The port is deliberately not
  published; only the app container can reach it.

On every boot the app applies the database schema (additive-only: if a schema
change would destroy data, the container refuses to start instead of deleting
bookings) and tops up the reference data — teams, booking types, the gear
list and a spread of sample bookings. The seed is idempotent and never
touches bookings you created yourself. A reminder worker runs inside the app
process and sends scheduled email reminders.

## Requirements

- Any Linux server — Ubuntu 22.04 / 24.04 is the reference. 2 GB RAM minimum;
  4 GB makes the first build more comfortable.
- Docker Engine with the compose plugin.
- git, for pulling updates later.

## First deploy

```bash
git clone <repo-url>
cd Inventory-Scheduler
cp .env.example .env
```

Edit `.env` (the file has comments for every key). The four that matter:

| Key | What to put |
| --- | --- |
| `POSTGRES_PASSWORD` | `openssl rand -hex 24` — letters and digits only (it is embedded in a connection URL; symbols break it) |
| `NEXTAUTH_SECRET` | `openssl rand -base64 32` |
| `NEXTAUTH_URL` | the address people will open in a browser, e.g. `http://203.0.113.10:3000` or `https://inventory.example.com` |
| `BIND_HOST` | `127.0.0.1` when a TLS reverse proxy runs on the same machine (default); `0.0.0.0` to expose port 3000 directly |

Then:

```bash
docker compose up -d --build      # first build takes a few minutes
docker compose logs -f scheduler  # watch until the boot settles, then Ctrl+C
```

Open `NEXTAUTH_URL` in a browser. The **first visitor creates the first
admin account** on the setup screen — name, email, password of 8+
characters. After that the screen locks for good and every further account
is created by an admin from the People panel.

Optional, in rough order of usefulness:

- **Email** — SMTP in Settings → Notifications inside the app (or fill
  `SMTP_*` in `.env` before starting). Gmail needs an App Password.
- **HTTPS + domain** — point a domain at the server and put Caddy or nginx
  in front of `127.0.0.1:3000`; keep `BIND_HOST=127.0.0.1`.
- **Google sign-in / calendar mirror** — fill `GOOGLE_CLIENT_ID` /
  `GOOGLE_CLIENT_SECRET` in `.env`. Without them the app is password-only.
- **Bulk import from a sheet** — see the command in the header comment of
  `scripts/import-from-sheet.mjs`.

## Day-to-day

```bash
docker compose ps                                  # what is running
docker compose logs -f scheduler                   # follow app logs
docker compose restart                             # restart both containers
docker compose down                                # stop (data in ./data/pg survives)
docker compose up -d                               # start again

# Update to a newer version:
git pull
docker compose up -d --build

# Backup (run from the repo directory; date-stamped file):
mkdir -p backups
docker compose exec db pg_dump -U scheduler scheduler > "backups/scheduler-$(date +%F).sql"

# Restore a backup into an empty database:
docker compose exec -T db psql -U scheduler -d scheduler < backups/scheduler-YYYY-MM-DD.sql
```

If you changed `POSTGRES_USER` / `POSTGRES_DB` in `.env`, use those values
in the backup and restore commands instead of `scheduler`.

**Password resets.** Normal case: an admin resets a member's password from
the People panel inside the app. Break-glass — nobody can sign in at all:

```bash
docker cp scripts/reset-password.mjs "$(docker compose ps -q scheduler)":/app/reset-password.mjs
docker compose exec scheduler node /app/reset-password.mjs you@company.com
```

## Never do

- Never delete `./data/pg` — that is the live database.
- Never commit `.env` (it is gitignored; it holds the database password and
  the signing secret). Rotate `NEXTAUTH_SECRET` if it ever leaks.
- Don't publish port 5432 of the db service — the compose network is the
  only path to the database by design.

## Self-check

`bash scripts/verify.sh` checks secrets hygiene, the booking-overlap guards,
lint and build. It needs Node on the machine you run it on — handy on a dev
machine, not needed on the server.
