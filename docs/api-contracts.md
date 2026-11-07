# API contracts

Base: `/api/v1`. JSON. Auth: `Authorization: Bearer <jwt>`. Money in integer **paise**. Errors: `{ "error": { "code": "SLOT_FULL", "message": "…" } }` with a fitting HTTP status (400 validation, 401, 403, 404 incl. cross-tenant, 409 conflicts, 503).

## Auth

| Method & path | Who | Notes |
|---|---|---|
| POST `/auth/otp/request` `{email}` | public | rate-limited; returns `devCode` only in sandbox |
| POST `/auth/otp/verify` `{email, code, name?}` | public | → `{token, user}` (STUDENT) |
| POST `/auth/login` `{email, password}` | staff | → `{token, user}` |
| GET `/me` | any | current user (+ shop for vendors) |

## Student

| Method & path | Notes |
|---|---|
| GET `/config` | `{sandbox, paymentProvider, currency}` |
| GET `/pricing-policy/current` | active fee policy incl. `approved` flag |
| GET `/shops`, `/shops/:shopId`, `/shops/:shopId/menu` | active shops only |
| GET `/shops/:shopId/pickup-slots` | today's future slots with `remaining`, `full` |
| POST `/orders/quote` `{shopId, slotId, items:[{menuItemId, quantity}]}` | server-side price; client prices ignored |
| POST `/orders` (header `Idempotency-Key`) | reserves the slot atomically → order in PENDING_PAYMENT |
| POST `/payments/checkout` `{orderId}` | mock checkout session |
| POST `/sandbox/payments/simulate` `{orderId, outcome: success\|failure}` | sandbox only: makes the mock provider send a **signed webhook**; does not mark anything paid itself |
| GET `/orders/:orderId`, GET `/me/orders` | own orders only (others → 404) |
| POST `/orders/:orderId/cancel` | before acceptance; refunds if paid |
| POST `/orders/:orderId/support` `{category, description}` | creates a complaint |

## Vendor (scoped to own shop; optional `x-shop-id` must be own)

| Method & path | Notes |
|---|---|
| GET `/vendor/shop`, PATCH `/vendor/shop/status` `{acceptingOrders}` | pause / resume |
| GET `/vendor/orders?status=` | active board, pickup-time order; first name only, no pickup code |
| POST `/vendor/orders/:id/accept` `{prepMinutes}` | |
| POST `/vendor/orders/:id/reject` `{reason}` | auto-refund |
| POST `/vendor/orders/:id/status` `{status, pickupCode?, reason?}` | PREPARING, READY, COLLECTED (code required), NOT_COLLECTED, CANCELLED |
| PATCH `/vendor/menu-items/:id` `{available}` | sold-out toggle |
| POST `/vendor/heartbeat` `{assetTag?}` | marks the tablet online |
| GET `/vendor/summary`, `/vendor/settlements` | today's numbers; settlements placeholder |

## Admin (ADMIN or SUPER_ADMIN)

| Method & path | Notes |
|---|---|
| GET/POST `/admin/shops`, PATCH `/admin/shops/:id` | onboarding, status, capacity, hours |
| GET/POST `/admin/vendors` `{name,email,password,shopId}` | |
| GET `/admin/shops/:id/menu`, POST `/admin/shops/:id/categories`, POST `/admin/shops/:id/menu-items`, PATCH `/admin/menu-items/:id` | |
| GET/POST `/admin/devices`, POST `/admin/devices/assign` `{deviceId, shopId\|null}` | loan / return |
| GET `/admin/orders?status=`, GET `/admin/orders/:id` | detail incl. timeline, payments, splits, refunds |
| GET `/admin/payments`, GET `/admin/reconciliation` | |
| POST `/admin/refunds` `{orderId, amountPaise?, reason}` + `Idempotency-Key` | full or partial |
| GET `/admin/pricing-policies`; PATCH `/admin/pricing-policy` | **SUPER_ADMIN only**; creates a new version |
| GET `/admin/analytics?date=YYYY-MM-DD`, GET `/admin/export/orders.csv?date=` | CSV guarded against formula injection |
| GET `/admin/complaints`, PATCH `/admin/complaints/:id`, GET `/admin/audit-logs` | |

## Webhook

`POST /api/v1/webhooks/payments/mock` — raw JSON body, header `x-mock-signature: <hex HMAC-SHA256(body, MOCK_WEBHOOK_SECRET)>`.
Body: `{ id, type: "payment.succeeded" | "payment.failed" | "refund.processed", data: { providerRef, amountPaise } }` (`id` is the provider event id used for de-duplication).
Responses: 200 processed / 200 `{duplicate:true}` / 401 bad signature. Unknown or mismatched events are stored and ignored.

## Socket.IO (signals only)

Connect to the API origin with `auth: { token }`. Rooms: `shop:<id>` (vendor), `user:<id>` (student), `admin`. Event: `order` with `{ orderId, status, kind }` — IDs and status only; always refetch over REST. Vendors are signalled only once an order is paid.
