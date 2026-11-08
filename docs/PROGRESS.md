# Progress

_Last updated: 2026-11-08_

## Done and verified

- `npm run typecheck`, `npm run lint`, `npm run build` — clean.
- `npm test` — **35 passing** (8 shared, 27 API) on in-memory Postgres with a fixed clock.
- Manual browser run (Playwright): student OTP → order → sandbox payment → vendor accept → preparing → ready → code handover → collected → admin sees timeline, fee, mock payment and split. No console errors.

### Required test areas (brief Section 23)

| # | Area | Covered by |
|---|---|---|
| 1 | 7% fee maths & rounding | shared tests + "quotes ₹100 as ₹7 fee / ₹107" |
| 2 | Snapshots survive price/policy changes | "keeps old order amounts after a price edit and a new 10% policy" |
| 3 | One shop per order | "rejects a cart mixing items from two shops" |
| 4 | Student isolation | "returns 404 for another student's order" |
| 5 | Vendor tenant isolation & privacy | "vendor A cannot list, read or change vendor B's orders…" |
| 6 | State machine | "rejects skips and moves out of terminal states" |
| 7 | Failed payment | "cancels the unpaid order, releases the slot…" |
| 8 | Duplicate webhooks | "processes the first delivery, ignores the duplicate…" |
| 9 | Amount mismatch | "ignores a success event whose amount does not match" |
| 10 | Webhook signature | "rejects a bad signature, a missing signature and a tampered body" |
| 11 | No client-side payment trust | "never trusts a browser/client claim of payment" |
| 12 | Refunds (auto + partial, over-refund blocked) | rejection auto-refund; admin partial refunds |
| 13 | Concurrent slot capacity | "lets exactly `capacity` of 10 simultaneous students reserve" + idempotency + pause |
| 14 | Expiry & late success | expiry sweep; late success refunded; unanswered paid order refunded |
| 15 | Vendor board survives missed sockets / RBAC | REST board without sockets; 401/403; super-admin-only pricing |

### Since the first build

- Redesigned student, shop-tablet and admin screens (shared palette and typeface).
- Admins can edit every shop detail, including opening hours and slot length, with a live preview of pickup times.

## Known gaps (by design or next up)

- **No real payment provider.** Cashfree/Razorpay adapters are intentionally not built (approvals pending). API refuses anything but `mock`.
- **OTP is not delivered.** Code is shown on screen in sandbox; connect an email/SMS sender and set `OTP_DEV_ECHO=false` before any pilot.
- **Slot capacity is configured, not measured.** Set it from real throughput with the two committed shops.
- No receipt printer, no real settlement import, basic reconciliation and CSV only.
- Live Socket.IO delivery is not covered by automated tests (REST fallback is).
- Service worker is minimal (installability only, no offline cache of data by design).
- Admin console is desktop-first; usable on tablet, cramped on phones.

## Next tasks

1. Pilot setup with the 2 committed shops: real menus, measured capacity, two tablets enrolled.
2. Real OTP delivery + privacy notice/terms.
3. Hosting (managed Postgres with backups), HTTPS domain, error monitoring.
4. Once approvals are in writing: provider adapter + settlement reconciliation.
