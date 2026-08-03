# دعوة · Da3wa

Arabic-first (RTL) digital event invitations for the Saudi/Gulf market. A host creates an
event, imports a guest list, sends each guest a personal WhatsApp link, collects RSVPs with
companion counts, and checks guests in at the door by scanning a signed QR code.

**Status: MVP complete — all 6 phases.** Schema and auth, events and guests, Excel/CSV
import, invite links with RSVP and QR codes, the reception scanner, the host dashboard with
exports and the post-event report, and payments with the admin panel.
See [Roadmap](#roadmap).

---

## Stack

|          |                                                             |
| -------- | ----------------------------------------------------------- |
| Monorepo | npm workspaces                                              |
| Web      | Next.js 14 (App Router), TypeScript, Tailwind               |
| API      | Express 4, TypeScript, Zod, Pino                            |
| Database | PostgreSQL 16 via Prisma                                    |
| Auth     | JWT access token + rotating refresh token (httpOnly cookie) |
| Tests    | Vitest + Supertest                                          |

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

| Role                                    | Phone           | Password    |
| --------------------------------------- | --------------- | ----------- |
| Host (has the demo event)               | `+966500000000` | `Demo@1234` |
| Host (no events — cross-tenant fixture) | `+966500000001` | `Demo@1234` |
| Admin                                   | `+966500000009` | `Demo@1234` |

Scanner gate password for the demo event: `door1234`.

The login endpoint normalizes phone input, so `0500000000`, `+966500000000`, `966500000000`
and `٠٥٠٠٠٠٠٠٠٠٠` all resolve to the same account.

---

## Environment variables

Copy `.env.example` to `.env`. Generate each secret with `openssl rand -base64 48`.

| Variable               | Required               | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ---------------------- | ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`         | yes                    | Postgres connection string.                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `JWT_ACCESS_SECRET`    | yes                    | ≥16 chars.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `JWT_REFRESH_SECRET`   | yes                    | ≥16 chars, **must differ from the access secret**. Boot fails otherwise — sharing one secret lets an access token be replayed as a refresh token.                                                                                                                                                                                                                                                                                                                                             |
| `QR_HMAC_SECRET`       | yes                    | Signs QR payloads. **Rotating it invalidates every QR already delivered to guests.**                                                                                                                                                                                                                                                                                                                                                                                                          |
| `JWT_ACCESS_TTL`       | no                     | Default `15m`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `JWT_REFRESH_TTL_DAYS` | no                     | Default `30`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `WEB_ORIGIN`           | no                     | CORS origin allowed to send credentials. Default `http://localhost:3000`.                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `PUBLIC_WEB_URL`       | no                     | Base for public invite URLs. Set to your real domain in production.                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `TRUST_PROXY`          | **yes, in production** | Number of proxies in front of the API. This matters twice. Behind nginx, `0` makes every request report the proxy's IP, so all callers share one rate-limit bucket and one attacker can lock out the whole user base. It also governs _server-rendered invite lookups_: those reach the API from the web container, so without it every guest on the platform shares one bucket and invitations start failing to load once a host sends more than 30 a minute. Set to `1` for a single nginx. |
| `SMS_PROVIDER`         | no                     | `console` (default) logs OTP codes instead of sending them.                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `PAYMENT_PROVIDER`     | no                     | `stub` (default).                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `VAT_RATE`             | no                     | Default `0.15`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `LOG_LEVEL`            | no                     | Defaults to `debug` in dev, `info` in production, `silent` in tests.                                                                                                                                                                                                                                                                                                                                                                                                                          |

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
- **`NEXT_PUBLIC_API_URL=https://your-domain`** — see the warning below
- **`TRUST_PROXY=1`** — see the table above
- `NODE_ENV=production`
- `WEB_HOST_PORT` / `API_HOST_PORT` — only on a shared host where 3000/4000 are
  already taken. Check with `ss -tln | grep -E ':(3000|4000)'` first; the container
  bind fails outright on a clash. Point nginx at the same values in step 4.

> **`NEXT_PUBLIC_API_URL` is a build-time value.** Next inlines every
> `NEXT_PUBLIC_*` variable into the client bundle when the image is built, so setting it in
> `.env` after the fact does nothing. It must be exported before `docker build` /
> `docker compose build`. Left at its `localhost` default, guests' browsers will request
> `http://localhost:4000/api/invite/…/qr.png` — no QR renders and RSVP submissions fail,
> while server-rendered content still looks fine, which makes it easy to miss.
> The production compose overlay refuses to build without it.

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

Both `proxy_pass` ports below must match `API_HOST_PORT` / `WEB_HOST_PORT` from step 2.

```nginx
server {
    server_name your-domain.com;

    # Card artwork is posted through the API, which accepts up to 3 MB. nginx
    # must not cap it lower, or the upload fails at the proxy with a 413.
    client_max_body_size 8m;

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

| Phase | Scope                            | Status      |
| ----- | -------------------------------- | ----------- |
| 1     | Schema + auth                    | ✅ Complete |
| 2     | Events, guests, Excel/CSV import | ✅ Complete |
| 3     | Invite links, RSVP, QR codes     | ✅ Complete |
| 4     | Scanner + check-in               | ✅ Complete |
| 5     | Dashboard + exports              | ✅ Complete |
| 6     | Payments + admin panel           | ✅ Complete |
| 7     | Host workspace, card editor, platform settings | ✅ Complete |
| 8     | Three design routes, custom-design queue, sample invitation | ✅ Complete |
| 9     | Delegated invitation blocks («ضيوف أم العروس») | ✅ Complete |

### Known gaps

- **Discount codes** are accepted by the checkout schema but rejected with
  `DISCOUNT_NOT_AVAILABLE`: they need a catalogue model that does not exist yet. Refusing a
  code plainly beats silently ignoring one the host believes they applied.
- **Offline scanning** was scoped out of the MVP (see the decision list above). The scanner
  is online-only, with a real connectivity indicator.
- **Only the stub payment provider is wired.** A real gateway is one class implementing
  `PaymentProvider` — see `apps/api/src/services/payment/index.ts`.
- **Bulk WhatsApp sending is still one tap per guest.** Sending one pre-filled message to
  thirty numbers in a single action is not possible over `wa.me`, and doing it properly means
  the WhatsApp Cloud API — a Meta Business account, verification, approved templates, a
  per-message fee, and messages that arrive from a platform number rather than the host's.
  That trade was declined; the queue's progress tracking is the answer for now. The provider
  abstraction to add it later would mirror `SMS_PROVIDER` / `PAYMENT_PROVIDER`.

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
  ("4821-77") exists only for manual door lookup and is unique _per event_, not globally.
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
- **We never send a WhatsApp message.** The API builds a `wa.me` deep link and the host taps
  it, so the invitation leaves the host's own number — the product's central promise, and the
  reason the _click_ (not a delivery receipt) is what marks an invitation `SENT`. It is also
  why there is no "send to all thirty at once": one `wa.me` link opens one chat, and real
  bulk delivery would need the WhatsApp Cloud API — a platform number, business verification
  and pre-approved templates, i.e. messages that no longer come from the host. What the
  batch screens do instead is keep the host's place: `SendQueue` counts the links opened,
  names who is next, and marks each row as it goes. It says فُتحت, not أُرسلت, because a tap
  on the link is genuinely the last thing we can observe.
- **The card's artwork sits above its message, not behind it.** Hosts pay a designer for a
  composition — often the whole invitation already set in type — and the old layout cropped
  it to a text panel's aspect and dimmed it under a scrim to keep the guest's name legible.
  The image is now shown whole (`object-contain`, its own aspect, capped at 52vh so the RSVP
  buttons stay above the fold) with the message reading underneath it on paper.
- **The design choice is stored, not inferred.** `templateId`, `cardImageData` and
  `customCardUrl` can all hold a value at once. A precedence rule used to decide between
  them, which meant a host who uploaded a file to "see how it looks" had silently switched
  their guests off the template with nothing on screen saying so. `cardDesignMode` records
  what they actually chose; uploaded bytes still win *within* a mode, because there they are
  the operator's tailored version of that exact choice.
- **The QR carries a signed reference, never guest data.** Payload is
  `1.<eventId>.<invitationId>.<issuedAt>.<hmac>`. A photographed code reveals no name, phone,
  or invite URL, and `eventId` sits inside the signed region so a code cannot be moved
  between events. It deliberately does _not_ carry the invite token — that is the credential
  in `/invite/<token>`, and embedding it would let anyone who photographs a screen at the
  door open that guest's invitation.
- **RSVP is one atomic write.** `attending` and `companions` arrive together, because the
  design puts the companion picker _above_ the confirm button: in Gulf families the real
  answer is "how many". Guests may change their reply until the deadline; `RsvpResponse` is
  the append-only record and `Guest.status` is its projection. `ATTENDED` is the one-way
  door.

---

## API surface (phases 1–2)

All `/api/events/**` routes require a bearer token and are scoped to the caller's own events.

| Method                 | Path                                                      | Notes                                    |
| ---------------------- | --------------------------------------------------------- | ---------------------------------------- |
| `POST`                 | `/api/auth/register` · `/login` · `/refresh` · `/logout`  | Refresh cookie rotates                   |
| `GET`                  | `/api/auth/me`                                            |                                          |
| `POST`                 | `/api/auth/otp/request` · `/otp/verify`                   | Console SMS provider in dev              |
| `GET` `POST`           | `/api/events`                                             | List / create                            |
| `GET` `PATCH` `DELETE` | `/api/events/:eventId`                                    |                                          |
| `GET`                  | `/api/events/:eventId/quota`                              | Sidebar meter                            |
| `GET` `POST`           | `/api/events/:eventId/guests`                             | Search, status/group filters, pagination |
| `GET` `PATCH` `DELETE` | `/api/events/:eventId/guests/:guestId`                    |                                          |
| `POST`                 | `/api/events/:eventId/guests/bulk-delete` · `bulk-status` |                                          |
| `POST`                 | `/api/events/:eventId/guests/import/parse`                | multipart `file`; .xlsx or .csv          |
| `POST`                 | `/api/events/:eventId/guests/import/validate`             | Dry run — the errors screen              |
| `POST`                 | `/api/events/:eventId/guests/import/commit`               | Partial success                          |
| `POST`                 | `/api/events/:eventId/guests/:guestId/send`               | Builds the wa.me link, marks `SENT`      |
| `GET`                  | `/api/events/:eventId/guests/:guestId/link`               | Preview; marks nothing                   |
| `POST`                 | `/api/events/:eventId/guests/bulk-send`                   | A selection, or everyone unsent          |
| `GET` `POST`           | `/api/events/:eventId/design-request`                     | The two open design jobs / open a custom one |
| `POST`                 | `/api/events/:eventId/design-request/:id/cancel`          | Before the operator has delivered        |
| `POST` `DELETE`        | `/api/events/:eventId/card`                               | multipart `file`; the host's own artwork |
| `GET` `POST`           | `/api/events/:eventId/batches`                            | Delegated invitation blocks              |
| `POST` `DELETE`        | `/api/events/:eventId/batches/:batchId`                   | `/sent` stamps the handover; delete keeps claimed guests |

Public — no authentication. The token is the only credential a guest holds, so every route
here is rate limited: 60 bits of entropy is unguessable only if guessing is bounded.

| Method | Path                         | Notes                             |
| ------ | ---------------------------- | --------------------------------- |
| `GET`  | `/api/invite/:token`         | Marks `OPENED`; never cached      |
| `POST` | `/api/invite/:token/respond` | Atomic `attending` + `companions` |
| `GET`  | `/api/invite/:token/qr`      | Signed payload + seat count       |
| `GET`  | `/api/invite/:token/qr.png`  | Downloadable PNG                  |
| `GET`  | `/api/invite/demo/qr.png`    | The sample invitation's QR — signs nothing |

The guest-facing page is server-rendered at `/invite/<token>` — deliberately outside the
`/[locale]` prefix, because a guest opens a bare link straight from WhatsApp with no locale
to carry. `?lang=en` switches to the LTR mirror.

Delegated distribution is the second token-only surface, and the same reasoning applies to
every line of it:

| Method  | Path                                    | Notes                                  |
| ------- | --------------------------------------- | -------------------------------------- |
| `GET`   | `/api/batch/:token`                     | That batch's slots, and no other guest |
| `PATCH` | `/api/batch/:token/slots/:guestId`      | Name and number, fill-only             |
| `POST`  | `/api/batch/:token/slots/:guestId/sent` | Marks `SENT`; enforces the package cap |

### Delegated invitations

The case, in the host's words: أم العريس cannot invite أم العروس's guests, because she does
not have their numbers — but أم العروس does. So the host mints a block of invitations and
sends **one** message carrying `/batch/<token>`; the delegate opens it and forwards each
invitation from her own phone.

What is delegated is the sending, not the event. Every slot is an ordinary `Guest` with its
own `Invitation`, its own link and its own QR at the door — fifty slots are fifty barcodes,
not one shared card. Nothing about RSVP, check-in or the report changes.

That required `Guest.name` and `Guest.phone` to become nullable, which is the interesting
part of the change:

- **The name is optional twice over.** The delegate types it if she has it; if she leaves it
  blank the *guest* is asked at RSVP, and `respond()` writes it in the same atomic write.
  Fill-only in both directions — a name, once given, cannot be overwritten by a second holder
  of a forwarded link, because the door greets people by it.
- **Nothing nameless renders blank.** `guestDisplayName()` is the single fallback
  («ضيفنا الكريم»), and `guestExportName()` is the deliberate exception: a spreadsheet shows
  an unclaimed row as empty, because the host reading it is counting people.
- **Phoneless slots never reach a link builder.** `prepareBatchSend` filters them at the
  query, so «أرسلها الآن» cannot fill with `wa.me/undefined` — a link the host taps once and
  never diagnoses. The dashboard's unsent tile splits the same way (`pendingSend`): it counts
  delegated slots but does not offer to send them, because they wait on someone else.
- **Deleting a batch does not delete people.** Only untouched slots go; anyone named,
  numbered or sent to keeps their row and loses only the batch link.

The delegate page never *opens* an invitation — `GET /api/invite/:token` marks a guest
`OPENED`, so a delegate checking her links would report fifty guests as having read
invitations nobody had received yet. She shares or copies the message instead, through the
native share sheet where the browser has one: she holds her guests as contacts, not as digits
she would type fifty times.

The door — authenticated by a scanner session (`X-Scan-Session`), never a user account.
The event is taken from the session row, so there is no request shape in which a door can
name a different event:

| Method | Path                      | Notes                                           |
| ------ | ------------------------- | ----------------------------------------------- |
| `POST` | `/api/scan/gate/:eventId` | Event password + scanner name → session         |
| `GET`  | `/api/scan/session`       | Who is on shift                                 |
| `POST` | `/api/scan/check-in`      | `qrToken` **or** `displayCode` **or** `guestId` |
| `POST` | `/api/scan/override`      | Admit anyway, after a `USED` verdict            |
| `GET`  | `/api/scan/search`        | «ابحث بالاسم يدويًا»                            |
| `GET`  | `/api/scan/log`           | Door timeline + counters                        |

Host-side, over the same data:

| Method   | Path                                            | Notes                                |
| -------- | ----------------------------------------------- | ------------------------------------ |
| `GET`    | `/api/events/:eventId/scan/sessions`            | Who worked the door                  |
| `POST`   | `/api/events/:eventId/scan/sessions/:id/revoke` | End a session                        |
| `GET`    | `/api/events/:eventId/checkins`                 | Same timeline, for the host          |
| `DELETE` | `/api/events/:eventId/checkins/:checkInId`      | Revoke — frees the guest to re-enter |

The scanner UI is at `/scan/<eventId>`. The session lives in `localStorage`, scoped per
event, so staff can reload or hand the phone over without going back through the gate.

Dashboard, report and exports — host-authenticated, scoped to their own events:

| Method | Path                                           | Notes                                       |
| ------ | ---------------------------------------------- | ------------------------------------------- |
| `GET`  | `/api/events/:eventId/dashboard`               | §03 aggregates; carries its own `updatedAt` |
| `GET`  | `/api/events/:eventId/report`                  | §12 post-event report                       |
| `GET`  | `/api/events/:eventId/exports/guests.xlsx`     | Guest list                                  |
| `GET`  | `/api/events/:eventId/exports/attendance.xlsx` | Report across four sheets                   |

### Web routes

| Path                               | Who                                                      |
| ---------------------------------- | -------------------------------------------------------- |
| `/<locale>/login`                  | Host                                                     |
| `/<locale>/dashboard`              | Host — polls every 30s and on tab focus                  |
| `/<locale>/events/:eventId/card`   | Host — the three design routes                           |
| `/<locale>/events/:eventId/report` | Host                                                     |
| `/<locale>/demo`                   | Anyone — the sample invitation, on the real invite screen |
| `/invite/<token>`                  | Guest — no account, no locale prefix                     |
| `/batch/<token>`                   | A delegate distributing a block — no account             |
| `/scan/<eventId>`                  | Door staff — event password, no account                  |

`/<locale>/demo` renders `InviteScreen` itself rather than a mock, so what a prospect judges
the product by cannot drift from what a guest receives. It writes nothing: there is no guest
and no event behind it, and answering moves local state only. The landing page's
«شاهد نموذج دعوة» points at it, and the form beside that button opens WhatsApp with the
sample link addressed to the visitor's own number — the same `wa.me` mechanism the product
uses for real invitations, so the demo demonstrates the actual delivery model.

### A note on the numbers

Rates are returned as ratios in 0–1, never pre-formatted percentages: Arabic renders ٥٨٪ and
English 58%, and a server that has already decided cannot serve both. Attendance is `null`
rather than `0` before anyone has been admitted — "0% attended" on the morning of a wedding
reads as a catastrophe, when the truth is "not yet". Seats are summed, never guest counts:
one scan admits a family, which is why the door log shows «١٤٢ مقعدًا دخل · ٥٨ عملية مسح».

Exported phone numbers are written as text with an explicit `@` cell format. Excel otherwise
reads `+966554128830` as a formula or a number and silently destroys it — the most common
way an exported contact list arrives useless.

Orders and payments — host-authenticated:

| Method       | Path                       | Notes                                                  |
| ------------ | -------------------------- | ------------------------------------------------------ |
| `GET` `POST` | `/api/orders`              | List / create. **The request carries no price.**       |
| `GET`        | `/api/orders/:orderId`     |                                                        |
| `POST`       | `/api/orders/:orderId/pay` | Opens a payment with the provider                      |
| `POST`       | `/api/webhooks/:provider`  | Gateway callback — signed, idempotent, unauthenticated |

Admin — `ADMIN` role only:

| Method          | Path                                              | Notes                                  |
| --------------- | ------------------------------------------------- | -------------------------------------- |
| `GET`           | `/api/admin/stats`                                |                                        |
| `GET` `PATCH`   | `/api/admin/users` · `/users/:userId`             |                                        |
| `GET` `PATCH`   | `/api/admin/events` · `/events/:eventId`          |                                        |
| `GET` `PUT`     | `/api/admin/packages` · `/api/admin/templates`    |                                        |
| `POST` `DELETE` | `/api/admin/templates/:templateId/preview`        | multipart `file`; the gallery artwork  |
| `GET` `PATCH`   | `/api/admin/design-requests` · `/:requestId`      | The design queue; status, price, reply |
| `POST`          | `/api/admin/design-requests/:requestId/artwork`   | Deliver the finished file              |
| `GET`           | `/api/admin/orders`                               |                                        |
| `GET` `PUT`     | `/api/admin/settings` · `/settings/logo`          | Branding, and the custom-design price  |

Web: `/<locale>/checkout/:orderId` and `/<locale>/admin`.

### The three routes to a card

The design step asks one question — «كيف تبغى بطاقتك؟» — and stores the answer as
`Event.cardDesignMode`, rather than leaving a precedence rule to decide between whichever
fields happen to be populated:

| Mode             | What the host does                     | What the operator does                          |
| ---------------- | -------------------------------------- | ----------------------------------------------- |
| `TEMPLATE`       | Picks from the gallery                 | Tailors it to the event and uploads the result  |
| `CUSTOM_REQUEST` | Writes a brief; we call them           | Quotes a price, draws it, uploads it            |
| `UPLOAD`         | Brings their own file, or pastes a URL | Nothing                                         |

Both operator routes are one queue (`CustomDesignRequest`, `kind` =
`TEMPLATE_TAILORING | CUSTOM`) and end the same way: the finished file is written into the
event's existing card slot, so `GET /api/events/:id/card` and `resolveArtwork` need no second
storage path. Only `CUSTOM` carries a price; it is quoted per job — «بسعر خاص» — and becomes
an order line item at checkout, stamped `billedAt` inside the same transaction that marks the
order `PAID` so a retried webhook or a later upgrade order cannot charge for it twice.

The advertised "from" figure lives in `PlatformSettings.customDesignPriceHalalas`, so
changing it is an admin action rather than a deploy.

Template gallery artwork is uploaded, not linked: «ارفقها في الموقع» has to mean a file, and
a URL-only column would leave the gallery empty until the operator found somewhere to host
each design. Bytes live on the row like the platform logo, served by
`GET /api/templates/:id/preview`.

### Payments

Everything the API knows about a gateway lives behind `PaymentProvider`
(`apps/api/src/services/payment/index.ts`). Swapping the stub for Moyasar, Tap or HyperPay
means writing one class — no caller sees a provider-specific shape.

Three properties carry this area:

- **The server prices the order.** Nothing in the request body carries an amount; every
  figure is read from the catalogue. A client can change _what_ it buys — validated too —
  but there is no field in which it could state what that costs.
- **Webhook signatures cover the raw bytes.** `express.json`'s `verify` hook keeps them,
  because `JSON.stringify(JSON.parse(body))` is not what the gateway signed.
- **Deliveries are idempotent.** `@@unique([provider, providerEventId])` rejects a retry at
  the database before it can double-apply a payment or fire the new-order notification
  twice. Every gateway retries; most retry aggressively. Unknown event types are recorded
  and acknowledged with 200 rather than failed — a 500 makes a gateway retry forever and
  eventually disable the endpoint.

Settlement runs through one function whether the stub answers synchronously or a real
gateway calls back later, so the path that matters in production is the one exercised in
development.

### What the admin panel deliberately cannot do

There is no route into a host's guest list and no way to answer on a guest's behalf.
Support can grant headroom, disable an account and edit the catalogue; the personal data and
the guest's own word stay with the host. An admin also cannot demote or disable their own
account — there is no second door.
