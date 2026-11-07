# Implementation plan

Scope follows the project brief (Section 23): a working **sandbox** MVP — pickup only, single-shop orders, lunch first, PWA, mock payments.

| Phase | Content | Status |
|---|---|---|
| 0. Foundations | npm workspaces, TypeScript, lint, shared money/fee maths, state machine, env template, sandbox guard | ✅ |
| 1. Data & API core | Postgres schema + migrations, PGlite for dev/tests, auth (OTP + staff password, JWT), RBAC, shops/menu, slots with atomic capacity, idempotent order creation, audit log | ✅ |
| 2. Payments (mock) | Provider-neutral interface, mock provider, signed + de-duplicated webhooks, amount check, expiry sweeper, late-success refund, planned splits, refunds (full/partial, idempotent), reconciliation | ✅ |
| 3. Vendor ops | Order board, accept timer, reject/cancel with refund, status flow, pickup-code handover, pause, menu availability, heartbeat, Socket.IO signals + REST polling | ✅ |
| 4. Student PWA | OTP login, shops, menu, one-shop cart, slots, server quote with fee breakdown, sandbox pay, tracker, pickup code, history, cancel, support | ✅ |
| 5. Admin console | Metrics, CSV export, orders/timeline/refunds, shops, menus, vendors, tablets, versioned pricing (super-admin), payments, reconciliation, support, audit | ✅ |
| 6. Tests & docs | 15 required test areas (34 tests), architecture, data model, API, runbook | ✅ |
| 7. Pilot readiness (next) | Real OTP delivery, measured slot capacity with 2 committed shops, hosting + backups, monitoring/alerts, privacy notice & terms | ⏳ |
| 8. Live payments (blocked on approvals) | Cashfree Easy Split or Razorpay Route adapter behind the same interface, provider webhook verification, settlement report import | ⛔ blocked |
