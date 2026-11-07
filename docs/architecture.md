# Architecture

```
 Student PWA (phone)      Vendor PWA (tablet)      Admin console
        │  REST + Socket.IO signals │                     │
        └──────────────┬────────────┴─────────────────────┘
                       ▼
             Express API  (/api/v1)
   auth · shops/menu · slots · orders · payments · refunds · admin
                       │                       ▲
                       ▼                       │ signed webhook (HMAC)
                 PostgreSQL               Payment provider
          (or embedded PGlite in dev)   (MockPaymentProvider only)
```

## Principles

- **The database is the source of truth.** Socket.IO only *signals* that something changed. Every screen refetches over REST on load, on reconnect, on every signal, and on a timer (student 6 s, vendor 8 s). A missed socket event can never lose an order.
- **Only a verified webhook confirms payment.** The browser never marks anything paid. The webhook route is mounted before `express.json()` so the raw body is verified with HMAC-SHA256 (`x-mock-signature`, constant-time compare). Events are de-duplicated by `(provider, external_event_id)`, the amount must match the order total, and a success that arrives after the order expired is refunded automatically.
- **Money is integer paise.** Fee = `floor((subtotal × bps + 5000) / 10000)` (half-up). Tax mode NONE / INCLUSIVE / EXCLUSIVE applies to the fee only. All maths lives in `packages/shared` and is shared by API and UI; the API always re-prices from the database and ignores client prices.
- **Capacity is atomic.** A slot is reserved with a single conditional update (`reserved_count < capacity`), so ten simultaneous checkouts on a capacity-5 slot give exactly five orders. Order creation is idempotent per `Idempotency-Key`.
- **One state machine.** `packages/shared` defines allowed transitions; `services/orders.ts#transitionOrder` is the only writer of order status. It records an `order_events` row, releases the slot exactly once (`slot_released` flag) and auto-refunds paid orders that end REJECTED / CANCELLED / EXPIRED (idempotency key `auto:<orderId>`).
- **Side effects after commit.** `withTx` collects socket notifications and runs them only after the transaction commits.
- **Tenant isolation.** Vendors are scoped by `shop_members`; any other shop's order returns 404 (not 403) so IDs can't be probed. Vendors see the student's first name only and never the pickup code or contact details. Roles: STUDENT, VENDOR, ADMIN, SUPER_ADMIN (only SUPER_ADMIN changes pricing).
- **Audit everything financial or sensitive**: pricing changes, refunds, shop/vendor/device changes, manual status overrides.

## Order lifecycle

```
PENDING_PAYMENT ──paid webhook──► AWAITING_VENDOR ──accept──► ACCEPTED ──► PREPARING ──► READY ──code──► COLLECTED
      │                                 │                         │                         └──► NOT_COLLECTED
      ├─ checkout TTL / failed ► EXPIRED├─ reject / timeout ► REJECTED / EXPIRED (refund)
      └─ student cancel ► CANCELLED     └─ student cancel ► CANCELLED (refund)      └─ vendor "can't make it" ► CANCELLED (refund)
```

Payment status is tracked separately (PENDING → SUCCEEDED → REFUND_PENDING / PARTIALLY_REFUNDED / REFUNDED, or FAILED). A sweeper runs every 15 s to expire stale checkouts and unanswered orders.

## Payments: provider-neutral

`payments/provider.ts` defines `MarketplacePaymentProvider` (create checkout, verify webhook, refund, planned split). Only `MockPaymentProvider` exists. Cashfree Easy Split / Razorpay Route adapters are **deliberately not built** until a provider accepts the marketplace model and real credentials/terms exist; the API refuses any other `PAYMENT_PROVIDER`. Each paid order gets planned `payment_splits` (vendor = food subtotal, platform = fee, tax line if any). Settlement is a separate record and is never inferred from payment success.

## Deployment notes (when approvals exist)

API and frontends are stateless apart from Postgres. Set `NODE_ENV=production`, real `JWT_SECRET`, `DATABASE_URL`, `CORS_ORIGINS`, and `OTP_DEV_ECHO=false` (and connect a real OTP sender, not built yet). In production the API refuses to start without secrets and does not seed demo data.
