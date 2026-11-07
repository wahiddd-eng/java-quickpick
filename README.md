# Java QuickPick — sandbox MVP

Campus food pre-order and scheduled pickup for the **Java food court, SRM KTR**. Students order from one shop, choose a pickup slot, pay, and collect with a 4-digit code; shops run orders from a loaned tablet; QuickPick admins onboard shops and handle refunds and support.

> ⚠️ **SANDBOX MODE.** Real payments are disabled. Only the built-in mock payment provider exists. Do not take real money until FSSAI checks, a CA's written GST opinion, a payment-provider marketplace/split agreement and SRM/Java management permission are all in place. The API refuses to start with any `PAYMENT_PROVIDER` other than `mock`.

## What's in the box

| Path | What it is | Dev URL |
|---|---|---|
| `apps/api` | Express + PostgreSQL API, mock payment provider, webhooks, slot capacity, refunds/ledger, RBAC, Socket.IO signals | http://localhost:4000 |
| `apps/student-web` | Student PWA (phone-first): OTP sign-in, shops, menu, one-shop cart, slot choice, fee breakdown, sandbox payment, live tracker, pickup code, history, support | http://localhost:5173 |
| `apps/vendor-web` | Vendor tablet PWA: Online/Offline indicator, sound alerts, accept/reject with timer, preparing → ready → handed over (pickup-code check), menu availability, pause orders, today's summary | http://localhost:5174 |
| `apps/admin-web` | Admin console: today's metrics + CSV export, orders + timeline + refunds, shops, menus, vendor logins, tablets, pricing versions, payments & reconciliation, support, audit log | http://localhost:5175 |
| `packages/shared` | Money/fee maths, order state machine, API client, shared styles | — |

## Run it

Needs Node 20+. No database install needed: without `DATABASE_URL` the API uses an embedded Postgres (PGlite) stored in `.data/pglite`.

```bash
npm install
cp .env.example .env        # optional; sensible dev defaults exist
npm run dev:api             # migrates, seeds demo data, starts on :4000
npm run dev:student         # :5173
npm run dev:vendor          # :5174
npm run dev:admin           # :5175
```

To use a real PostgreSQL instead, set `DATABASE_URL=postgres://…` and run `npm run db:migrate && npm run db:seed`.

### Demo accounts (seeded, clearly marked demo data)

| Who | Sign in |
|---|---|
| Student | any email at http://localhost:5173 — the 6-digit code is shown on screen in sandbox (`OTP_DEV_ECHO=true`) |
| Vendor, Demo Shop A | `vendor-a@quickpick.demo` / `demo1234` |
| Vendor, Demo Shop B | `vendor-b@quickpick.demo` / `demo1234` |
| Admin | `admin@quickpick.demo` / `demo1234` |
| Super-admin (can change pricing) | `super@quickpick.demo` / `demo1234` |

### Try the whole flow

1. Student: sign in → Demo Shop A → add an item → checkout → pick a time → **Continue to payment** → **Simulate successful payment**.
2. Vendor tablet (Shop A): tap **Enable sound**; the order appears under *New* with a countdown → **Accept** → **Start preparing** → **Mark ready**.
3. Student screen shows *Ready* and the pickup code. Vendor types the code → **Handed over**.
4. Admin: Orders → Details shows the timeline, fee breakdown, mock payment and planned vendor/platform split.

## Checks

```bash
npm run typecheck   # all workspaces
npm run lint
npm test            # 8 shared + 26 API tests (in-memory Postgres, fixed clock)
npm run build       # typecheck + production builds of the three apps
```

## Pricing in one line

Vendors get their **original menu price**. The student pays a separate **QuickPick convenience fee** (default 7% of the food subtotal, rounded half-up to the paisa). The fee rate and tax treatment are versioned settings changed only by the super-admin; every order stores a snapshot, so changes never touch past orders. The seeded policy is marked **not approved** until a CA signs off.

## Docs

- [Architecture](docs/architecture.md) · [Data model](docs/data-model.md) · [API contracts](docs/api-contracts.md)
- [Tablet / operations runbook](docs/operational-runbook.md)
- [Implementation plan](docs/IMPLEMENTATION_PLAN.md) · [Progress & known gaps](docs/PROGRESS.md)
- [Original project brief](docs/JAVA_QUICKPICK_PROJECT_BRIEF.md)
