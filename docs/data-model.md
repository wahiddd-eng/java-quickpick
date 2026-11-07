# Data model

Schema: `apps/api/migrations/001_init.sql`. All money columns are `BIGINT` paise. All timestamps are `timestamptz` (UI shows IST).

| Table | Purpose / key rules |
|---|---|
| `users` | Students, vendors, admins. `role` ∈ STUDENT, VENDOR, ADMIN, SUPER_ADMIN. Staff have `password_hash` (bcrypt); students sign in by OTP. |
| `otp_codes` | Hashed one-time codes with expiry and attempt count. |
| `shops` | Name, status (DRAFT / ACTIVE / SUSPENDED), `accepting_orders` (pause switch), hours, slot length, slot capacity, accept timeout, FSSAI number (as provided), `is_demo`. |
| `shop_members` | Links vendor users to exactly the shop(s) they may operate. Basis of tenant isolation. |
| `categories`, `menu_items` | Per shop. `base_price_paise` is the vendor's original price; `available` is the sold-out toggle. |
| `devices` | Loaned tablets (QuickPick property): asset tag, model, current shop, assigned/returned dates, `last_seen_at` heartbeat. |
| `pickup_slots` | Generated lazily per shop/day. `capacity`, `reserved_count`; reservation is a conditional update. |
| `pricing_policies` | Versioned: `fee_rate_bps` (700 = 7%), `tax_mode`, `tax_rate_bps`, `approved` (CA sign-off), `effective_from`, note. |
| `orders` | Status + payment status, snapshots of fee rate, policy version, subtotal/fee/tax/total, slot, pickup code, `idempotency_key`, `slot_released`, expiry deadlines, prep minutes. |
| `order_items` | Snapshot of item name and unit price at order time. |
| `order_events` | Every status change: from, to, actor, reason, time. |
| `payments` | One per order (UNIQUE `order_id`): provider, provider ref, amount, status. |
| `refunds` | UNIQUE `idempotency_key`; amount, reason, status, provider ref. Total refunds can never exceed the payment. |
| `payment_splits` | Planned beneficiaries per paid order (VENDOR, PLATFORM, TAX); reversed on refunds. |
| `settlements`, `settlement_reconciliation` | Placeholders for provider settlement reports; never derived from payment success. |
| `webhook_events` | UNIQUE `(provider, external_event_id)` for de-duplication; raw payload and processing result. |
| `complaints` | Student support requests tied to their own order; OPEN / IN_PROGRESS / RESOLVED. |
| `audit_logs` | Actor, role, action, entity, metadata JSON. |

## Invariants checked by tests

- `reserved_count ≤ capacity` under concurrency; each order releases its slot at most once.
- Order amounts never change after creation, even if menu prices or the fee policy change.
- `sum(processed refunds) ≤ payment amount`; payment status recomputed after each refund.
- Duplicate or forged webhooks change nothing.
