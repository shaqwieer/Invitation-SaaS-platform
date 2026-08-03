# Testing دعوة by hand

A single walkthrough of the whole product in a browser. **No terminal, at any
point.** It follows one wedding from an empty account to a post-event report, in
the order a real host would.

Verified against the running stack on 2026-08-02: every screen loaded, all three
logins were checked against the live API, the sample import file was run through
the real import pipeline, and every Arabic label below is copied from
`apps/web/messages/ar.json` rather than paraphrased.

---

## 0. Before you start

The stack should already be up. If not: `docker compose up -d`.

| | |
| --- | --- |
| **Open this** | **`http://localhost:3000/ar`** |
| API (only if you're curious) | `http://localhost:4001` |
| Postgres | container-only, not reachable from your machine |

The API is on **4001**, not the 4000 in the README, because a host `npm run
dev:api` holds 4000 on this machine. That's `docker-compose.override.yml`.

### Accounts

All three passwords are `Demo@1234`.

| Role | Phone | For |
| --- | --- | --- |
| Host with the demo wedding | `+966500000000` | Parts 2–7. 20 guests already loaded. |
| Host with nothing | `+966500000001` | The empty state in §1.3 |
| Admin | `+966500000009` | Part 8 |

The phone field normalises input, so `500000000`, `0500000000` and
`٠٥٠٠٠٠٠٠٠٠٠` all reach the same account — worth trying once.

Door scanner password for the demo wedding: **`door1234`**

### Two things that will interrupt you

**Sign-in is rate limited to 10 attempts per 15 minutes.** Testing the empty
state and the admin panel means signing in and out repeatedly, and you *will*
hit it. A `429` is the app working correctly, not a bug — wait it out, or stay
signed in and use a second browser profile for the other account.

**Resetting wipes the ids in this guide.** There is no reset button in the UI, and
you do not need one for this walkthrough — it creates its own event and guests
rather than depending on the seeded ones.

---

## Part 1 — Getting in

### 1.1 The landing page

Open **`http://localhost:3000/ar`**.

You should see the hero: a WhatsApp conversation with an invitation card inside
it. That's the product's central claim made visible — the invitation arrives from
the host's own number, not from a stranger.

Check while you're here:

- The three prices in **الأسعار** come from the database, not the page. They are
  ٢٤٩ / ٤٤٩ / ٧٤٩, and «باقة المناسبة» carries the **الأكثر طلبًا** badge.
- The **الأسئلة الشائعة** accordion opens and closes with the keyboard alone
  (Tab to a question, then Enter). It's a native `<details>` — no JavaScript.
- The **EN** toggle top-left flips the whole page to English and LTR.

### 1.2 Create an account

Click **ابدأ مناسبتك** in the header.

Fill in a name, any unused Saudi mobile (e.g. `0561112233`), and a password of at
least 8 characters.

**Expect:** you're signed in immediately — no second login — and land straight on
the event wizard. Registering and then asking you to type the same password again
would be friction with no security value.

Try it twice with the same number: the second attempt says
«هذا الرقم مسجّل بالفعل» rather than a database error.

### 1.3 The empty state

Sign out (top-right), then sign in as `+966500000001` / `Demo@1234`. This host
owns nothing.

**Expect:** «لا توجد مناسبات بعد» with a **مناسبة جديدة** button. This used to be
a dead end; the button is the point.

### 1.4 Signing in with an SMS code

Sign out and, on the login screen, click **الدخول برمز يصل عبر رسالة نصية**.

Enter `500000000` and press **أرسل الرمز**. You get a six-digit box and a
countdown before you can resend.

> **You will not receive an SMS.** `SMS_PROVIDER=console`, so the code is printed
> to the API log rather than sent. Retrieving it needs a terminal, which this
> guide avoids — so treat this as a UI check only: the code box appears, the
> resend countdown ticks down, and **الدخول بكلمة المرور** takes you back. A
> wrong code says «الرمز غير صحيح أو انتهت صلاحيته».

---

## Part 2 — Creating an event

Sign in as **`+966500000000`** and click **مناسبة جديدة** (top-right of the
dashboard, or in the sidebar's empty state).

### 2.1 Step ١ · التفاصيل

Fill in an event name, a host name, and pick a date a few months out. Everything
else is optional.

**Watch the card on the right.** It updates as you type — the name, the hosts, the
venue, the date in both Gregorian and Hijri. That's deliberate: you should see the
invitation as your guests will see it before you pay for it.

**التالي** stays disabled until the name, host name and date are filled.

### 2.2 Step ٢ · التصميم

Pick a colour from the swatches, or use the colour picker for anything else. Switch
**خط العنوان** between **أميري** and **بلكس عربي** — the preview's heading font
changes with it.

### 2.3 Step ٣ · الباقة

Three packages, read live from the same catalogue the landing page uses.

Two ways out, and both are worth testing on separate runs:

- **اختر هذه الباقة** creates the event *and* an order, then drops you on
  checkout.
- **تخطَّ الآن وادفع لاحقًا** creates the event and goes straight to its guest
  list.

The event is created before the order, deliberately: if checkout fails or you
abandon it, you still have an event rather than having lost everything you typed.

Take the **skip** path for now — we'll come back to payment in Part 6.

---

## Part 3 — Guests

You're on **قائمة الضيوف** for your new event. It's empty:
«لا يوجد ضيوف بعد» with two ways forward.

### 3.1 Add one by hand

**إضافة ضيف** → name, phone, and **عدد المرافقين المسموح** (try 2). Save.

Add a second guest with the *same phone number*: it's refused with
«هذا الرقم مسجّل لضيف آخر في هذه المناسبة», naming the clash rather than
failing with a constraint error.

### 3.2 Import a list

**استيراد من ملف**. You need a file — download the sample:

**`http://localhost:3000/sample-guests.csv`**

It has 8 rows and is deliberately messy: phone numbers in three different formats
(`05…`, `+966…`, `966…`), one row with no name, and one duplicate.

**Step ١ · الرفع** — drag the file in, or use **اختيار ملف من الجهاز**.

**Step ٢ · مطابقة الأعمدة** — all four Arabic columns are recognised
automatically. Name, phone and companions are tagged **تطابق تلقائي**; the group
column is a fuzzy match and is flagged **راجع الاختيار** so you check it rather
than trust it. Any column can be remapped, or set to **تجاهل هذا العمود**.

**Step ٣ · المراجعة** — the real payload, verified:

- **٢ صفوف تحتاج انتباهك** — row 7 «خانة الاسم فارغة», row 8 «مكرر مع الصف ٢»
- **٦ صفوف جاهزة للاستيراد**
- «وحّدنا صيغة ٥ أرقام تلقائيًا» — the three phone formats became one

That's the design's rule working: one bad row never fails the whole import.

**استيراد الآن** commits the 6 good rows and returns you to the list.

### 3.3 Sending

Each row carries **إرسال عبر واتساب** — visible, never hidden behind a `⋯` menu,
because it's the action you'll repeat hundreds of times.

Click it on one guest. WhatsApp's link opens in a new tab, and the button becomes
**أُرسلت · إعادة** — a quiet state rather than disappearing, so you can see where
you stopped. Click it again: re-sending works, which is what you need when
someone says the message never arrived.

Now tick two or three checkboxes. A bar appears:

- **إرسال للمحدّدين** — one tappable link per guest. The app deliberately does
  *not* fire several `window.open` calls; browsers block all but the first, so an
  automatic burst would send one invitation and silently drop the rest.
- **تغيير الحالة** — mark someone مؤكّد by hand, for the guest who replies by
  phone call.
- **حذف** — asks before it does it.

Also worth a look: the search box (try a partial name, and try a phone number),
the status chips along the top (they show the whole event's breakdown, not the
filtered one), and **تصدير Excel**.

---

## Part 4 — The guest's side

This is the part your customers actually see, and it needs no account.

Open the guest list, click **إرسال عبر واتساب** on any guest, and copy the
invitation link from the dialog — or use a seeded one:
**`http://localhost:3000/invite/59ys5njcvzz6`**

**Accepting:** the card shows the couple, the date in both calendars, and the
venue. Pick a companion count, then **يسعدني الحضور**.

**Expect:** the card flips to a confirmation with a **QR code**, a door code, and
the seat count. If the QR image renders, the browser-side API wiring is correct.
Also there: **حفظ كصورة**, **أضف للتقويم** (downloads an `.ics`), **الاتجاهات**,
and **تعديل ردّي أو عدد المرافقين**.

**Declining and changing your mind:** `http://localhost:3000/invite/m9j42bsesf6d`
is already declined. It offers «تغيّر ظرفك؟» and
**أستطيع الحضور بعد كل شيء**.

**A bad link:** `http://localhost:3000/invite/nonexistent` shows
«هذا الرابط غير صالح». Note it returns HTTP 200, not 404 — a soft 404 by design.

---

## Part 5 — The door

### 5.1 Set the password

The scanner needs a password before it will open. Sidebar → **الإعدادات** →
**كلمة مرور الاستقبال**. Type one — at least 8 characters, same rule as an
account password — and save. The badge flips to **مضبوطة**.

For the *seeded* wedding it's already set to `door1234`.

### 5.2 Scan

Sidebar → **ماسح الاستقبال** → **فتح صفحة الماسح**. It opens
`/scan/<eventId>` in a new tab — a route with **no account at all**. Door staff
don't have logins; the event id plus the password is the whole credential, which
is why the gate is rate-limited to 10 attempts per 15 minutes.

Enter the password and a display name — the name is stored so every check-in is
attributable to a person on shift.

> **The camera only works on `localhost`.** `getUserMedia` needs a secure context,
> so opening this page from your phone at `http://<lan-ip>:3000` fails to acquire
> the camera with no useful error. Test on this machine, or use manual search —
> which works everywhere and is the more useful path anyway.

Switch to manual search and find a guest by name or door code. Check them in.
Then try the same guest again: you get an "already checked in" state, not a silent
second entry.

Worth probing: a wrong gate password (indistinguishable from a nonexistent event —
it tells an outsider nothing), and admitting a declined guest via the override,
which records a reason.

### 5.3 Undo and revoke

Back on **ماسح الاستقبال** in the host app, you now see two tables.

**حسابات الاستقبال** lists every session your door team opened.
**إنهاء الجلسة** kills one — the remedy if the door password gets out mid-event.

**سجل الدخول** below lists every arrival with who scanned them. **تراجع** undoes a
mistaken check-in and frees the seat.

---

## Part 6 — Paying

Sidebar → **الطلبات والفواتير**.

If you took the **skip** path in §2.3 you have no order. Create one: go to
**مناسبة جديدة**, fill in step ١ quickly, and pick a package at step ٣ — that
lands you on checkout.

There's also a pending order on the seeded wedding:
**`http://localhost:3000/ar/checkout/cmsbm5jmp0015pm31i9oc722j`**

**Expect:** the order summary with VAT on its own line — hosts usually forward this
figure to family, and an unexplained number invites a phone call — and four payment
methods with **mada first**, because it's the dominant card locally.

`PAYMENT_PROVIDER=stub`, so paying settles in place instead of redirecting to a
gateway, and the page turns into a green success screen. The order then shows as
**مدفوع** in the list.

> Paying assigns that package to the event. The seeded order is `event-300`, the
> package the demo wedding already has, so the quota bar in the sidebar stays at
> ٢٠ من ٣٠٠.

---

## Part 7 — The report

Sidebar → **التقرير**.

Actual attendance against confirmed seats, a compliance rate, an arrivals
histogram with its peak marked, first and last entry, median gap between
arrivals, a breakdown by group, and a no-show list. Plus **تصدير Excel**.

With only a couple of check-ins it's sparse — check several guests in via Part 5
first and the arrivals chart becomes worth reading.

---

## Part 8 — Admin

Sign out, then sign in as **`+966500000009`** / `Demo@1234`. You land on
**`/ar/admin`** automatically — an admin account configures the platform and does
not run weddings, so it has no host dashboard to go to. Try forcing
`/ar/dashboard`: it bounces you straight back.

Six tabs. **المستخدمون** has promote/demote and enable/disable.
**المناسبات** lets you change an event's status and grant a guest-cap override in
place. **الباقات** and **القوالب** edit prices, caps and availability.

### 8.1 Rebrand the product

**الهوية** → **هوية المنصة**.

Change **اسم المنصة (عربي)** to something else, and the **حرف الشعار** to a
different letter. The preview beside the form updates as you type — it shows what
you're about to save, not what's currently live.

Save. The page reloads, and the change is everywhere: the sidebar, the login
screen, the landing page, and **the browser tab title**.

**رفع شعار** replaces the drawn letter with an image (PNG, JPEG, SVG or WebP,
under 512 KB) and also becomes the favicon. **إزالة الشعار** falls back to the
letter.

Put your original name and letter back when you're done — nothing else does.

### 8.2 Two things that should refuse you

- Try to demote or disable **your own** admin account. It refuses with
  «لا يمكنك تعطيل حسابك أو إنزال صلاحيتك» rather than locking you out.
- Sign in as a plain host and open `/ar/admin` directly:
  «هذه الصفحة للمشرفين فقط».

---

## Part 9 — The negative tests

The most important checks in the app. Signed in as `+966500000000`:

**Another host's event.** Open
`/ar/events/cmsbjzy870006s6q48z33nvfi/guests` — an event belonging to a
different account.

**Expect:** «لم نجد هذه المناسبة» with a link home. The sidebar must **not** show
your own event beside it, and the page must not sit on a spinner. Same wording
whether the event belongs to someone else or doesn't exist — which of the two it
is, is not your account's business.

**Another host's order.** `/ar/checkout/<their order id>` →
«لم نعثر على هذا الطلب».

**Another host's report.** `/ar/events/cmsbjzy870006s6q48z33nvfi/report` →
«هذا الرابط غير صالح».

---

## Quick reference

| Screen | Where |
| --- | --- |
| Landing | `/ar` |
| Sign in / sign up | `/ar/login` · `/ar/register` |
| Dashboard | `/ar/dashboard` |
| Everything else | the sidebar |
| Admin | `/ar/admin` |
| A guest's invitation | `/invite/59ys5njcvzz6` |
| The door | `/scan/<eventId>` |
| Sample import file | `/sample-guests.csv` |

**English:** every host screen exists under `/en`. `/invite/*` and `/scan/*` are
locale-free — the invitation follows the event, and the scanner is Arabic-only by
design.

**If a page 404s after code changes:** `docker compose restart web`. On this
Windows bind mount Next does not reliably see file changes, so trust a restart
over what the browser shows.
