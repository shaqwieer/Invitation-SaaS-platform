# API ↔ UI coverage audit

> **Superseded by the build of 2026-08-02.** The 28 gaps this audit found have
> since been implemented — see the "After the build" section at the foot of this
> file. The route-by-route tables below describe the state *before* that work and
> are kept as the record of what was missing and why.

Every backend route, and whether a user can reach it through the web app.

Method: all 59 `/api` routes were enumerated from the eight `*.routes.ts` files
plus the mount table in `apps/api/src/app.ts:97-107`; every API call the web app
makes was extracted from `apps/web/src`. The two lists were then diffed. Audited
2026-08-02.

## The short answer

**25 of 59 routes are wired to the UI. 28 have no UI at all.**

The gap is not scattered — it is one shape:

> **The web app can operate seeded data. It cannot originate any.**

A host who registers through the API can sign in and look at a dashboard, but
through the browser alone they cannot create an event, add a guest, import a
list, edit or delete anything they own, or buy a package. Every read path that
matters is built; almost the entire create/edit surface is not.

This is not hypothetical: the two extra host accounts in this database
(`+966559998877`, `+966553319074`), each owning an event with guests and a paid
order, were necessarily created through the API — there is no browser path that
could have produced them.

| Bucket                                        | Count |
| --------------------------------------------- | ----- |
| ✅ Wired to the UI                             | 25    |
| ◐ Route unused, but the data reaches the UI elsewhere | 5 |
| ❌ No UI at all                                | 28    |
| — Server-to-server by design                   | 1     |

---

## Auth — `/api/auth`

| Route                | Status | Where / why                                    |
| -------------------- | ------ | ---------------------------------------------- |
| `POST /login`        | ✅     | `/[locale]/login`                              |
| `POST /refresh`      | ✅     | automatic, `lib/auth.tsx`                      |
| `POST /logout`       | ✅     | dashboard header button                        |
| `GET  /me`           | ◐      | never called; session state comes from refresh |
| `POST /register`     | ❌     | **no sign-up page anywhere**                   |
| `POST /otp/request`  | ❌     | OTP login is implemented server-side only      |
| `POST /otp/verify`   | ❌     | same                                           |

Registration having no UI is the first link in the chain: a new user cannot
create an account, and if they could, they would land on the empty-state
dead-end described below.

## Events — `/api/events`

| Route                                        | Status | Where / why                            |
| -------------------------------------------- | ------ | -------------------------------------- |
| `GET  /`                                     | ✅     | dashboard event list + switcher        |
| `GET  /:id/dashboard`                        | ✅     | dashboard                              |
| `GET  /:id/report`                           | ✅     | report page                            |
| `GET  /:id/exports/guests.xlsx`              | ✅     | dashboard link                         |
| `GET  /:id/exports/attendance.xlsx`          | ✅     | report page link                       |
| `GET  /:id/quota`                            | ◐      | never called; quota is bundled into the dashboard summary and rendered |
| `GET  /:id`                                  | ◐      | never called. Title/date/timezone come via the dashboard summary; the rest of the record (venue, card colour, template, WhatsApp text) is unreachable |
| `POST /`                                     | ❌     | **cannot create an event**             |
| `PATCH /:id`                                 | ❌     | cannot edit an event — including setting the scanner password |
| `DELETE /:id`                                | ❌     | cannot delete an event                 |
| `GET  /:id/scan/sessions`                    | ❌     | host cannot see who is scanning at the door |
| `POST /:id/scan/sessions/:sid/revoke`        | ❌     | host cannot revoke a compromised scanner session |
| `GET  /:id/checkins`                         | ❌     | host has no check-in list view          |
| `DELETE /:id/checkins/:cid`                  | ❌     | host cannot undo a mistaken check-in    |

The scanner-session pair is the sharpest operational gap here. Door staff
authenticate with a shared password; if that password leaks mid-event, the API
can revoke the session but the host has no way to do it from a phone.

## Guests — `/api/events/:eventId/guests`

Thirteen routes. **One** is reachable.

| Route                      | Status | Where / why                                 |
| -------------------------- | ------ | ------------------------------------------- |
| `POST /bulk-send`          | ✅     | the dashboard's «أرسلها الآن» button         |
| `GET  /`                   | ❌     | **there is no guest list page**              |
| `POST /`                   | ❌     | cannot add a guest                           |
| `GET  /:guestId`           | ❌     | cannot view a guest                          |
| `PATCH /:guestId`          | ❌     | cannot edit a guest                          |
| `DELETE /:guestId`         | ❌     | cannot remove a guest                        |
| `POST /bulk-delete`        | ❌     | —                                            |
| `POST /bulk-status`        | ❌     | cannot mark someone confirmed by hand (the phone-call RSVP) |
| `POST /import/parse`       | ❌     | the whole Excel/CSV import wizard is server-only |
| `POST /import/validate`    | ❌     | —                                            |
| `POST /import/commit`      | ❌     | —                                            |
| `POST /:guestId/send`      | ❌     | see below                                    |
| `GET  /:guestId/link`      | ❌     | cannot preview one guest's invitation link   |

**`POST /:guestId/send` deserves its own note.** It looks covered by the
dashboard's send button, but it is not: that button posts `{onlyUnsent: true}`
to `bulk-send`, so it only ever touches guests still at `NOT_SENT`. Re-sending to
a guest already marked `SENT` — the most common real-world follow-up a host
does, when someone says "I never got it" — has no path in the UI at all.

The three-step import pipeline is the largest single piece of built-and-unreachable
backend in the codebase.

## Orders — `/api/orders`

| Route                | Status | Where / why                                  |
| -------------------- | ------ | -------------------------------------------- |
| `GET  /:orderId`     | ✅     | checkout page                                |
| `POST /:orderId/pay` | ✅     | checkout page                                |
| `POST /`             | ❌     | **nothing creates an order** — no package-picker screen |
| `GET  /`             | ❌     | no order history / receipts view             |

The checkout page is fully built and works, but it can only be reached by
knowing an order id. Nothing in the UI produces one, so in practice the payment
flow is unreachable by a real user.

## Admin — `/api/admin`

| Route                  | Status | Where / why                                |
| ---------------------- | ------ | ------------------------------------------ |
| `GET  /stats`          | ✅     | stat tiles                                 |
| `GET  /users`          | ✅     | users tab                                  |
| `PATCH /users/:userId` | ✅     | promote/demote, enable/disable             |
| `GET  /events`         | ✅     | events tab                                 |
| `GET  /packages`       | ✅     | packages tab                               |
| `GET  /orders`         | ✅     | orders tab                                 |
| `PATCH /events/:id`    | ❌     | events tab is **read-only** — no row actions |
| `PUT  /packages`       | ❌     | packages tab is read-only; prices and caps are not editable |
| `GET  /templates`      | ❌     | no templates tab exists                    |
| `PUT  /templates`      | ❌     | —                                          |

Admin is the best-covered area: the users tab is the only place in the entire
app with working write actions besides RSVP, checkout and the scanner. The other
three tabs render data but expose none of their `PATCH`/`PUT` counterparts.

## Invitations — `/api/invite` (public, no account)

| Route                   | Status | Where / why                                |
| ----------------------- | ------ | ------------------------------------------ |
| `GET  /:token`          | ✅     | invite page, server-rendered               |
| `POST /:token/respond`  | ✅     | accept / decline / companion count          |
| `GET  /:token/qr.png`   | ✅     | QR image on the confirmation screen         |
| `GET  /:token/qr`       | ◐      | the JSON variant; the page uses `qr.png`    |

**Fully covered.** The guest-facing flow is the one part of the product where
the UI matches the API.

## Scanner — `/api/scan` (scanner session, no account)

| Route                | Status | Where / why                                  |
| -------------------- | ------ | -------------------------------------------- |
| `POST /gate/:eventId`| ✅     | gate screen                                  |
| `POST /check-in`     | ✅     | camera + manual check-in                     |
| `POST /override`     | ✅     | admit-anyway with a reason                   |
| `GET  /search`       | ✅     | manual search by name or door code           |
| `GET  /log`          | ✅     | session log view                             |
| `GET  /session`      | ◐      | never called; the client keeps the session in `localStorage`, and `requireScanSession` validates it on every other scan route anyway |

**Fully covered.** Like the invite flow, the door app is complete.

## Webhooks — `/api/webhooks`

| Route             | Status | Where / why                              |
| ----------------- | ------ | ---------------------------------------- |
| `POST /:provider` | —      | server-to-server payment callback. Correctly has no UI. |

`GET /health` is likewise deliberately not user-facing and is excluded from the
59.

---

## What this means in practice

The product splits cleanly in two.

**Complete:** everything a *guest* or *door attendant* touches. The invite flow
and the scanner are fully wired, and those are the two surfaces that face
non-technical users at the event itself.

**Incomplete:** everything a *host* does before the event. The dashboard reports
beautifully on data it cannot help you create. In the current build a host must
be onboarded through the API — account, event, guest list, package — after which
the browser takes over and works well.

### Suggested build order

Everything above this heading is verified fact. What follows is a judgement call
about sequencing, not an audit finding — the ordering that unblocks the most:

1. **Guest list page** (`GET/POST/PATCH/DELETE /guests`) — without it the
   dashboard reports on numbers the host cannot influence.
2. **Event create/edit** (`POST /events`, `PATCH /:id`) — also the only way to
   set a scanner password, which the door flow depends on.
3. **Package picker** (`POST /orders`) — connects the finished checkout page to
   the rest of the app.
4. **Sign-up** (`POST /auth/register`) — needed before any of the above matters
   to a new customer.
5. **Import wizard** (`/guests/import/*`) — the largest built-but-unreachable
   surface, and the reason a 300-guest wedding is currently impractical.
6. **Re-send to one guest** (`POST /guests/:guestId/send`) — small, and the most
   frequently needed missing action during a live campaign.

---

## After the build (2026-08-02)

All 28 gaps are now reachable from the browser. What was added:

| Screen | Route | Backend it covers |
| --- | --- | --- |
| Application shell | all host pages | `GET /events`, `GET /events/:id/quota` |
| Sign-up | `/[locale]/register` | `POST /auth/register` |
| SMS code sign-in | `/[locale]/login` | `POST /auth/otp/request`, `/otp/verify` |
| Event wizard | `/[locale]/events/new` | `POST /events`, `POST /orders` |
| Event settings | `…/events/:id/settings` | `GET/PATCH/DELETE /events/:id` incl. `scannerPassword` |
| Card editor | `…/events/:id/card` | `PATCH /events/:id` (card fields) |
| Guest list | `…/events/:id/guests` | all 13 guest routes except import |
| Import wizard | `…/guests/import` | `import/parse`, `import/validate`, `import/commit` |
| Door sessions + log | `…/events/:id/scanners` | `scan/sessions`, `…/revoke`, `checkins`, `checkins/:id` |
| Orders | `/[locale]/orders` | `GET /orders` |
| Admin (extended) | `/[locale]/admin` | `PATCH /admin/events/:id`, `PUT /admin/packages`, `GET/PUT /admin/templates` |

**One backend addition was required.** Packages and templates were readable only
through `/api/admin`, so the wizard, the card editor and the package picker —
all host-facing screens whose whole job is to *choose* one — had nothing to read.
`GET /api/catalogue` was added (`apps/api/src/modules/catalogue/catalogue.routes.ts`):
read-only, active rows only, and without the `_count` aggregates the admin
listing carries. Editing still lives behind `/api/admin`.

The four routes marked ◐ above remain uncalled, and still correctly so: `/auth/me`
(session comes from refresh), `/events/:id/quota` is now called by the shell,
`/invite/:token/qr` (the page uses `qr.png`), and `/scan/session`
(`requireScanSession` validates on every other scan route).

**The landing page (§01) is now built too.** `/[locale]` replaced the Phase 1
scaffold: hero, how-it-works, pricing, FAQ and footer. It is a server component
with no client JavaScript — the FAQ is native `<details>` — and its prices are
read from `GET /api/catalogue` at request time (revalidated every 5 minutes)
rather than hardcoded, so a price change in the admin panel reaches the public
page without a deploy.

**Cross-tenant guard.** `EventContext` no longer falls back to the host's first
event when the URL names an event they cannot see. A route-supplied `eventId` is
now the only candidate, and `eventMissing` drives a not-found screen in the
shell — previously the sidebar showed *your* event while the page below fetched
someone else's and failed.

Every design-doc screen is now implemented.

---

## Branding is operator-editable (2026-08-02)

The product's own identity used to be code: a constant in `Logo.tsx`, the tab
title in `layout.tsx`, and `brand.name` in the message files. Renaming meant a
deploy. It is now a row in the database, edited from **Admin → الهوية**.

| Route | Purpose |
| --- | --- |
| `GET /api/settings` | Public branding — name, tagline, logo mark, logo URL |
| `GET /api/settings/logo` | The uploaded image, straight from the database |
| `GET /api/admin/settings` | Same payload, for the editor |
| `PUT /api/admin/settings` | Names, taglines and the fallback letter |
| `POST /api/admin/settings/logo` | Upload (PNG/JPEG/SVG/WebP, ≤512 KB) |
| `DELETE /api/admin/settings/logo` | Remove the image; falls back to the letter |

Three decisions worth keeping:

**The logo lives in the database, not on disk.** A file on a container
filesystem disappears on the next deploy unless a volume is mounted and
remembered. A logo is a few kilobytes, so storing the bytes in `PlatformSettings`
means the VPS deploy has one less piece of state to get right — no volume, no
backup path, and `pg_dump` already captures it.

**Branding is read with `cache: 'no-store'`.** It was cached for 60 seconds
first, and the result was that an admin saved a new name, the page reloaded, and
the old name came back — indistinguishable from a failed save. If that read ever
shows up in a profile, the fix is a tagged cache the save revalidates, not a
longer TTL.

**`logoUrl` is returned as a path, resolved to an absolute URL client-side**
(`apiUrl()` in `lib/api.ts`). Left relative it resolves against the *web* origin,
which works behind nginx — where `/api` is proxied — and 404s everywhere else,
including local development. That bug was live until it was caught by loading the
path from the web origin rather than trusting that the markup looked right.

---

## The legal pages are operator-editable (2026-08-07)

The three documents a paid Saudi service publishes — الشروط والأحكام,
سياسة الخصوصية, سياسة الاسترجاع — did not exist. The checkout's consent line
named two of them in prose, which meant a buyer agreed above the pay button to
terms that were nowhere on the site. They are now rows in `LegalDocument`, edited
from **Admin → الصفحات القانونية** and served at `/<locale>/legal/:slug`.

| Route | Purpose |
| --- | --- |
| `GET /api/legal` | Published titles and slugs — the footer's list |
| `GET /api/legal/:slug` | One document; `?locale=en` for the English |
| `GET /api/admin/legal` | All three including unpublished drafts |
| `PUT /api/admin/legal/:slug` | Titles, bodies, publication state |

Four decisions worth keeping:

**Seeded on read, not by `db:seed`.** `getLegalDocuments` issues one
`createMany({ skipDuplicates: true })` when a document is missing, so a box that
ran `db:deploy` without a seed still serves its own footer links. It replaced a
find-then-upsert, which lost the race when two visitors opened the footer at the
same instant on a fresh database and answered one of them a 500.

**The body is neither HTML nor Markdown.** A blank line separates paragraphs,
`## ` opens a section, `- ` is a list item; `LegalBody` parses that into React
elements. Operator-authored text through `dangerouslySetInnerHTML` would be
stored XSS by design, and three block types do not justify a parser — `apps/web`
still has no Markdown dependency.

**Read with `no-store`**, for the reason the branding section above records: a
cached policy means an operator corrects a refund clause, reloads, reads the old
one, and cannot tell the save from a failure.

**الشروط and الاسترجاع cannot be unpublished.** The footer renders from the
published list and so heals itself; the consent line above the pay button names
those two and does not, so taking one down would leave a buyer's only route to
what they are agreeing to at a 404. سياسة الخصوصية has no such link and may be
taken down while it is rewritten.

An empty English body falls back to the Arabic — writing the Arabic and leaving
the English for later is the normal case, and a title over a blank page reads as
a broken site rather than an untranslated one.

**The shipped text is a first draft.** It describes what this product actually
does, it has not been through a lawyer, and it carries a deliberate blank —
`[بريد الدعم]` — that an operator must replace.
