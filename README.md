# دعوة · Da3wa

Arabic-first (RTL) digital event invitations for the Saudi/Gulf market. A host creates an
event, imports a guest list, sends each guest a personal WhatsApp link, collects RSVPs with
companion counts, and checks guests in at the door by scanning a signed QR code.

**Status: Phase 2 of 6 complete** — schema, auth, events, guests, and Excel/CSV import.
See [Roadmap](#roadmap).

---

## Stack

| | |
|---|---|
| Monorepo | npm workspaces |
| Web | Next.js 14 (App Router), TypeScript, Tailwind |
| API | Express 4, TypeScript, Zod, Pino |
| Database | PostgreSQL 16 via Prisma |
| Auth | JWT access token + rotating refresh token (httpOnly cookie) |
| Tests | Vitest + Supertest |

```
apps/web        Next.js front end (ar/en, RTL-first)
apps/api        Express API
packages/shared Types, Zod schemas, phone/digit/money helpers used by both
design/         The design doc this product is built from — the visual source of truth
```

---

## Quick start

Requires **Node 20+**, **npm 10+**, and **Docker**.

```bash
git clone <repo> && cd "Invitation SaaS platform"
cp .env.example .env          # then edit the secrets — see below
npm install

docker compose up -d postgres # Postgres on :5432
npm run db:migrate            # apply migrations
npm run db:seed               # demo event + 20 guests

npm run dev:api               # http://localhost:4000
npm run dev:web               # http://localhost:3000
```

Or run everything in containers:

```bash
docker compose up --build     # web :3000, api :4000, postgres :5432
```

### Seeded accounts

| Role | Phone | Password |
|---|---|---|
| Host (has the demo event) | `+966500000000` | `Demo@1234` |
| Host (no events — cross-tenant fixture) | `+966500000001` | `Demo@1234` |
| Admin | `+966500000009` | `Demo@1234` |

Scanner gate password for the demo event: `door1234`.

The login endpoint normalizes phone input, so `0500000000`, `+966500000000`, `966500000000`
and `٠٥٠٠٠٠٠٠٠٠٠` all resolve to the same account.

---

## Environment variables

Copy `.env.example` to `.env`. Generate each secret with `openssl rand -base64 48`.

| Variable | Required | Notes |
|---|---|---|
| `DATABASE_URL` | yes | Postgres connection string. |
| `JWT_ACCESS_SECRET` | yes | ≥16 chars. |
| `JWT_REFRESH_SECRET` | yes | ≥16 chars, **must differ from the access secret**. Boot fails otherwise — sharing one secret lets an access token be replayed as a refresh token. |
| `QR_HMAC_SECRET` | yes | Signs QR payloads. **Rotating it invalidates every QR already delivered to guests.** |
| `JWT_ACCESS_TTL` | no | Default `15m`. |
| `JWT_REFRESH_TTL_DAYS` | no | Default `30`. |
| `WEB_ORIGIN` | no | CORS origin allowed to send credentials. Default `http://localhost:3000`. |
| `PUBLIC_WEB_URL` | no | Base for public invite URLs. Set to your real domain in production. |
| `TRUST_PROXY` | **behind nginx** | Number of proxies in front of the API. Left at `0` behind a reverse proxy, every request reports the proxy's IP, so all callers share one rate-limit bucket and one attacker can lock out everybody. Set to `1` for a single nginx. |
| `SMS_PROVIDER` | no | `console` (default) logs OTP codes instead of sending them. |
| `PAYMENT_PROVIDER` | no | `stub` (default). |
| `VAT_RATE` | no | Default `0.15`. |
| `LOG_LEVEL` | no | Defaults to `debug` in dev, `info` in production, `silent` in tests. |

The API validates all of this at boot and exits with a readable message listing every
problem, rather than failing later inside a signing call.

---

## Database

```bash
npm run db:migrate     # create + apply a migration (development)
npm run db:deploy      # apply committed migrations (production/CI)
npm run db:seed        # reset the demo event and reseed
npm run db:reset       # drop, re-migrate, reseed
npm run db:studio      # Prisma Studio
```

The initial migration contains one hand-written statement Prisma cannot express — a partial
unique index enforcing **at most one live, non-override check-in per guest**:

```sql
CREATE UNIQUE INDEX "CheckIn_one_active_per_guest"
    ON "CheckIn"("guestId")
    WHERE "revokedAt" IS NULL AND "isOverride" = false;
```

An application-level "is this guest already checked in?" read loses to a race between two
scanners at two doors. Keep this index if you regenerate migrations.

---

## Tests

```bash
npm test                      # all workspaces
npm -w @da3wa/shared test     # phone / digits / money units
npm -w @da3wa/api test        # integration suite
```

The API suite provisions its own database — it derives `<your_db>_test` from `DATABASE_URL`,
creates it, and migrates it on first run. It never touches your development data (every test
truncates all tables). Override with `TEST_DATABASE_URL` if you want it elsewhere.

Coverage so far (196 tests): Gulf phone → E.164 across 10 input formats, Arabic-Indic
digits, VAT arithmetic, import column detection and row validation, the full auth lifecycle,
refresh-token reuse detection, rate limiting, the schema constraints above, real .xlsx/.csv
parsing, import partial-success, and **cross-tenant isolation on every event, guest and
import route** — including the subtle case of pairing your own event id with another host's
guest id.

---

## Deploying to a VPS

Ubuntu 22.04+ with Docker and Docker Compose, behind nginx.

**1. Prepare the host**

```bash
sudo apt update && sudo apt install -y docker.io docker-compose-plugin nginx certbot python3-certbot-nginx
sudo usermod -aG docker $USER   # log out and back in
```

**2. Configure**

```bash
git clone <repo> /srv/da3wa && cd /srv/da3wa
cp .env.example .env
```

Edit `.env`:

- fresh values for all three secrets (`openssl rand -base64 48`)
- a strong `POSTGRES_PASSWORD`
- `WEB_ORIGIN` and `PUBLIC_WEB_URL` set to `https://your-domain`
- **`TRUST_PROXY=1`** — see the table above
- `NODE_ENV=production`

**3. Build and run**

Use the `production` target rather than the compose defaults, which are development images:

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build
```

Or build directly:

```bash
docker build -f apps/api/Dockerfile --target production -t da3wa-api .
docker build -f apps/web/Dockerfile --target production -t da3wa-web .
```

The API container runs `prisma migrate deploy` before it starts serving, so a deploy applies
its own migrations. Both images run as the non-root `node` user and expose a `HEALTHCHECK`.

**4. nginx**

```nginx
server {
    server_name your-domain.com;

    location /api/ {
        proxy_pass http://127.0.0.1:4000;
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        # Required for rate limiting to see real client IPs.
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host              $host;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

```bash
sudo certbot --nginx -d your-domain.com
```

TLS is not optional: refresh cookies are issued with `Secure` when `NODE_ENV=production`, so
the browser will discard them over plain HTTP and nobody will be able to stay logged in.

**5. Backups**

```bash
docker exec da3wa-postgres pg_dump -U da3wa da3wa | gzip > backup-$(date +%F).sql.gz
```

---

## Roadmap

| Phase | Scope | Status |
|---|---|---|
| 1 | Schema + auth | ✅ Complete |
| 2 | Events, guests, Excel/CSV import | ✅ Complete |
| 3 | Invite links, RSVP, QR codes | Next |
| 4 | Scanner + check-in | |
| 5 | Dashboard + exports | |
| 6 | Payments + admin panel | |

### Decisions worth knowing

- **Double scan.** A second scan returns `USED` and never writes a second check-in. Admitting
  the guest anyway is an explicit, audited override attributed to the scanner who decided —
  the design's rationale is that Gulf companions arrive separately and hard blocking jams the
  door.
- **Offline scanning is out of scope for the MVP.** The design describes a 2-hour offline
  window; it needs a local store, a sync queue, and server-side reconciliation that changes
  the check-in uniqueness story.
- **Cross-tenant access returns 404, never 403.** A 403 would confirm the id exists, turning
  id enumeration into a directory of every event on the platform.
- **Money is integer halalas; VAT is integer basis points.** No floats anywhere in pricing.
- **Two guest identifiers.** The QR carries an HMAC-signed token; a short `displayCode`
  ("4821-77") exists only for manual door lookup and is unique *per event*, not globally.
- **The package cap warns at import, and is enforced at send.** The design's confirm screen
  says «سيتجاوز باقتك الحالية (٣٠٠) — ستُطلب ترقية عند الإرسال», so a host who bought the
  wrong package can still assemble their list; the upgrade is demanded when they try to send
  invitations. `assertGuestQuota()` exists for that gate. A separate hard ceiling of 5,000
  guests per event blocks runaway growth regardless of package.
- **Import stages nothing server-side.** Parsed rows travel back to the client and return on
  commit, so an abandoned wizard leaves no guest phone numbers sitting in a temp table. It
  also matches the UX: the host corrects rows inline on the errors screen and resubmits.
- **Import duplicates are detected before insert**, against both the incoming batch and the
  rows already stored. Relying on the `@@unique([eventId, phone])` constraint instead would
  abort the whole statement on the first collision and produce no per-row report.

---

## API surface (phases 1–2)

All `/api/events/**` routes require a bearer token and are scoped to the caller's own events.

| Method | Path | Notes |
|---|---|---|
| `POST` | `/api/auth/register` · `/login` · `/refresh` · `/logout` | Refresh cookie rotates |
| `GET` | `/api/auth/me` | |
| `POST` | `/api/auth/otp/request` · `/otp/verify` | Console SMS provider in dev |
| `GET` `POST` | `/api/events` | List / create |
| `GET` `PATCH` `DELETE` | `/api/events/:eventId` | |
| `GET` | `/api/events/:eventId/quota` | Sidebar meter |
| `GET` `POST` | `/api/events/:eventId/guests` | Search, status/group filters, pagination |
| `GET` `PATCH` `DELETE` | `/api/events/:eventId/guests/:guestId` | |
| `POST` | `/api/events/:eventId/guests/bulk-delete` · `bulk-status` | |
| `POST` | `/api/events/:eventId/guests/import/parse` | multipart `file`; .xlsx or .csv |
| `POST` | `/api/events/:eventId/guests/import/validate` | Dry run — the errors screen |
| `POST` | `/api/events/:eventId/guests/import/commit` | Partial success |
